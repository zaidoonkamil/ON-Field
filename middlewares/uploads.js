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
    cb(
      null,
      Date.now() +
        "-" +
        Math.round(Math.random() * 1e9) +
        path.extname(file.originalname).toLowerCase()
    );
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100000 * 1024 * 1024, // 100GB 😅
  },
  fileFilter: (req, file, cb) => {
    try {
      const mime = file.mimetype || "";

      const isImage = mime.startsWith("image/");
      const isVideo = mime.startsWith("video/");

      if (!isImage && !isVideo) {
        // 🔴 LOG هنا
        console.error("MULTER FILE TYPE ERROR:", {
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
        });

        return cb(
          new multer.MulterError(
            "LIMIT_UNEXPECTED_FILE",
            "❌ مسموح فقط رفع صور أو فيديوات"
          ),
          false
        );
      }

      cb(null, true);
    } catch (err) {
      // 🔥 أي خطأ غير متوقع
      console.error("MULTER UNKNOWN ERROR:", err);
      cb(err, false);
    }
  },
});

// 🔴 Global multer error logger (اختياري لكن قوي)
upload.on("error", (err) => {
  console.error("MULTER GLOBAL ERROR:", {
    message: err.message,
    code: err.code,
    stack: err.stack,
  });
});

module.exports = upload;
