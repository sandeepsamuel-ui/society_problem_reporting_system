// Shared photo upload handling (JPG / PNG / WebP, max 5 MB) into backend/uploads.
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + ALLOWED[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, Boolean(ALLOWED[file.mimetype])),
});

function mimeFromPath(p) {
  const ext = path.extname(p).toLowerCase();
  return { '.png': 'image/png', '.webp': 'image/webp' }[ext] || 'image/jpeg';
}

module.exports = { upload, UPLOAD_DIR, mimeFromPath };
