const express = require("express");
const router = express.Router();
const uploadPostMedia = require("../middlewares/uploads");
const { Post, User } = require("../models");
const {
  authenticateToken,
  optionalAuthenticateToken,
} = require("../middlewares/auth");
const { requireRoles } = require("../middlewares/authorization");
const {
  getGovernorateScope,
  applyGovernorateScope,
  ensureGovernorateAccess,
} = require("../services/accessScope");
const path = require("path");
const fs = require("fs/promises");
const {
  createPostVideoEntry,
  matchesVideoRemovalKey,
  normalizePostVideoList,
  queuePostVideoProcessing,
  removeAdaptiveVideoFiles,
} = require("../services/videoStreaming");

const MAX_POSTS = 15;

async function deletePostWithFiles(post) {
  const images = post.media?.images || [];
  const videos = normalizePostVideoList(post.media?.videos);

  for (const f of [...images, ...videos]) {
    await safeDeleteFile(f);
  }

  await post.destroy();
}

async function enforceMaxPosts(governorateId) {
  const where = governorateId ? { governorateId } : {};
  const count = await Post.count({ where });
  if (count <= MAX_POSTS) return;

  const toDeleteCount = count - MAX_POSTS;
  const oldPosts = await Post.findAll({
    where,
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
    } catch (_) {
      return [trimmed];
    }
  }

  return [];
}

async function safeDeleteFile(filename) {
  try {
    if (filename && typeof filename === "object" && !Array.isArray(filename)) {
      if (filename.adaptive) {
        await removeAdaptiveVideoFiles(filename.adaptive);
      }

      if (filename.original) {
        const originalPath = path.join(__dirname, "..", "uploads", filename.original);
        await fs.unlink(originalPath).catch(() => {});
      }
      return;
    }

    const deletedAdaptiveVideo = await removeAdaptiveVideoFiles(filename);
    if (deletedAdaptiveVideo) return;

    const filePath = path.join(__dirname, "..", "uploads", filename);
    await fs.unlink(filePath);
  } catch (_) {}
}

router.post(
  "/posts",
  authenticateToken,
  requireRoles("admin", "super_admin", "photographer"),
  uploadPostMedia.array("media", 300),
  async (req, res) => {
  try {
    const { text } = req.body;
    const images = [];
    const videos = [];

    for (const f of req.files || []) {
      const main = (f.mimetype || "").split("/")[0];
      if (main === "image") images.push(f.filename);
      else if (main === "video") {
        videos.push(createPostVideoEntry(f.filename));
      } else {
        return res.status(400).json({ error: "Only images and videos are allowed" });
      }
    }

    const user = await User.findByPk(Number(req.user.id), {
      attributes: ["id", "governorateId"],
    });
    const governorateId = user?.governorateId || null;

    const post = await Post.create({
      userId: Number(req.user.id),
      governorateId,
      text: text || null,
      media: { images, videos },
    });

    for (const video of videos) {
      queuePostVideoProcessing({
        postId: post.id,
        videoId: video.id,
        fileName: video.original,
      });
    }

    await enforceMaxPosts(governorateId);
    return res.status(201).json(post);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/posts", optionalAuthenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 30;
    const offset = (page - 1) * limit;
    const governorateScope = getGovernorateScope(req, { allowQuery: true });

    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }

    const posts = await Post.findAll({
      where: applyGovernorateScope({}, governorateScope),
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

router.put(
  "/posts/:id",
  authenticateToken,
  requireRoles("admin", "super_admin", "photographer"),
  uploadPostMedia.array("media", 300),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { text } = req.body;

      const post = await Post.findByPk(id);
      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }
      if (!ensureGovernorateAccess(req, res, post.governorateId)) {
        return;
      }

      const currentImages = post.media?.images || [];
      const currentVideos = normalizePostVideoList(post.media?.videos);
      const removeImages = parseMediaList(req.body.removeImages);
      const removeVideos = parseMediaList(req.body.removeVideos);

      const invalidRemoveImage = removeImages.find(
        (name) => !currentImages.includes(name)
      );
      if (invalidRemoveImage) {
        return res.status(400).json({ error: "Image to remove does not exist" });
      }

      const invalidRemoveVideo = removeVideos.find((name) =>
        !currentVideos.some((video) => matchesVideoRemovalKey(video, name))
      );
      if (invalidRemoveVideo) {
        return res.status(400).json({ error: "Video to remove does not exist" });
      }

      const newImages = [];
      const newVideos = [];

      for (const f of req.files || []) {
        const main = (f.mimetype || "").split("/")[0];
        if (main === "image") newImages.push(f.filename);
        else if (main === "video") {
          newVideos.push(createPostVideoEntry(f.filename));
        } else {
          return res.status(400).json({ error: "Only images and videos are allowed" });
        }
      }

      post.media = {
        images: currentImages.filter((name) => !removeImages.includes(name)).concat(newImages),
        videos: currentVideos
          .filter(
            (video) =>
              !removeVideos.some((removalKey) =>
                matchesVideoRemovalKey(video, removalKey)
              )
          )
          .concat(newVideos),
      };

      if (text !== undefined) {
        post.text = text;
      }

      await post.save();

      for (const f of [...removeImages, ...removeVideos]) {
        if (removeVideos.includes(f)) {
          const matchedVideo = currentVideos.find((video) =>
            matchesVideoRemovalKey(video, f)
          );
          await safeDeleteFile(matchedVideo || f);
        } else {
          await safeDeleteFile(f);
        }
      }

      for (const video of newVideos) {
        queuePostVideoProcessing({
          postId: post.id,
          videoId: video.id,
          fileName: video.original,
        });
      }

      return res.status(200).json(post);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

router.delete(
  "/posts/:id",
  authenticateToken,
  requireRoles("admin", "super_admin", "photographer"),
  async (req, res) => {
  try {
    const { id } = req.params;

    const post = await Post.findByPk(id);
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }
    if (!ensureGovernorateAccess(req, res, post.governorateId)) {
      return;
    }

    const images = post.media?.images || [];
    const videos = normalizePostVideoList(post.media?.videos);

    for (const f of [...images, ...videos]) {
      await safeDeleteFile(f);
    }

    await post.destroy();
    return res.status(200).json({ message: "Post deleted successfully" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
