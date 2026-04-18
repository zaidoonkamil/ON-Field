const { Post } = require("../models");
const { createAdaptiveVideoFromUpload } = require("./videoStreaming");

let migrationStarted = false;

function isAdaptiveVideoPath(value) {
  return String(value || "").replace(/\\/g, "/").startsWith("hls/");
}

async function migrateLegacyPostVideosToAdaptiveStreaming() {
  const posts = await Post.findAll({
    order: [["id", "ASC"]],
  });

  let migratedPosts = 0;
  let migratedVideos = 0;

  for (const post of posts) {
    const media = post.media || {};
    const videos = Array.isArray(media.videos) ? [...media.videos] : [];
    let changed = false;

    for (let index = 0; index < videos.length; index += 1) {
      const rawVideo = videos[index];
      if (!rawVideo || isAdaptiveVideoPath(rawVideo)) {
        continue;
      }

      try {
        const adaptiveVideoPath = await createAdaptiveVideoFromUpload(rawVideo);
        videos[index] = adaptiveVideoPath;
        changed = true;
        migratedVideos += 1;
      } catch (error) {
        console.error(
          `Legacy post video migration failed for post ${post.id} (${rawVideo}):`,
          error.message
        );
      }
    }

    if (!changed) {
      continue;
    }

    post.media = {
      ...media,
      videos,
    };

    await post.save();
    migratedPosts += 1;
  }

  console.log(
    `Adaptive post video migration finished. Updated ${migratedPosts} posts and converted ${migratedVideos} videos.`
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
