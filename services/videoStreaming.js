const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const uploadsRoot = path.resolve(__dirname, "..", "uploads");
const ffmpegBinary = process.env.FFMPEG_PATH || "ffmpeg";

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_) {
    return false;
  }
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

function buildVariantLabel(height) {
  return `${height}p`;
}

async function generateVariant({
  inputPath,
  outputDir,
  height,
  width,
  bandwidth,
  name,
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
    `scale=-2:${height}:force_original_aspect_ratio=decrease`,
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-b:a",
    "128k",
    "-c:v",
    "libx264",
    "-profile:v",
    "main",
    "-crf",
    "21",
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
    height,
    width,
    bandwidth,
    playlistRelativePath: path.posix.join(
      path.basename(outputDir),
      name,
      "index.m3u8"
    ),
  };
}

async function writeMasterPlaylist(outputDirName, outputDir, variants) {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];

  for (const variant of variants) {
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${variant.width}x${variant.height}`
    );
    lines.push(`${variant.name}/index.m3u8`);
  }

  const masterPath = path.join(outputDir, "master.m3u8");
  await fs.writeFile(masterPath, `${lines.join("\n")}\n`, "utf8");

  return path.posix.join("hls", outputDirName, "master.m3u8");
}

async function createAdaptiveVideoFromUpload(fileName) {
  const inputPath = path.join(uploadsRoot, fileName);
  const exists = await fileExists(inputPath);
  if (!exists) {
    throw new Error(`Uploaded file was not found: ${fileName}`);
  }

  const outputDirName = path.parse(fileName).name;
  const outputDir = path.join(uploadsRoot, "hls", outputDirName);
  await fs.mkdir(outputDir, { recursive: true });

  const variants = [
    { height: 360, width: 640, bandwidth: 800000, name: buildVariantLabel(360) },
    { height: 480, width: 854, bandwidth: 1400000, name: buildVariantLabel(480) },
    { height: 720, width: 1280, bandwidth: 2800000, name: buildVariantLabel(720) },
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

  const masterRelativePath = await writeMasterPlaylist(
    outputDirName,
    outputDir,
    generatedVariants
  );

  try {
    await fs.unlink(inputPath);
  } catch (_) {}

  return masterRelativePath;
}

async function removeAdaptiveVideoFiles(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  if (!normalized.startsWith("hls/")) {
    return false;
  }

  const rootDirName = normalized.split("/")[1];
  if (!rootDirName) return false;

  const targetDir = path.join(uploadsRoot, "hls", rootDirName);
  await fs.rm(targetDir, { recursive: true, force: true });
  return true;
}

module.exports = {
  createAdaptiveVideoFromUpload,
  removeAdaptiveVideoFiles,
};
