const express = require("express");
const router = express.Router();
const { LiveStream } = require("../models");
const multer = require("multer");
const upload = multer();

router.post("/live", upload.none(), async (req, res) => {
  try {
    const { title, youtubeVideoId, isActive = true } = req.body;

    if (!youtubeVideoId) {
      return res.status(400).json({ error: "youtubeVideoId مطلوب" });
    }

    const live = await LiveStream.create({
      title: title || null,
      youtubeVideoId,
      isActive: Boolean(isActive),
    });

    return res.status(201).json(live);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/live", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const lives = await LiveStream.findAll({
      where: { isActive: true },
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    return res.status(200).json({
      data: lives,
      pagination: {
        page,
        limit,
        count: lives.length,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/live/:id/stop", async (req, res) => {
  try {
    const { id } = req.params;

    const live = await LiveStream.findByPk(id);
    if (!live) return res.status(404).json({ error: "البث غير موجود" });

    live.isActive = false;
    await live.save();

    return res.json({ message: "تم إيقاف البث داخل النظام", id: Number(id) });
  } catch (e) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/live/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const live = await LiveStream.findByPk(id);
    if (!live) return res.status(404).json({ error: "البث غير موجود" });

    await live.destroy();

    return res.status(200).json({ message: "تم حذف البث من النظام", id: Number(id) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
