const { Post } = require("../models");
const {
  hasUploadedSourceFile,
  normalizePostVideoEntry,
  normalizePostVideoList,
  queuePostVideoProcessing,
} = require("./videoStreaming");

let migrationStarted = false;

async function migrateLegacyPostVideosToAdaptiveStreaming() {
  const posts = await Post.findAll({
    order: [["id", "ASC"]],
  });

  let updatedPosts = 0;
  let queuedVideos = 0;

  for (const post of posts) {
    const media = post.media || {};
    const originalVideos = Array.isArray(media.videos) ? media.videos : [];
    const normalizedVideos = normalizePostVideoList(originalVideos);

    let changed = normalizedVideos.length !== originalVideos.length;

    for (let index = 0; index < normalizedVideos.length; index += 1) {
      const current = normalizedVideos[index];
      const originalValue = originalVideos[index];
      const normalizedOriginal = normalizePostVideoEntry(originalValue);

      if (
        JSON.stringify(current) !== JSON.stringify(normalizedOriginal)
      ) {
        changed = true;
      }

      const needsProcessing =
        !!current.original &&
        !current.adaptive &&
        (current.processing || current.status === "pending");

      if (needsProcessing) {
        const sourceExists = await hasUploadedSourceFile(current.original);
        if (!sourceExists) {
          normalizedVideos[index] = {
            ...current,
            processing: false,
            status: "missing_source",
          };
          changed = true;
          continue;
        }

        if (
          queuePostVideoProcessing({
            postId: post.id,
            videoId: current.id,
            fileName: current.original,
          })
        ) {
          queuedVideos += 1;
        }
      }
    }

    if (!changed) {
      continue;
    }

    post.media = {
      ...media,
      videos: normalizedVideos,
    };

    await post.save();
    updatedPosts += 1;
  }

  console.log(
    `Adaptive post video migration finished. Updated ${updatedPosts} posts and queued ${queuedVideos} videos.`
  );
}

function startPostVideoMigration() {
  if (migrationStarted) return;
  migrationStarted = true;

  setTimeout(() => {
    migrateLegacyPostVideosToAdaptiveStreaming().catch((error) => {
      console.error("Adaptive post video migration error:", error);
      migrationStarted = false;
    });
  }, 1500);
}

module.exports = {
  migrateLegacyPostVideosToAdaptiveStreaming,
  startPostVideoMigration,
};
