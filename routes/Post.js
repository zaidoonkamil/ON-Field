const express = require("express");
const router = express.Router();
const uploadPostMedia = require("../middlewares/uploads");
const { Post } = require("../models");
const path = require("path");
const fs = require("fs/promises");

const MAX_POSTS = 15;

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

function parseMediaList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [trimmed];
    } catch (e) {
      return [trimmed];
    }
  }

  return [];
}

async function safeDeleteFile(filename) {
  try {
    const filePath = path.join(__dirname, "..", "uploads", filename);
    await fs.unlink(filePath);
  } catch (e) {}
}

router.post("/posts", uploadPostMedia.array("media", 100), async (req, res) => {
  try {
    const { userId, text } = req.body;
    const images = [];
    const videos = [];

    for (const f of req.files || []) {
      const main = (f.mimetype || "").split("/")[0];
      if (main === "image") images.push(f.filename);
      else if (main === "video") videos.push(f.filename);
      else return res.status(400).json({ error: "مسموح فقط صور وفيديوات" });
    }

    const post = await Post.create({
      userId: userId ? Number(userId) : null,
      text: text || null,
      media: { images, videos },
    });

    await enforceMaxPosts();
    return res.status(201).json(post);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/posts", async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 30;
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

router.put("/posts/:id", uploadPostMedia.array("media", 100), async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    const post = await Post.findByPk(id);
    if (!post) {
      return res.status(404).json({ error: "المنشور غير موجود" });
    }

    const currentImages = post.media?.images || [];
    const currentVideos = post.media?.videos || [];
    const removeImages = parseMediaList(req.body.removeImages);
    const removeVideos = parseMediaList(req.body.removeVideos);

    const invalidRemoveImage = removeImages.find((name) => !currentImages.includes(name));
    if (invalidRemoveImage) {
      return res.status(400).json({ error: "صورة مطلوبة للحذف غير موجودة داخل المنشور" });
    }

    const invalidRemoveVideo = removeVideos.find((name) => !currentVideos.includes(name));
    if (invalidRemoveVideo) {
      return res.status(400).json({ error: "فيديو مطلوب للحذف غير موجود داخل المنشور" });
    }

    const newImages = [];
    const newVideos = [];

    for (const f of req.files || []) {
      const main = (f.mimetype || "").split("/")[0];
      if (main === "image") newImages.push(f.filename);
      else if (main === "video") newVideos.push(f.filename);
      else return res.status(400).json({ error: "مسموح فقط صور وفيديوات" });
    }

    post.media = {
      images: currentImages.filter((name) => !removeImages.includes(name)).concat(newImages),
      videos: currentVideos.filter((name) => !removeVideos.includes(name)).concat(newVideos),
    };

    if (text !== undefined) {
      post.text = text;
    }

    await post.save();

    for (const f of [...removeImages, ...removeVideos]) {
      await safeDeleteFile(f);
    }

    return res.status(200).json(post);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/posts/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const post = await Post.findByPk(id);
    if (!post) {
      return res.status(404).json({ error: "المنشور غير موجود" });
    }

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
