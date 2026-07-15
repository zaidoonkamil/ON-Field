const axios = require("axios");
const fs = require("fs");
const path = require("path");

const MEDIA_SERVER_BASE_URL = String(
  process.env.MEDIA_SERVER_BASE_URL || ""
).trim().replace(/\/+$/, "");
const MEDIA_SERVER_TOKEN = String(process.env.MEDIA_SERVER_TOKEN || "").trim();

function isRemoteMediaEnabled() {
  return Boolean(MEDIA_SERVER_BASE_URL && MEDIA_SERVER_TOKEN);
}

function createMediaClient() {
  return axios.create({
    baseURL: MEDIA_SERVER_BASE_URL,
    timeout:
      Number.parseInt(process.env.MEDIA_SERVER_REQUEST_TIMEOUT_MS || "", 10) ||
      30 * 60 * 1000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    headers: {
      "x-media-token": MEDIA_SERVER_TOKEN,
    },
  });
}

function createMultipartFormData(file) {
  const FormData = require("form-data");
  const form = new FormData();
  form.append("media", fs.createReadStream(file.path), {
    filename: file.originalname || path.basename(file.path),
    contentType: file.mimetype || "application/octet-stream",
    knownLength: file.size,
  });
  return form;
}

async function uploadPostImage(file) {
  if (!isRemoteMediaEnabled()) {
    throw new Error("Remote media server is not configured");
  }

  const form = createMultipartFormData(file);
  const client = createMediaClient();
  const response = await client.post("/upload-image", form, {
    headers: form.getHeaders(),
  });
  return response.data;
}

async function uploadPostVideo(file) {
  if (!isRemoteMediaEnabled()) {
    throw new Error("Remote media server is not configured");
  }

  const form = createMultipartFormData(file);
  const client = createMediaClient();
  const response = await client.post("/upload-video", form, {
    headers: form.getHeaders(),
  });
  return response.data;
}

function extractMediaDeleteTargets(value) {
  if (!value) return [];

  if (typeof value === "string") {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return [value];
    }
    return [];
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const targets = [];
    if (value.original) targets.push(value.original);
    if (value.adaptive) {
      targets.push(value.adaptive);

      const adaptiveUrl = String(value.adaptive);
      const segments = adaptiveUrl.split("/");
      const hlsIndex = segments.findIndex((segment) => segment === "hls");
      if (hlsIndex >= 0 && segments.length > hlsIndex + 1) {
        const prefix = segments.slice(0, hlsIndex + 2).join("/");
        targets.push(prefix);
      }
    }
    return targets;
  }

  return [];
}

async function deleteRemoteMediaItems(items = []) {
  if (!isRemoteMediaEnabled()) return;

  const deleteTargets = [...new Set(items.flatMap(extractMediaDeleteTargets).filter(Boolean))];
  if (!deleteTargets.length) return;

  const client = createMediaClient();
  await client.post("/delete", { items: deleteTargets });
}

module.exports = {
  deleteRemoteMediaItems,
  isRemoteMediaEnabled,
  uploadPostImage,
  uploadPostVideo,
};
