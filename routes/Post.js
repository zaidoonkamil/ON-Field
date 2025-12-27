const express = require("express");
const router = express.Router();
const uploadPostMedia = require("../middlewares/uploads");
const { Post } = require("../models");
const path = require("path");
const fs = require("fs/promises");
const multer = require("multer");
const upload = multer();


router.post("/posts", uploadPostMedia.array("media", 10), async (req, res) => {
  try {
    const { userId, text, type } = req.body;

    if (!type) return res.status(400).json({ error: "type مطلوب" });
    if (!["image", "video"].includes(type)) {
      return res.status(400).json({ error: "type لازم image أو video" });
    }
    if (!req.files?.length) return res.status(400).json({ error: "لازم ترفع صورة/فيديو" });

    const files = req.files.map((f) => f.filename);

    const post = await Post.create({
      userId: userId ? Number(userId) : null, 
      text: text || null,
      type,
      media: { files },
    });

    return res.status(201).json(post);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
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

    const files = post.media?.files || [];
    for (const f of files) {
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