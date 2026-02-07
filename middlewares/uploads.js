const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
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
    fileSize: 100000 * 1024 * 1024, // 100GB (انتبه كبير)
  },
  fileFilter: (req, file, cb) => {
    const mime = file.mimetype || "";
    const isImage = mime.startsWith("image/");
    const isVideo = mime.startsWith("video/");

    if (!isImage && !isVideo) {
      // ✅ LOG هنا (راح يطلع بـ pm2 logs)
      console.error("UPLOAD REJECTED (invalid type):", {
        ip: req.ip,
        originalname: file.originalname,
        mimetype: file.mimetype,
      });

      // الأفضل نرجع Error عادي ونمسكه بالراوتر
      return cb(new Error("❌ مسموح فقط رفع صور أو فيديوات"));
    }

    cb(null, true);
  },
});

module.exports = upload;
