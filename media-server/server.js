const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsPromises = require("fs/promises");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();

const PORT = Number.parseInt(process.env.MEDIA_SERVER_PORT || "4010", 10);
const MEDIA_TOKEN = String(process.env.MEDIA_SERVER_TOKEN || "").trim();
const MEDIA_PUBLIC_BASE_URL = String(
  process.env.MEDIA_PUBLIC_BASE_URL || "https://on-field-media.napoltech.com"
).replace(/\/+$/, "");
const MEDIA_ROOT = path.resolve(
  process.env.MEDIA_ROOT || "/var/www/onfield-media/posts"
);
const originalsRoot = path.join(MEDIA_ROOT, "originals");
const imagesRoot = path.join(MEDIA_ROOT, "images");
const hlsRoot = path.join(MEDIA_ROOT, "hls");
const tempRoot = path.join(MEDIA_ROOT, "_tmp");
const ffmpegBinary = process.env.FFMPEG_PATH || "ffmpeg";
const requestTimeoutMs =
  Number.parseInt(process.env.MEDIA_SERVER_REQUEST_TIMEOUT_MS || "", 10) ||
  30 * 60 * 1000;

for (const targetDir of [MEDIA_ROOT, originalsRoot, imagesRoot, hlsRoot, tempRoot]) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tempRoot),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const uniqueId = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
    cb(null, `${uniqueId}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize:
      Number.parseInt(process.env.MEDIA_SERVER_MAX_FILE_SIZE || "", 10) ||
      20 * 1024 * 1024 * 1024,
  },
});

app.use(express.json({ limit: "10mb" }));
app.use((req, res, next) => {
  req.setTimeout(requestTimeoutMs);
  res.setTimeout(requestTimeoutMs);
  next();
});

function requireMediaToken(req, res, next) {
  if (!MEDIA_TOKEN) {
    return res.status(500).json({ error: "MEDIA_SERVER_TOKEN is not configured" });
  }

  const receivedToken = String(req.header("x-media-token") || "").trim();
  if (receivedToken !== MEDIA_TOKEN) {
    return res.status(401).json({ error: "Unauthorized media request" });
  }

  next();
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBinary, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      }
    });
  });
}

function toPublicUrl(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return `${MEDIA_PUBLIC_BASE_URL}/${normalized}`;
}

function buildSafeRelativePath(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^https?:\/\/[^/]+\/?/, "")
    .replace(/^\/+/, "");

  if (!normalized.startsWith("posts/")) {
    return null;
  }

  return normalized;
}

async function fileExists(targetPath) {
  try {
    await fsPromises.access(targetPath);
    return true;
  } catch (_) {
    return false;
  }
}

async function moveTempFile(tempPath, destinationPath) {
  await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true });
  await fsPromises.rename(tempPath, destinationPath);
}

async function createAdaptiveVideo(inputPath, outputDir) {
  await fsPromises.mkdir(outputDir, { recursive: true });

  const variants = [
    {
      name: "source",
      bandwidth: 4200000,
      scaleFilter: "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    },
    {
      name: "360p",
      bandwidth: 800000,
      scaleFilter:
        "scale=640:360:force_original_aspect_ratio=decrease:force_divisible_by=2",
    },
  ];

  for (const variant of variants) {
    const variantDir = path.join(outputDir, variant.name);
    await fsPromises.mkdir(variantDir, { recursive: true });

    const playlistPath = path.join(variantDir, "index.m3u8");
    const segmentPattern = path.join(variantDir, "segment_%03d.ts");

    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-vf",
      variant.scaleFilter,
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-b:a",
      "128k",
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-crf",
      "21",
      "-preset",
      "veryfast",
      "-sc_threshold",
      "0",
      "-g",
      "48",
      "-keyint_min",
      "48",
      "-hls_time",
      "6",
      "-hls_playlist_type",
      "vod",
      "-hls_segment_filename",
      segmentPattern,
      playlistPath,
    ]);
  }

  const masterPlaylistPath = path.join(outputDir, "master.m3u8");
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];
  for (const variant of variants) {
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth}`);
    lines.push(`${variant.name}/index.m3u8`);
  }
  await fsPromises.writeFile(masterPlaylistPath, `${lines.join("\n")}\n`, "utf8");
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "onfield-media-server",
    publicBaseUrl: MEDIA_PUBLIC_BASE_URL,
  });
});

app.post(
  "/upload-image",
  requireMediaToken,
  upload.single("media"),
  async (req, res) => {
    const tempPath = req.file?.path;

    try {
      if (!req.file) {
        return res.status(400).json({ error: "media file is required" });
      }

      if (!(req.file.mimetype || "").startsWith("image/")) {
        return res.status(400).json({ error: "Only image uploads are allowed here" });
      }

      const ext = path.extname(req.file.filename || "").toLowerCase();
      const imageId = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
      const relativePath = path.posix.join("posts", "images", `${imageId}${ext}`);
      const absolutePath = path.join(imagesRoot, `${imageId}${ext}`);

      await moveTempFile(req.file.path, absolutePath);

      return res.status(201).json({
        success: true,
        kind: "image",
        path: relativePath,
        url: toPublicUrl(relativePath),
      });
    } catch (error) {
      if (tempPath) {
        await fsPromises.unlink(tempPath).catch(() => {});
      }
      console.error("Media image upload error:", error);
      return res.status(500).json({ error: "Failed to upload image" });
    }
  }
);

app.post(
  "/upload-video",
  requireMediaToken,
  upload.single("media"),
  async (req, res) => {
    const tempPath = req.file?.path;

    try {
      if (!req.file) {
        return res.status(400).json({ error: "media file is required" });
      }

      if (!(req.file.mimetype || "").startsWith("video/")) {
        return res.status(400).json({ error: "Only video uploads are allowed here" });
      }

      const ext = path.extname(req.file.originalname || req.file.filename).toLowerCase();
      const videoId = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
      const originalRelativePath = path.posix.join(
        "posts",
        "originals",
        `${videoId}${ext}`
      );
      const originalAbsolutePath = path.join(originalsRoot, `${videoId}${ext}`);
      const hlsOutputDir = path.join(hlsRoot, videoId);
      const adaptiveRelativePath = path.posix.join(
        "posts",
        "hls",
        videoId,
        "master.m3u8"
      );

      await moveTempFile(req.file.path, originalAbsolutePath);
      await createAdaptiveVideo(originalAbsolutePath, hlsOutputDir);

      return res.status(201).json({
        success: true,
        kind: "video",
        video: {
          id: videoId,
          original: toPublicUrl(originalRelativePath),
          adaptive: toPublicUrl(adaptiveRelativePath),
          processing: false,
          status: "ready",
        },
      });
    } catch (error) {
      if (tempPath) {
        await fsPromises.unlink(tempPath).catch(() => {});
      }
      console.error("Media video upload error:", error);
      return res.status(500).json({ error: "Failed to upload video" });
    }
  }
);

app.post("/delete", requireMediaToken, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const deleted = [];

    for (const rawItem of items) {
      const relativePath = buildSafeRelativePath(rawItem);
      if (!relativePath) continue;

      const absolutePath = path.resolve(MEDIA_ROOT, relativePath.replace(/^posts\//, ""));
      if (!absolutePath.startsWith(MEDIA_ROOT)) continue;

      const exists = await fileExists(absolutePath);
      if (!exists) continue;

      const stat = await fsPromises.stat(absolutePath);
      if (stat.isDirectory()) {
        await fsPromises.rm(absolutePath, { recursive: true, force: true });
      } else {
        await fsPromises.unlink(absolutePath).catch(() => {});
      }
      deleted.push(relativePath);
    }

    return res.json({ success: true, deletedCount: deleted.length, deleted });
  } catch (error) {
    console.error("Media delete error:", error);
    return res.status(500).json({ error: "Failed to delete media" });
  }
});

app.listen(PORT, () => {
  console.log(`Media server listening on http://127.0.0.1:${PORT}`);
  console.log(`Serving public media from ${MEDIA_PUBLIC_BASE_URL}`);
});
