const express = require("express");
const router = express.Router();
const uploadPostMedia = require("../middlewares/uploads");
const { Post } = require("../models");
const path = require("path");
const fs = require("fs/promises");
const multer = require("multer");
const upload = multer();

const MAX_POSTS = 20;

async function deletePostWithFiles(post) {
  const images = post.media?.images || [];
  const videos = post.media?.videos || [];

  for (const f of [...images, ...videos]) {
    await safeDeleteFile(f);
  }

  await post.destroy();
}

async function enforceMaxPosts() {
  const count = await Post.count();
  if (count <= MAX_POSTS) return;

  const toDeleteCount = count - MAX_POSTS;

  const oldPosts = await Post.findAll({
    order: [["createdAt", "ASC"]],
    limit: toDeleteCount,
  });

  for (const p of oldPosts) {
    await deletePostWithFiles(p);
  }
}

router.post("/posts", (req, res) => {
  uploadPostMedia.array("media", 50)(req, res, async (err) => {
    if (err) {
      // 🔴 log أي خطأ بالرفع
      console.error("Upload Error:", {
        message: err.message,
        code: err.code,
        stack: err.stack,
      });

      return res.status(400).json({
        error: "خطأ أثناء رفع الملفات",
        details: err.message,
      });
    }

    try {
      const { userId, text } = req.body;

      if (!req.files?.length) {
        console.error("Upload Error: No files uploaded", {
          userId,
          body: req.body,
        });

        return res.status(400).json({ error: "لازم ترفع صور/فيديوات" });
      }

      const images = [];
      const videos = [];

      for (const f of req.files) {
        const main = (f.mimetype || "").split("/")[0];

        if (main === "image") images.push(f.filename);
        else if (main === "video") videos.push(f.filename);
        else {
          console.error("Invalid file type:", {
            filename: f.originalname,
            mimetype: f.mimetype,
          });

          return res.status(400).json({ error: "مسموح فقط صور وفيديوات" });
        }
      }

      const post = await Post.create({
        userId: userId ? Number(userId) : null,
        text: text || null,
        media: { images, videos },
      });

      await enforceMaxPosts();

      return res.status(201).json(post);
    } catch (e) {
      // 🔥 أي خطأ داخل السيرفر
      console.error("Post Create Error:", {
        message: e.message,
        stack: e.stack,
        body: req.body,
      });

      return res.status(500).json({ error: "Internal Server Error" });
    }
  });
});


router.get("/posts", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const offset = (page - 1) * limit;

    const posts = await Post.findAll({
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    return res.json(posts);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

async function safeDeleteFile(filename) {
  try {
    const filePath = path.join(__dirname, "..", "uploads", filename);
    await fs.unlink(filePath);
  } catch (e) {
  }
}

router.delete("/posts/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const post = await Post.findByPk(id);
    if (!post) return res.status(404).json({ error: "المنشور غير موجود" });

    const images = post.media?.images || [];
    const videos = post.media?.videos || [];

    for (const f of [...images, ...videos]) {
      await safeDeleteFile(f);
    }

    await post.destroy();
    return res.status(200).json({ message: "تم حذف المنشور بنجاح" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});


module.exports = router;