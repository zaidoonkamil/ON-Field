const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { Post } = require("../models");

const uploadsRoot = path.resolve(__dirname, "..", "uploads");
const ffmpegBinary = process.env.FFMPEG_PATH || "ffmpeg";
const maxConcurrentJobs = Math.max(
  1,
  Number.parseInt(process.env.POST_VIDEO_PROCESSING_CONCURRENCY || "1", 10) ||
    1
);

const processingQueue = [];
const queuedVideoKeys = new Set();
let activeJobs = 0;

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_) {
    return false;
  }
}

async function hasUploadedSourceFile(fileName) {
  const normalizedFileName = toPosixPath(fileName).trim();
  if (!normalizedFileName) return false;
  return fileExists(path.join(uploadsRoot, normalizedFileName));
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

function createPostVideoEntry(fileName) {
  const normalized = toPosixPath(fileName).trim();
  const id = path.parse(normalized).name;

  return {
    id,
    original: normalized,
    adaptive: null,
    processing: true,
    status: "pending",
  };
}

function normalizePostVideoEntry(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const normalized = toPosixPath(value).trim();
    if (!normalized) return null;

    if (normalized.startsWith("hls/")) {
      return {
        id: normalized.split("/")[1] || path.parse(normalized).name,
        original: null,
        adaptive: normalized,
        processing: false,
        status: "ready",
      };
    }

    return createPostVideoEntry(normalized);
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const rawId = String(
      value.id ||
        value.original ||
        value.adaptive ||
        `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    ).trim();
    const original = value.original ? toPosixPath(value.original).trim() : null;
    const adaptive = value.adaptive ? toPosixPath(value.adaptive).trim() : null;
    const processing =
      typeof value.processing === "boolean"
        ? value.processing
        : !adaptive && !!original;
    const status =
      typeof value.status === "string" && value.status.trim()
        ? value.status.trim()
        : adaptive
          ? "ready"
          : processing
            ? "pending"
            : "failed";

    return {
      id: rawId,
      original: original || null,
      adaptive: adaptive || null,
      processing,
      status,
    };
  }

  return null;
}

function normalizePostVideoList(values) {
  if (!Array.isArray(values)) return [];
  return values.map(normalizePostVideoEntry).filter(Boolean);
}

function getPostVideoRemovalKey(value) {
  const video = normalizePostVideoEntry(value);
  if (!video) return "";
  return video.id || video.original || video.adaptive || "";
}

function matchesVideoRemovalKey(value, removalKey) {
  const normalizedKey = String(removalKey || "").trim();
  if (!normalizedKey) return false;

  const video = normalizePostVideoEntry(value);
  if (!video) return false;

  return [video.id, video.original, video.adaptive]
    .filter(Boolean)
    .includes(normalizedKey);
}

function buildVariantLabel(name) {
  return name;
}

async function generateVariant({
  inputPath,
  outputDir,
  name,
  bandwidth,
  scaleFilter,
}) {
  const variantDir = path.join(outputDir, name);
  await fs.mkdir(variantDir, { recursive: true });

  const playlistPath = path.join(variantDir, "index.m3u8");
  const segmentPattern = path.join(variantDir, "segment_%03d.ts");

  const args = [
    "-y",
    "-i",
    inputPath,
    "-vf",
    scaleFilter,
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
  ];

  await runFfmpeg(args);

  return {
    name,
    bandwidth,
  };
}

async function writeMasterPlaylist(outputDirName, outputDir, variants) {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];

  for (const variant of variants) {
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth}`);
    lines.push(`${variant.name}/index.m3u8`);
  }

  const masterPath = path.join(outputDir, "master.m3u8");
  await fs.writeFile(masterPath, `${lines.join("\n")}\n`, "utf8");

  return path.posix.join("hls", outputDirName, "master.m3u8");
}

async function createAdaptiveVideoFromUpload(fileName) {
  const normalizedFileName = toPosixPath(fileName).trim();
  const inputPath = path.join(uploadsRoot, normalizedFileName);
  const exists = await fileExists(inputPath);
  if (!exists) {
    throw new Error(`Uploaded file was not found: ${normalizedFileName}`);
  }

  const outputDirName = path.parse(normalizedFileName).name;
  const outputDir = path.join(uploadsRoot, "hls", outputDirName);
  await fs.mkdir(outputDir, { recursive: true });

  const variants = [
    {
      name: buildVariantLabel("source"),
      bandwidth: 4200000,
      scaleFilter: "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    },
    {
      name: buildVariantLabel("360p"),
      bandwidth: 800000,
      scaleFilter:
        "scale=640:360:force_original_aspect_ratio=decrease:force_divisible_by=2",
    },
  ];

  const generatedVariants = [];
  for (const variant of variants) {
    generatedVariants.push(
      await generateVariant({
        inputPath,
        outputDir,
        ...variant,
      })
    );
  }

  return writeMasterPlaylist(outputDirName, outputDir, generatedVariants);
}

async function removeAdaptiveVideoFiles(relativePath) {
  const normalized = toPosixPath(relativePath);
  if (!normalized.startsWith("hls/")) {
    return false;
  }

  const rootDirName = normalized.split("/")[1];
  if (!rootDirName) return false;

  const targetDir = path.join(uploadsRoot, "hls", rootDirName);
  await fs.rm(targetDir, { recursive: true, force: true });
  return true;
}

async function updatePostVideoEntry(postId, videoId, updater) {
  const post = await Post.findByPk(postId);
  if (!post) return false;

  const media = post.media || {};
  const videos = normalizePostVideoList(media.videos);
  const index = videos.findIndex((item) => item.id === videoId);
  if (index === -1) return false;

  const current = videos[index];
  const nextValue = await updater(current);
  if (!nextValue) return false;

  videos[index] = normalizePostVideoEntry(nextValue);
  post.media = {
    ...media,
    videos,
  };
  await post.save();
  return true;
}

async function processQueuedVideoJob(job) {
  const { postId, videoId, fileName } = job;

  try {
    const sourceExists = await hasUploadedSourceFile(fileName);
    if (!sourceExists) {
      await updatePostVideoEntry(postId, videoId, (current) => ({
        ...current,
        processing: false,
        status: "missing_source",
      }));

      console.warn(
        `Skipping adaptive processing for post ${postId}, video ${videoId}: source file not found (${fileName})`
      );
      return;
    }

    const adaptivePath = await createAdaptiveVideoFromUpload(fileName);

    await updatePostVideoEntry(postId, videoId, (current) => ({
      ...current,
      adaptive: adaptivePath,
      processing: false,
      status: "ready",
    }));

    console.log(
      `Adaptive post video ready for post ${postId}, video ${videoId}: ${adaptivePath}`
    );
  } catch (error) {
    await updatePostVideoEntry(postId, videoId, (current) => ({
      ...current,
      processing: false,
      status: "failed",
    }));

    console.error(
      `Adaptive post video processing failed for post ${postId}, video ${videoId} (${fileName}):`,
      error.message
    );
  }
}

function processVideoQueue() {
  while (activeJobs < maxConcurrentJobs && processingQueue.length > 0) {
    const job = processingQueue.shift();
    if (!job) return;

    const queueKey = `${job.postId}:${job.videoId}`;
    activeJobs += 1;

    processQueuedVideoJob(job)
      .catch((error) => {
        console.error("Unexpected post video queue error:", error);
      })
      .finally(() => {
        queuedVideoKeys.delete(queueKey);
        activeJobs = Math.max(0, activeJobs - 1);
        processVideoQueue();
      });
  }
}

function queuePostVideoProcessing({ postId, videoId, fileName }) {
  const normalizedFileName = toPosixPath(fileName).trim();
  if (!postId || !videoId || !normalizedFileName) return false;

  const queueKey = `${postId}:${videoId}`;
  if (queuedVideoKeys.has(queueKey)) {
    return false;
  }

  queuedVideoKeys.add(queueKey);
  processingQueue.push({
    postId,
    videoId,
    fileName: normalizedFileName,
  });

  setImmediate(processVideoQueue);
  return true;
}

module.exports = {
  createAdaptiveVideoFromUpload,
  createPostVideoEntry,
  getPostVideoRemovalKey,
  hasUploadedSourceFile,
  matchesVideoRemovalKey,
  normalizePostVideoEntry,
  normalizePostVideoList,
  queuePostVideoProcessing,
  removeAdaptiveVideoFiles,
};
