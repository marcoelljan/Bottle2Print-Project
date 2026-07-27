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

// helper — same page-counting logic as /api/count-pages, reused here
async function countPdfPages(filePath: string, mimetype: string): Promise<number> {
  if (mimetype !== "application/pdf") return 1;
  try {
    const buf = fs.readFileSync(filePath);
    const data = await (pdfParse as any).default(buf);
    return data.numpages;
  } catch {
    return 1;
  }
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
              document.getElementById('status').innerText = 'Upload successful! Check the kiosk screen.';
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
router.post("/api/print/qr-upload/:sessionId", upload.single("file"), async (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session expired." });
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });

  const pageCount = await countPdfPages(req.file.path, req.file.mimetype);

  updateSession(req.params.sessionId, {
    status: "uploaded",
    filePath: req.file.path,
    fileName: req.file.originalname,
    pageCount,
  });

  broadcast({
    type: "qr-upload",
    sessionId: req.params.sessionId,
    fileName: req.file.originalname,
    pageCount,
  });

  res.json({ success: true });
});

// 4. Kiosk confirms the print — uses the already-uploaded file
router.post("/api/print/qr-confirm/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session || !session.filePath) {
    return res.status(404).json({ error: "No uploaded file found for this session." });
  }

  const { rfid, filePath, fileName, pageCount } = session;
  const pages = pageCount ?? 1;

  const user = db.prepare("SELECT * FROM users WHERE rfid = ?").get(rfid) as any;
  if (!user) {
    fs.unlink(filePath, () => {});
    deleteSession(req.params.sessionId);
    return res.status(404).json({ error: "User not found." });
  }
  if (user.credits < pages) {
    fs.unlink(filePath, () => {});
    deleteSession(req.params.sessionId);
    return res.status(403).json({ error: "Not enough credits." });
  }

  const isPdf = fileName?.toLowerCase().endsWith(".pdf") ?? false;

  function sendToPrinter(pathToPrint: string, cleanupPaths: string[]) {
    exec(`lp "${pathToPrint}"`, (error, stdout, stderr) => {
      cleanupPaths.forEach(p => fs.unlink(p, () => {}));
      deleteSession(req.params.sessionId);
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
      deleteSession(req.params.sessionId);
      return res.status(500).json({ error: "Failed to convert document for printing." });
    }

    const convertedPath = path.join(outDir, path.basename(filePath, path.extname(filePath)) + ".pdf");

    if (!fs.existsSync(convertedPath)) {
      fs.unlink(filePath, () => {});
      deleteSession(req.params.sessionId);
      return res.status(500).json({ error: "Conversion produced no output file." });
    }

    sendToPrinter(convertedPath, [filePath, convertedPath]);
  });
});

export default router;