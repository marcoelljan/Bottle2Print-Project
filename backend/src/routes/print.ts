import { Router } from "express";
import fs from "fs";
import { exec } from "child_process";
import pdfParse from "pdf-parse";
import { db } from "../db";
import { upload } from "../upload";

const router = Router();

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
  exec(`lp "${filePath}"`, (error, stdout, stderr) => {
    fs.unlink(filePath, () => {});
    if (error) return res.status(500).json({ error: stderr || error.message });

    db.prepare("UPDATE users SET credits = credits - ? WHERE rfid = ?").run(pages, rfid);
    db.prepare(`INSERT INTO transactions (rfid, type, credits) VALUES (?, 'print', ?)`).run(rfid, pages);

    res.json({ success: true, output: stdout.trim() });
  });
});

export default router;