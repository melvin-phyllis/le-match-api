const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = "uploads/messages";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const imageFilter = (req, file, cb) => {
  // Accepter tout ce qui commence par image/
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Type de fichier non supporté"), false);
  }
};

const upload = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const uploadDir2 = "uploads/audio";
if (!fs.existsSync(uploadDir2)) fs.mkdirSync(uploadDir2, { recursive: true });

const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/audio"),
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.m4a`);
  },
});

const audioFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("audio/")) cb(null, true);
  else cb(new Error("Type non supporté"), false);
};

const uploadAudio = multer({
  storage: audioStorage,
  fileFilter: audioFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
});

module.exports = upload;
module.exports.uploadAudio = uploadAudio;
