import multer from "multer";
import path from "path";
import fs from "fs";

const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED = [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".jpg", ".jpeg", ".png"];

export const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED.includes(path.extname(file.originalname).toLowerCase())),
});

// Remove leftovers from abandoned print sessions (older than 1 hour)
function cleanOldUploads() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const f of fs.readdirSync(uploadDir)) {
    const p = path.join(uploadDir, f);
    try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch {}
  }
}
cleanOldUploads();
setInterval(cleanOldUploads, 30 * 60 * 1000);