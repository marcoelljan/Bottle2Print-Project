import { Router } from "express";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { PDFParse } from "pdf-parse";
import QRCode from "qrcode";
import { db } from "../db";
import { upload } from "../upload";
import { createSession, getSession, updateSession, deleteSession } from "../qrSessions";
import { getGuestCredits, deductGuestCredits, endGuestSession } from "../guestSession";
import { broadcast } from "../wsHub";

const router = Router();
const PI_IP = process.env.PI_IP || "localhost";

const VALID_PAPER_SIZES = ["A4", "Letter", "Long"] as const;
type PaperSize = typeof VALID_PAPER_SIZES[number];
const DEFAULT_PAPER_SIZE: PaperSize = "Letter";

function sanitizePaperSize(input: unknown): PaperSize {
  if (typeof input === "string" && VALID_PAPER_SIZES.includes(input as PaperSize)) {
    return input as PaperSize;
  }
  return DEFAULT_PAPER_SIZE;
}

function getCupsMediaString(size: PaperSize): string {
  if (size === "A4") return "A4";
  if (size === "Letter") return "Letter";
  if (size === "Long") return "Custom.8.5x13in";
  return "Letter";
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
    exec(`soffice --headless --convert-to pdf --outdir "${outDir}" "${filePath}"`, (err) => {
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
  const sessionId = createSession(rfid ?? "UNASSIGNED");
  const uploadUrl = `http://${PI_IP}:4000/upload/${sessionId}`;
  const qrImage = await QRCode.toDataURL(uploadUrl);
  res.json({ sessionId, uploadUrl, qrImage });
});

router.post("/api/print/qr-attach/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const { rfid } = req.body;
  if (!rfid) return res.status(400).json({ error: "Missing rfid." });
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
    </head>
    <body style="font-family:sans-serif;text-align:center;padding:40px 20px;">
      
      <div id="upload-section">
        <h2>Upload your file to print</h2>
        <input type="file" id="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png" style="margin:20px 0;"/><br/>
        <button id="btn" style="padding:12px 24px;font-size:16px; background-color: #f0a500; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">Upload</button>
        <p id="status" style="margin-top: 15px; color: #555;"></p>
      </div>

      <div id="success-section" style="display:none; margin-top: 40px;">
        <h2 style="color: #2ecc71; margin-bottom: 10px;">File uploaded successfully!</h2>
        <p style="font-size: 16px; color: #333; line-height: 1.5; padding: 0 15px;">
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
          btn.style.opacity = '0.7';
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
              btn.style.opacity = '1';
            }
          } catch {
            status.innerText = 'Could not reach server.';
            status.style.color = '#e74c3c';
            btn.innerText = 'Upload';
            btn.disabled = false;
            btn.style.opacity = '1';
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

router.post("/api/print/qr-confirm/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session || !session.pdfPath) {
    return res.status(404).json({ error: "No uploaded file found for this session." });
  }

  const { rfid, filePath, pdfPath, pageCount } = session;
  const totalPages = pageCount ?? 1;

  const colorMode: "bw" | "color" = req.body.colorMode === "color" ? "color" : "bw";
  const paperSize = sanitizePaperSize(req.body.paperSize);
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
    cupsRangeFlag = `-P ${rangeInput}`;
  }

  const creditsPerPage = colorMode === "color" ? 8 : 3;
  const totalCost = selectedPages.length * creditsPerPage;

  const isGuest = rfid === "GUEST";

  if (isGuest) {
    const guestCredits = getGuestCredits();
    if (guestCredits < totalCost) {
      if (filePath) fs.unlink(filePath, () => {});
      fs.unlink(pdfPath, () => {});
      deleteSession(req.params.sessionId);
      return res.status(403).json({ error: "Not enough credits." });
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
      if (filePath) fs.unlink(filePath, () => {});
      fs.unlink(pdfPath, () => {});
      deleteSession(req.params.sessionId);
      return res.status(403).json({ error: "Not enough credits." });
    }
  }

  const cupsColorFlag = colorMode === "color" ? "RGB" : "Gray";
  const cupsMediaString = getCupsMediaString(paperSize);
  const cmd = `lp ${cupsRangeFlag} -o ColorModel=${cupsColorFlag} -o media=${cupsMediaString} "${pdfPath}"`;

  exec(cmd, (error, stdout, stderr) => {
    if (filePath && filePath !== pdfPath) fs.unlink(filePath, () => {});
    fs.unlink(pdfPath, () => {});
    deleteSession(req.params.sessionId);

    if (error) return res.status(500).json({ error: stderr || error.message });

    if (isGuest) {
      deductGuestCredits(totalCost);
      endGuestSession();
    } else {
      db.prepare("UPDATE users SET credits = credits - ? WHERE rfid = ?").run(totalCost, rfid);
      db.prepare(`INSERT INTO transactions (rfid, type, credits) VALUES (?, 'print', ?)`).run(rfid, totalCost);
    }

    res.json({
      success: true,
      output: stdout.trim(),
      creditsCharged: totalCost,
      pagesPrinted: selectedPages.length,
      colorMode,
      paperSize,
    });
  });
});

export default router;