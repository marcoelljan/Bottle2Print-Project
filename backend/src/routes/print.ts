import { Router } from "express";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { PDFParse } from "pdf-parse";
import QRCode from "qrcode";
import { db } from "../db";
import { upload } from "../upload";
import { createSession, getSession, updateSession, deleteSession } from "../qrSessions";
import { getGuestCredits, deductGuestCredits, endGuestSession, addGuestCredit } from "../guestSession";
import { broadcast } from "../wsHub";
import { isVerified } from "../pinAuth";
import { sendMail } from "../alerts";

const router = Router();
const PI_IP = process.env.PI_IP || "localhost";

const VALID_PAPER_SIZES = ["A4", "Letter", "Long"] as const;
type PaperSize = typeof VALID_PAPER_SIZES[number];
const DEFAULT_PAPER_SIZE: PaperSize = "Letter";

const VALID_LAYOUTS = ["portrait", "landscape"] as const;
type Layout = typeof VALID_LAYOUTS[number];
const DEFAULT_LAYOUT: Layout = "portrait";

function sanitizePaperSize(input: unknown): PaperSize {
  if (typeof input === "string" && VALID_PAPER_SIZES.includes(input as PaperSize)) {
    return input as PaperSize;
  }
  return DEFAULT_PAPER_SIZE;
}

function sanitizeLayout(input: unknown): Layout {
  if (typeof input === "string" && VALID_LAYOUTS.includes(input as Layout)) {
    return input as Layout;
  }
  return DEFAULT_LAYOUT;
}

function getCupsMediaString(size: PaperSize): string {
  if (size === "A4") return "A4";
  if (size === "Letter") return "Letter";
  if (size === "Long") return "Custom.8.5x13in";
  return "Letter";
}

function getCupsOrientationFlag(layout: Layout): string {
  // IPP orientation-requested: 3 = portrait, 4 = landscape
  return layout === "landscape" ? "-o orientation-requested=4" : "-o orientation-requested=3";
}

async function ensurePdf(
  filePath: string,
  mimetype: string,
  outDir: string
): Promise<{ pdfPath: string; pageCount: number }> {
  if (mimetype === "application/pdf") {
    const buf = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: buf });
    try {
      const result = await parser.getText();
      return { pdfPath: filePath, pageCount: result.pages.length };
    } finally {
      await parser.destroy();
    }
  }

  await new Promise<void>((resolve, reject) => {
    exec(`soffice --headless --convert-to pdf --outdir "${outDir}" "${filePath}"`, { timeout: 60000 }, (err) => {
      if (err) reject(err); else resolve();
    });
  });

  const convertedPath = path.join(outDir, path.basename(filePath, path.extname(filePath)) + ".pdf");
  if (!fs.existsSync(convertedPath)) {
    throw new Error("Conversion produced no output file.");
  }

  const buf = fs.readFileSync(convertedPath);
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return { pdfPath: convertedPath, pageCount: result.pages.length };
  } finally {
    await parser.destroy();
  }
}

function parsePageRange(range: string, totalPages: number): number[] | null {
  const pages = new Set<number>();
  const parts = range.split(",").map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  for (const part of parts) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) return null;
    const start = parseInt(m[1]);
    const end = m[2] ? parseInt(m[2]) : start;
    if (start < 1 || end < start || end > totalPages) return null;
    for (let i = start; i <= end; i++) pages.add(i);
  }

  return pages.size > 0 ? Array.from(pages).sort((a, b) => a - b) : null;
}

function mayUseCard(rfid: unknown): boolean {
  if (typeof rfid !== "string" || !rfid) return false;
  if (rfid === "GUEST") return true;   // guests spend the shared bottle-credit pool, not anyone's account
  return isVerified(rfid);             // card users: PIN entered at the kiosk in the last 10 minutes
}

function logSystem(action: string, details: string) {
  try {
    db.prepare("INSERT INTO activity_logs (admin_user, action, details) VALUES (?, ?, ?)").run("System Kiosk", action, details);
  } catch {}
}

let lastPrinterMail = 0;

function printerReady(): Promise<{ ok: boolean; reason?: string }> {
  return new Promise(resolve => {
    exec("lpstat -l -p", { timeout: 5000 }, (err, stdout) => {
      const out = String(stdout || "");
      if (err && !out) return resolve({ ok: false, reason: "The print service is not responding." });
      if (!/printer /i.test(out)) return resolve({ ok: false, reason: "No printer is installed." });
      if (/disabled|stopped|paused/i.test(out)) return resolve({ ok: false, reason: "The printer is turned off or disabled." });
      if (/waiting for printer to become available|unable to open/i.test(out)) return resolve({ ok: false, reason: "The printer is not connected." });
      const alerts = (out.match(/Alerts:\s*(.*)/i)?.[1] ?? "").toLowerCase();
      if (/media-empty|media-needed|media-jam|marker-supply-empty|door-open|offline/.test(alerts)) {
        return resolve({ ok: false, reason: "The printer reports a problem (" + alerts.trim() + ")." });
      }
      resolve({ ok: true });
    });
  });
}

// If a queued job is still waiting after limitMs, cancel it and run onStuck
function watchJob(jobId: string, limitMs: number, onStuck: () => void) {
  const started = Date.now();
  const timer = setInterval(() => {
    exec("lpstat -o", { timeout: 5000 }, (_e, out) => {
      const queued = String(out || "").split("\n").some(l => l.startsWith(jobId + " "));
      if (!queued) { clearInterval(timer); return; }          // finished or removed
      if (Date.now() - started > limitMs) {
        clearInterval(timer);
        exec("cancel " + jobId, () => {});
        onStuck();
      }
    });
  }, 5000);
}

router.post("/api/count-pages", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file." });
  try {
    const outDir = path.dirname(req.file.path);
    const { pdfPath, pageCount } = await ensurePdf(req.file.path, req.file.mimetype, outDir);
    if (pdfPath !== req.file.path) fs.unlink(pdfPath, () => {});
    fs.unlink(req.file.path, () => {});
    return res.json({ pages: pageCount });
  } catch {
    fs.unlink(req.file.path, () => {});
    return res.status(422).json({ error: "Could not read this file. Try a different format." });
  }
});

router.post("/api/print/qr-session", async (req, res) => {
  const { rfid } = req.body;
  if (rfid && rfid !== "UNASSIGNED" && !mayUseCard(rfid)) {
    return res.status(403).json({ error: "Card not verified. Enter your PIN at the kiosk first." });
  }
  const sessionId = createSession(rfid ?? "UNASSIGNED");
  const uploadUrl = `http://${PI_IP}:4000/upload/${sessionId}`;
  const qrImage = await QRCode.toDataURL(uploadUrl);
  res.json({ sessionId, uploadUrl, qrImage });
});

router.post("/api/print/qr-attach/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const { rfid } = req.body;
  if (!rfid) return res.status(400).json({ error: "Missing rfid." });
  if (rfid && rfid !== "UNASSIGNED" && !mayUseCard(rfid)) {
    return res.status(403).json({ error: "Card not verified. Enter your PIN at the kiosk first." });
  }
  const s = updateSession(sessionId, { rfid });
  if (!s) return res.status(404).json({ error: "Session not found." });
  try { broadcast({ type: "state", session: s }); } catch {}
  res.json({ success: true, session: s });
});

router.get("/upload/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    return res.send(`<h2 style="font-family:sans-serif;text-align:center;margin-top:60px;">This link has expired. Please tap your card again at the kiosk.</h2>`);
  }
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Bottle2Print Upload</title>
      <style>
        body { font-family: sans-serif; text-align: center; padding: 40px 20px; background: #1a1a1a; color: #fff; margin: 0; }
        input[type="file"] { margin: 20px 0; color: #aaa; }
        button { padding: 12px 24px; font-size: 16px; background-color: #f0a500; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; color: #000; }
        button:disabled { opacity: 0.7; cursor: not-allowed; }
      </style>
    </head>
    <body>
      <div id="upload-section">
        <h2>Upload your file to print</h2>
        <input type="file" id="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png"/><br/>
        <button id="btn">Upload</button>
        <p id="status" style="margin-top: 15px; color: #777;"></p>
      </div>

      <div id="success-section" style="display:none; margin-top: 40px;">
        <h2 style="color: #2ecc71; margin-bottom: 10px;">File uploaded successfully!</h2>
        <p style="font-size: 16px; color: #ccc; line-height: 1.5; padding: 0 15px;">
          Your file is ready. Please look at the kiosk screen to choose your payment method and continue.
        </p>
      </div>
      
      <script>
        document.getElementById('btn').onclick = async () => {
          const fileInput = document.getElementById('file');
          const btn = document.getElementById('btn');
          const status = document.getElementById('status');

          if (!fileInput.files[0]) { alert('Choose a file first'); return; }
          
          const form = new FormData();
          form.append('file', fileInput.files[0]);
          
          btn.innerText = 'Uploading...';
          btn.disabled = true;
          status.innerText = 'Sending to kiosk...';
          
          try {
            const res = await fetch('/api/print/qr-upload/${req.params.sessionId}', { method: 'POST', body: form });
            const data = await res.json();
            
            if (data.success) {
              document.getElementById('upload-section').style.display = 'none';
              document.getElementById('success-section').style.display = 'block';
            } else {
              status.innerText = 'Error: ' + (data.error || 'upload failed');
              status.style.color = '#e74c3c';
              btn.innerText = 'Upload';
              btn.disabled = false;
            }
          } catch {
            status.innerText = 'Could not reach server.';
            status.style.color = '#e74c3c';
            btn.innerText = 'Upload';
            btn.disabled = false;
          }
        };
      </script>
    </body>
    </html>
  `);
});

router.post("/api/print/qr-upload/:sessionId", upload.single("file"), async (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session expired." });
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });

  try {
    const outDir = path.dirname(req.file.path);
    const { pdfPath, pageCount } = await ensurePdf(req.file.path, req.file.mimetype, outDir);

    updateSession(req.params.sessionId, {
      status: "uploaded",
      filePath: req.file.path,
      pdfPath,
      fileName: req.file.originalname,
      pageCount,
    });

    const user = db.prepare("SELECT * FROM users WHERE rfid = ?").get(session.rfid) as any;
    const costs = { bw: pageCount * 3, color: pageCount * 8 };
      
    broadcast({
      type: "qr-upload",
      sessionId: req.params.sessionId,
      fileName: req.file.originalname,
      pageCount,
    });

    res.json({
      success: true,
      fileName: req.file.originalname,
      pageCount,
      userCredits: user?.credits ?? 0,
      costs,
    });
  } catch {
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: "Could not process this file. Try a different format." });
  }
});

router.get("/api/print/preview/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session || !session.pdfPath) {
    return res.status(404).send("No file found for this session.");
  }
  res.setHeader("Content-Type", "application/pdf");
  res.sendFile(path.resolve(session.pdfPath));
});

router.post("/api/print/qr-confirm/:sessionId", async (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session || !session.pdfPath) {
    return res.status(404).json({ error: "No uploaded file found for this session." });
  }

  const { rfid, filePath, pdfPath, pageCount } = session;
  const totalPages = pageCount ?? 1;
  if (!mayUseCard(rfid)) {
    return res.status(403).json({ error: "Card not verified. Enter your PIN at the kiosk first." });
  }

  // [EDIT 1] Printer first: if it is down, say so (and keep the file) before talking about credits
  const printer = await printerReady();
  if (!printer.ok) {
    logSystem("PRINTER_NOT_READY", `${printer.reason} (${rfid === "GUEST" ? "Guest" : "RFID " + rfid})`);
    return res.status(503).json({ error: "Printer not ready: " + printer.reason + " Please ask staff. You have not been charged." });
  }

  const colorMode: "bw" | "color" = req.body.colorMode === "color" ? "color" : "bw";
  const paperSize = sanitizePaperSize(req.body.paperSize);
  const layout = sanitizeLayout(req.body.layout);
  const rangeInput: string = (req.body.pageRange ?? "all").trim();

  let selectedPages: number[];
  let cupsRangeFlag = "";

  if (rangeInput === "all" || rangeInput === "") {
    selectedPages = Array.from({ length: totalPages }, (_, i) => i + 1);
  } else {
    const parsed = parsePageRange(rangeInput, totalPages);
    if (!parsed) {
      return res.status(400).json({ error: `Invalid page range. This document has ${totalPages} page(s).` });
    }
    selectedPages = parsed;
    cupsRangeFlag = `-P ${selectedPages.join(",")}`;
  }

  const creditsPerPage = colorMode === "color" ? 8 : 3;
  const totalCost = selectedPages.length * creditsPerPage;

  const isGuest = rfid === "GUEST";

  // [EDIT 2] Not enough credits: keep the file so the user can pay with bottles without re-uploading
  if (isGuest) {
    const guestCredits = getGuestCredits();
    if (guestCredits < totalCost) {
      return res.status(403).json({ error: `Not enough credits. You have ${guestCredits}, this job needs ${totalCost}. Go back and pay with bottles.` });
    }
  } else {
    const user = db.prepare("SELECT * FROM users WHERE rfid = ?").get(rfid) as any;
    if (!user) {
      if (filePath) fs.unlink(filePath, () => {});
      fs.unlink(pdfPath, () => {});
      deleteSession(req.params.sessionId);
      return res.status(404).json({ error: "User not found." });
    }
    if (user.credits < totalCost) {
      return res.status(403).json({ error: `Not enough credits. You have ${user.credits}, this job needs ${totalCost}. Go back and pay with bottles.` });
    }
  }

  const cupsColorFlag = colorMode === "color" ? "RGB" : "Gray";
  const cupsMediaString = getCupsMediaString(paperSize);
  const cupsOrientationFlag = getCupsOrientationFlag(layout);
  const cmd = `lp ${cupsRangeFlag} -o ColorModel=${cupsColorFlag} -o media=${cupsMediaString} ${cupsOrientationFlag} "${pdfPath}"`;

  // Charge first (atomic), print second, refund if printing fails
  if (isGuest) {
    deductGuestCredits(totalCost);
  } else {
    const charged = db.prepare("UPDATE users SET credits = credits - ? WHERE rfid = ? AND credits >= ?").run(totalCost, rfid, totalCost);
    if (charged.changes === 0) {
      return res.status(403).json({ error: "Not enough credits. Go back and pay with bottles." });
    }
  }

  exec(cmd, (error, stdout, stderr) => {
    if (error) {   // printing failed: give the credits back and KEEP the file
      logSystem("PRINT_FAILED", `${isGuest ? "Guest" : "RFID " + rfid}: ${String(stderr || error.message).slice(0, 150)}, ${totalCost} credits refunded`);
      if (isGuest) addGuestCredit(totalCost);
      else db.prepare("UPDATE users SET credits = credits + ? WHERE rfid = ?").run(totalCost, rfid);
      return res.status(500).json({ error: stderr || error.message });
    }

    // [EDIT 3] Only a successful print removes the uploaded file
    if (filePath && filePath !== pdfPath) fs.unlink(filePath, () => {});
    fs.unlink(pdfPath, () => {});
    deleteSession(req.params.sessionId);

    if (isGuest) {
      endGuestSession();
    } else {
      db.prepare("INSERT INTO transactions (rfid, type, size, credits) VALUES (?, 'print', ?, ?)")
        .run(rfid, `${selectedPages.length} page(s), ${colorMode}`, totalCost);
    }

    const jobId = (stdout.match(/request id is (\S+)/) ?? [])[1];
    if (jobId && /^[A-Za-z0-9_.-]+$/.test(jobId)) {
      watchJob(jobId, 120000 + selectedPages.length * 20000, () => {
        if (!isGuest) {
          db.prepare("UPDATE users SET credits = credits + ? WHERE rfid = ?").run(totalCost, rfid);
          db.prepare("INSERT INTO transactions (rfid, type, size, credits) VALUES (?, 'adjust', 'Print refunded: the job did not finish', ?)").run(rfid, totalCost);
        }
        try {
          db.prepare("INSERT INTO activity_logs (admin_user, action, details) VALUES (?, ?, ?)")
            .run("System Kiosk", "PRINT_REFUND", (isGuest ? "Guest" : "RFID " + rfid) + ": job " + jobId + " stuck and cancelled" + (isGuest ? "" : ", " + totalCost + " credits refunded"));
        } catch {}
        if (Date.now() - lastPrinterMail > 60 * 60 * 1000) {
          lastPrinterMail = Date.now();
          sendMail("Printer problem", "A print job was stuck for several minutes and was cancelled. Please check the printer for paper, ink or a jam.");
        }
      });
    }

    res.json({
      success: true,
      output: stdout.trim(),
      creditsCharged: totalCost,
      pagesPrinted: selectedPages.length,
      colorMode,
      paperSize,
      layout,
    });
  });
});

export default router;