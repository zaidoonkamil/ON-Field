const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = "uploads";

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + path.extname(file.originalname).toLowerCase());
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = file.mimetype || "";

    const isImage = mime.startsWith("image/");
    const isVideo = mime.startsWith("video/");
    const isAudio = mime.startsWith("audio/");

    if (!isImage && !isVideo && !isAudio) {
      return cb(new Error("❌ مسموح فقط رفع صور أو فيديوات أو ملفات صوتية"), false);
    }

    cb(null, true);
  },
});

module.exports = upload;
