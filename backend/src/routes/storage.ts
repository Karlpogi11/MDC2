import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID as uuid } from "node:crypto";
import { authMiddleware } from "../middleware/auth";

export const storageRouter = Router();

// Vercel's deployed filesystem is read-only except /tmp. Local dev keeps
// using a real uploads/ folder; on Vercel we fall back to /tmp so the
// module doesn't crash on import (which used to take down every route).
const UPLOAD_DIR = process.env.VERCEL
  ? path.join("/tmp", "uploads", "branding")
  : path.resolve(process.cwd(), "uploads/branding");

try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (err) {
  console.error("Failed to create upload dir:", err);
}

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