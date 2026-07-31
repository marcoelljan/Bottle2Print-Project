import { Router } from "express";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import pdfParse from "pdf-parse";
import QRCode from "qrcode";
import { db } from "../db";
import { upload } from "../upload";
import { createSession, getSession, updateSession, deleteSession } from "../qrSessions";
import { broadcast } from "../wsHub";

const router = Router();
const PI_IP = process.env.PI_IP || "localhost";

// ── existing routes (unchanged) ────────────────────────────────────────────

router.post("/api/count-pages", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file." });
  try {
    if (req.file.mimetype === "application/pdf") {
      const buf = fs.readFileSync(req.file.path);
      const data = await (pdfParse as any).default(buf);
      fs.unlink(req.file.path, () => {});
      return res.json({ pages: data.numpages });
    }
    fs.unlink(req.file.path, () => {});
    return res.json({ pages: 1 });
  } catch {
    fs.unlink(req.file.path, () => {});
    return res.json({ pages: 1 });
  }
});

router.post("/api/print", upload.single("document"), (req, res) => {
  const rfid  = req.body.rfid as string;
  const pages = parseInt(req.body.pages ?? "1");

  if (!rfid || !req.file) return res.status(400).json({ error: "Missing rfid or file." });

  const user = db.prepare("SELECT * FROM users WHERE rfid = ?").get(rfid) as any;
  if (!user) { fs.unlink(req.file.path, () => {}); return res.status(404).json({ error: "User not found." }); }
  if (user.credits < pages) {
    fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: "Not enough credits." });
  }

  const filePath = req.file.path;
  const isPdf = req.file.mimetype === "application/pdf";

  function sendToPrinter(pathToPrint: string, cleanupPaths: string[]) {
    exec(`lp "${pathToPrint}"`, (error, stdout, stderr) => {
      cleanupPaths.forEach(p => fs.unlink(p, () => {}));
      if (error) return res.status(500).json({ error: stderr || error.message });

      db.prepare("UPDATE users SET credits = credits - ? WHERE rfid = ?").run(pages, rfid);
      db.prepare(`INSERT INTO transactions (rfid, type, credits) VALUES (?, 'print', ?)`).run(rfid, pages);

      res.json({ success: true, output: stdout.trim() });
    });
  }

  if (isPdf) {
    sendToPrinter(filePath, [filePath]);
    return;
  }

  const outDir = path.dirname(filePath);
  const convertCmd = `soffice --headless --convert-to pdf --outdir "${outDir}" "${filePath}"`;

  exec(convertCmd, (convError) => {
    if (convError) {
      fs.unlink(filePath, () => {});
      return res.status(500).json({ error: "Failed to convert document for printing." });
    }

    const convertedPath = path.join(
      outDir,
      path.basename(filePath, path.extname(filePath)) + ".pdf"
    );

    if (!fs.existsSync(convertedPath)) {
      fs.unlink(filePath, () => {});
      return res.status(500).json({ error: "Conversion produced no output file." });
    }

    sendToPrinter(convertedPath, [filePath, convertedPath]);
  });
});

// ── NEW: QR code print flow ────────────────────────────────────────────────

async function ensurePdf(
  filePath: string,
  mimetype: string,
  outDir: string
): Promise<{ pdfPath: string; pageCount: number }> {
  if (mimetype === "application/pdf") {
    const buf = fs.readFileSync(filePath);
    const data = await (pdfParse as any).default(buf);
    return { pdfPath: filePath, pageCount: data.numpages };
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
  const data = await (pdfParse as any).default(buf);
  return { pdfPath: convertedPath, pageCount: data.numpages };
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

// 1. Kiosk calls this right after RFID tap to create a session + QR code
router.post("/api/print/qr-session", async (req, res) => {
  const { rfid } = req.body;
  if (!rfid) return res.status(400).json({ error: "Missing rfid." });

  const sessionId = createSession(rfid);
  const uploadUrl = `http://${PI_IP}:4000/upload/${sessionId}`;
  const qrImage = await QRCode.toDataURL(uploadUrl);

  res.json({ sessionId, uploadUrl, qrImage });
});

// 2. Simple phone-facing upload page (plain HTML, not part of the React app)
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
      <h2>Upload your file to print</h2>
      <input type="file" id="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png" style="margin:20px 0;"/><br/>
      <button id="btn" style="padding:12px 24px;font-size:16px;">Upload</button>
      <p id="status"></p>
      <div id="summary" style="display:none; text-align:left; max-width:340px; margin:20px auto; border:1px solid #ddd; border-radius:10px; padding:16px 20px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span>File</span><strong id="s-file"></strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span>Pages</span><strong id="s-pages"></strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span>B&amp;W cost</span><strong id="s-bw"></strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span>Color cost</span><strong id="s-color"></strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:8px; border-top:1px solid #eee; padding-top:8px;">
          <span>Your credits</span><strong id="s-credits"></strong>
        </div>
        <p id="s-warning" style="color:#c0392b; font-weight:bold; display:none;"></p>
      </div>
      <p style="font-size:13px; color:#666;">Choose black &amp; white or color, and confirm the print, on the kiosk screen.</p>
      <script>
        document.getElementById('btn').onclick = async () => {
          const fileInput = document.getElementById('file');
          if (!fileInput.files[0]) { alert('Choose a file first'); return; }
          const form = new FormData();
          form.append('file', fileInput.files[0]);
          document.getElementById('status').innerText = 'Uploading...';
          try {
            const res = await fetch('/api/print/qr-upload/${req.params.sessionId}', { method: 'POST', body: form });
            const data = await res.json();
            if (data.success) {
              document.getElementById('status').innerText = 'Uploaded! Confirm print type on the kiosk screen.';
              document.getElementById('s-file').innerText = data.fileName;
              document.getElementById('s-pages').innerText = data.pageCount;
              document.getElementById('s-bw').innerText = data.costs.bw + ' credits';
              document.getElementById('s-color').innerText = data.costs.color + ' credits';
              document.getElementById('s-credits').innerText = data.userCredits;
              document.getElementById('summary').style.display = 'block';

              const warn = document.getElementById('s-warning');
              if (data.userCredits < data.costs.bw) {
                warn.innerText = 'Not enough credits to print, even in black & white. Deposit more bottles first.';
                warn.style.display = 'block';
              } else if (data.userCredits < data.costs.color) {
                warn.innerText = 'You have enough for black & white, but not for color.';
                warn.style.display = 'block';
              }
            } else {
              document.getElementById('status').innerText = 'Error: ' + (data.error || 'upload failed');
            }
          } catch {
            document.getElementById('status').innerText = 'Could not reach server.';
          }
        };
      </script>
    </body>
    </html>
  `);
});

// 3. Phone uploads the file here
// 3. Phone uploads the file here
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
// 4. Kiosk confirms the print — uses the already-uploaded, already-converted PDF
router.post("/api/print/qr-confirm/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session || !session.pdfPath) {
    return res.status(404).json({ error: "No uploaded file found for this session." });
  }

  const { rfid, filePath, pdfPath, pageCount } = session;
  const totalPages = pageCount ?? 1;

  const colorMode: "bw" | "color" = req.body.colorMode === "color" ? "color" : "bw";
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

  // Confirmed on this printer (Canon TS200 series):
  //   ColorModel=Gray → true monochrome
  //   ColorModel=RGB  → true color
  const cupsColorFlag = colorMode === "color" ? "RGB" : "Gray";
  const cmd = `lp ${cupsRangeFlag} -o ColorModel=${cupsColorFlag} "${pdfPath}"`;

  exec(cmd, (error, stdout, stderr) => {
    if (filePath && filePath !== pdfPath) fs.unlink(filePath, () => {});
    fs.unlink(pdfPath, () => {});
    deleteSession(req.params.sessionId);

    if (error) return res.status(500).json({ error: stderr || error.message });

    db.prepare("UPDATE users SET credits = credits - ? WHERE rfid = ?").run(totalCost, rfid);
    db.prepare(`INSERT INTO transactions (rfid, type, credits) VALUES (?, 'print', ?)`).run(rfid, totalCost);

    res.json({
      success: true,
      output: stdout.trim(),
      creditsCharged: totalCost,
      pagesPrinted: selectedPages.length,
      colorMode,
    });
  });
});

export default router;