import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID as uuid } from "node:crypto";
import { authMiddleware } from "../middleware/auth";

export const storageRouter = Router();

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads/branding");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({ storage: multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `${uuid()}${ext}`);
  },
}),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PNG, JPG, SVG, or WebP allowed."));
    }
  },
});

storageRouter.post("/branding/upload", authMiddleware, (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const base = `${req.protocol}://${req.get("host")}`;
    const url = `${base}/uploads/branding/${req.file.filename}`;
    res.json({ url });
  });
});
