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
const {
  deleteRemoteMediaItems,
  isRemoteMediaEnabled,
  uploadPostImage,
  uploadPostVideo,
} = require("../services/postMediaStorage");

const MAX_POSTS = 15;
const uploadsRoot = path.join(__dirname, "..", "uploads");

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
    const isRemoteMediaReference =
      (typeof filename === "string" &&
        /^(https?:)?\/\//i.test(filename.trim())) ||
      (filename &&
        typeof filename === "object" &&
        !Array.isArray(filename) &&
        [filename.original, filename.adaptive].some(
          (value) => typeof value === "string" && /^(https?:)?\/\//i.test(value.trim())
        ));

    if (isRemoteMediaEnabled() && isRemoteMediaReference) {
      await deleteRemoteMediaItems([filename]);
      return;
    }

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

async function removeLocalUploadedFile(file) {
  const fileName = String(file?.filename || "").trim();
  if (!fileName) return;

  const targetPath = path.join(uploadsRoot, fileName);
  await fs.unlink(targetPath).catch(() => {});
}

async function uploadSavedFilesToRemoteMedia(savedFiles = []) {
  const images = [];
  const videos = [];
  const uploadedRemoteItems = [];

  try {
    for (const file of savedFiles) {
      const main = String(file?.mimetype || "").split("/")[0];

      if (main === "image") {
        const result = await uploadPostImage(file);
        images.push(result.url);
        uploadedRemoteItems.push(result.url);
        await removeLocalUploadedFile(file);
        continue;
      }

      if (main === "video") {
        const result = await uploadPostVideo(file);
        const video = result.video;
        videos.push(video);
        uploadedRemoteItems.push(video);
        await removeLocalUploadedFile(file);
        continue;
      }

      throw new Error("Only images and videos are allowed");
    }

    return { images, videos };
  } catch (error) {
    await deleteRemoteMediaItems(uploadedRemoteItems).catch(() => {});
    await Promise.all(savedFiles.map((file) => removeLocalUploadedFile(file)));
    throw error;
  }
}

async function keepOnlySavedFiles(files = []) {
  const keptFiles = [];

  for (const file of files) {
    const fileName = String(file?.filename || "").trim();
    if (!fileName) continue;

    const absolutePath = path.join(uploadsRoot, fileName);
    try {
      await fs.access(absolutePath);
      keptFiles.push(file);
    } catch (_) {
      console.warn(
        `Skipping post upload media because file was not fully saved: ${fileName}`
      );
    }
  }

  return keptFiles;
}

async function ensureAllUploadedFilesSaved(req) {
  const uploadedFiles = req.files || [];
  const savedFiles = await keepOnlySavedFiles(uploadedFiles);

  if (savedFiles.length !== uploadedFiles.length) {
    console.warn(
      `Post upload arrived partially: kept ${savedFiles.length} of ${uploadedFiles.length} files for this request.`
    );
  }

  const hasSavedImage = savedFiles.some((file) =>
    String(file?.mimetype || "").startsWith("image/")
  );
  const hasSavedVideo = savedFiles.some((file) =>
    String(file?.mimetype || "").startsWith("video/")
  );
  const requestedVideo = uploadedFiles.some((file) =>
    String(file?.mimetype || "").startsWith("video/")
  );

  return {
    files: savedFiles,
    hasSavedImage,
    hasSavedVideo,
    requestedVideo,
  };
}

router.post(
  "/posts",
  authenticateToken,
  requireRoles("admin", "super_admin", "photographer"),
  uploadPostMedia.array("media", 600),
  async (req, res) => {
  try {
    const { text, formationSize = "11" } = req.body;
    if (!["5", "7", "9", "11"].includes(String(formationSize))) {
      return res.status(400).json({ error: "formationSize يجب أن يكون 5 أو 7 أو 9 أو 11" });
    }
    const uploadResult = await ensureAllUploadedFilesSaved(req);
    const savedFiles = uploadResult.files;

    if (uploadResult.requestedVideo && !uploadResult.hasSavedVideo) {
      return res.status(408).json({
        error: "Ø±ÙØ¹ Ø§Ù„ÙÙŠØ¯ÙŠÙˆ Ù„Ù… ÙŠÙƒØªÙ…Ù„. Ø­Ø§ÙˆÙ„ Ù…Ø±Ø© Ø«Ø§Ù†ÙŠØ©ØŒ Ù„Ø£Ù† Ø§Ù„Ø³ÙŠØ±ÙØ± Ø§Ø³ØªÙ„Ù… ØµÙˆØ± ÙÙ‚Ø· Ø¨Ø¯ÙˆÙ† Ø£ÙŠ ÙÙŠØ¯ÙŠÙˆ ÙƒØ§Ù…Ù„.",
      });
    }

    const remoteMediaEnabled = isRemoteMediaEnabled();
    const { images, videos } = remoteMediaEnabled
      ? await uploadSavedFilesToRemoteMedia(savedFiles)
      : (() => {
          const localImages = [];
          const localVideos = [];

          for (const f of savedFiles) {
            const main = (f.mimetype || "").split("/")[0];
            if (main === "image") localImages.push(f.filename);
            else if (main === "video") {
              localVideos.push(createPostVideoEntry(f.filename));
            } else {
              throw new Error("Only images and videos are allowed");
            }
          }

          return { images: localImages, videos: localVideos };
        })();

    const user = await User.findByPk(Number(req.user.id), {
      attributes: ["id", "governorateId"],
    });
    const governorateId = user?.governorateId || null;

    const post = await Post.create({
      userId: Number(req.user.id),
      governorateId,
      text: text || null,
      formationSize: String(formationSize),
      media: { images, videos },
    });

    if (!remoteMediaEnabled) {
      for (const video of videos) {
        queuePostVideoProcessing({
          postId: post.id,
          videoId: video.id,
          fileName: video.original,
        });
      }
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
    const formationSize = String(req.query.formationSize || "11");
    const governorateScope = getGovernorateScope(req, { allowQuery: true });

    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }
    if (!["5", "7", "9", "11"].includes(formationSize)) {
      return res.status(400).json({ error: "formationSize يجب أن يكون 5 أو 7 أو 9 أو 11" });
    }

    const posts = await Post.findAll({
      where: applyGovernorateScope({ formationSize }, governorateScope),
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

router.get("/posts/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const post = await Post.findByPk(id);
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }
    if (!ensureGovernorateAccess(req, res, post.governorateId)) {
      return;
    }

    return res.json(post);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put(
  "/posts/:id",
  authenticateToken,
  requireRoles("admin", "super_admin", "photographer"),
  uploadPostMedia.array("media", 600),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { text, formationSize } = req.body;

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

      const uploadResult = await ensureAllUploadedFilesSaved(req);
      const savedFiles = uploadResult.files;

      if (uploadResult.requestedVideo && !uploadResult.hasSavedVideo) {
        return res.status(408).json({
          error:
            "رفع الفيديو لم يكتمل. حاول مرة ثانية، لأن السيرفر استلم صور فقط بدون أي فيديو كامل.",
        });
      }

      const remoteMediaEnabled = isRemoteMediaEnabled();
      const { images: newImages, videos: newVideos } = remoteMediaEnabled
        ? await uploadSavedFilesToRemoteMedia(savedFiles)
        : (() => {
            const localImages = [];
            const localVideos = [];

            for (const f of savedFiles) {
              const main = (f.mimetype || "").split("/")[0];
              if (main === "image") localImages.push(f.filename);
              else if (main === "video") {
                localVideos.push(createPostVideoEntry(f.filename));
              } else {
                throw new Error("Only images and videos are allowed");
              }
            }

            return { images: localImages, videos: localVideos };
          })();

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
      if (formationSize !== undefined) {
        if (!["5", "7", "9", "11"].includes(String(formationSize))) {
          return res.status(400).json({ error: "formationSize يجب أن يكون 5 أو 7 أو 9 أو 11" });
        }
        post.formationSize = String(formationSize);
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

      if (!remoteMediaEnabled) {
        for (const video of newVideos) {
          queuePostVideoProcessing({
            postId: post.id,
            videoId: video.id,
            fileName: video.original,
          });
        }
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



