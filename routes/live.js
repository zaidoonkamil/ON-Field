const express = require("express");
const router = express.Router();
const { LiveStream } = require("../models");
const multer = require("multer");
const { authenticateToken, optionalAuthenticateToken } = require("../middlewares/auth");
const {
  isAdmin,
  isSuperAdmin,
  getGovernorateScope,
  applyGovernorateScope,
  ensureGovernorateAccess,
} = require("../services/accessScope");
const upload = multer();

router.post("/live", authenticateToken, upload.none(), async (req, res) => {
  try {
    const { title, youtubeVideoId, isActive = true } = req.body;

    if (!isAdmin(req.user) && !isSuperAdmin(req.user)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    if (!youtubeVideoId) {
      return res.status(400).json({ error: "youtubeVideoId is required" });
    }

    const live = await LiveStream.create({
      title: title || null,
      youtubeVideoId,
      isActive: Boolean(isActive),
      governorateId: req.user.governorateId || null,
    });

    return res.status(201).json(live);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/live", optionalAuthenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;
    const governorateScope = getGovernorateScope(req, { allowQuery: true });

    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }

    const lives = await LiveStream.findAll({
      where: applyGovernorateScope({ isActive: true }, governorateScope),
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

router.post("/live/:id/stop", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const live = await LiveStream.findByPk(id);
    if (!live) return res.status(404).json({ error: "Live stream not found" });
    if (!ensureGovernorateAccess(req, res, live.governorateId)) {
      return;
    }

    live.isActive = false;
    await live.save();

    return res.json({ message: "Live stream stopped", id: Number(id) });
  } catch (e) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/live/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const live = await LiveStream.findByPk(id);
    if (!live) return res.status(404).json({ error: "Live stream not found" });
    if (!ensureGovernorateAccess(req, res, live.governorateId)) {
      return;
    }

    await live.destroy();

    return res
      .status(200)
      .json({ message: "Live stream deleted", id: Number(id) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
