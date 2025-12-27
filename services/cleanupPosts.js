const cron = require("node-cron");
const path = require("path");
const fs = require("fs/promises");
const { Op } = require("sequelize");
const { Post } = require("../models");

async function safeDeleteFile(filename) {
  try {
    const filePath = path.join(__dirname, "..", "uploads", filename);
    await fs.unlink(filePath);
  } catch (e) {
  }
}

async function cleanupOldPosts() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); 

  const oldPosts = await Post.findAll({
    where: { createdAt: { [Op.lt]: cutoff } },
  });

  for (const post of oldPosts) {
    const files = post.media?.files || [];
    for (const f of files) await safeDeleteFile(f);
    await post.destroy();
  }

  console.log(`🧹 Cleanup done. Deleted ${oldPosts.length} old posts`);
}

function startCleanupJob() {
  cron.schedule("10 3 * * *", () => {
    cleanupOldPosts().catch(err => console.error("Cleanup error:", err));
  });
}

module.exports = { startCleanupJob, cleanupOldPosts };
