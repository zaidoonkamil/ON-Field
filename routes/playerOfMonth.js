const express = require("express");
const router = express.Router();
const { PlayerOfMonth, User, PlayerMatchStats } = require("../models");
const { authenticateToken, optionalAuthenticateToken } = require("../middlewares/auth");
const uploadImage = require("../middlewares/uploads");
const {
  isAdmin,
  isSuperAdmin,
  getGovernorateScope,
  applyGovernorateScope,
  ensureGovernorateAccess,
} = require("../services/accessScope");

const calcOverall = (u) =>
  Math.round((u.spd + u.fin + u.pas + u.skl + u.tkl + u.str) / 6);

router.post("/player-of-month", authenticateToken, uploadImage.single("image"), async (req, res) => {
  try {
    if (!isAdmin(req.user) && !isSuperAdmin(req.user)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const { userId, note } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const now = new Date();
    const selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const user = await User.findByPk(userId, {
      attributes: { exclude: ["password"] },
    });

    if (!user) {
      return res.status(404).json({ error: "Player not found" });
    }
    if (!ensureGovernorateAccess(req, res, user.governorateId)) {
      return;
    }
    if (user.role === "admin" || user.role === "super_admin") {
      return res.status(400).json({ error: "Admin cannot be player of the month" });
    }

    const file = req.file;
    const imageData = file ? { main: file.filename } : null;

    const existing = await PlayerOfMonth.findOne({
      where: {
        month: selectedMonth,
        governorateId: req.user.governorateId || user.governorateId || null,
      },
    });

    if (existing) {
      const updateObj = {
        userId: user.id,
        governorateId: req.user.governorateId || user.governorateId || null,
        note: note || null,
      };
      if (imageData) updateObj.image = imageData;
      await existing.update(updateObj);
    } else {
      await PlayerOfMonth.create({
        month: selectedMonth,
        userId: user.id,
        governorateId: req.user.governorateId || user.governorateId || null,
        note: note || null,
        image: imageData || user.image || null,
      });
    }

    return res.status(200).json({
      message: "Player of the month saved successfully",
      data: {
        month: selectedMonth,
        userId: user.id,
        name: user.name,
      },
    });
  } catch (e) {
    console.error("player of month save error:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/player-of-month", optionalAuthenticateToken, async (req, res) => {
  try {
    const governorateScope = getGovernorateScope(req, { allowQuery: true });
    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }

    const item = await PlayerOfMonth.findOne({
      where: applyGovernorateScope({}, governorateScope),
      include: [
        {
          model: User,
          as: "user",
          attributes: { exclude: ["password"] },
          include: [
            {
              model: PlayerMatchStats,
              as: "stats",
              required: false,
              attributes: [
                "gameId",
                "team",
                "goals",
                "assists",
                "yellowCards",
                "redCards",
                "isMotm",
              ],
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    if (!item) {
      return res.status(404).json({ error: "No player of the month found" });
    }

    const user = item.user ? item.user.toJSON() : null;
    if (!user) {
      return res.status(404).json({ error: "Player data not found" });
    }

    const statsRows = Array.isArray(user.stats) ? user.stats : [];
    const totals = statsRows.reduce(
      (acc, r) => {
        acc.games += 1;
        acc.goals += Number(r.goals) || 0;
        acc.assists += Number(r.assists) || 0;
        acc.yellowCards += Number(r.yellowCards) || 0;
        acc.redCards += Number(r.redCards) || 0;
        if (r.isMotm) acc.motm += 1;
        return acc;
      },
      {
        games: 0,
        goals: 0,
        assists: 0,
        yellowCards: 0,
        redCards: 0,
        motm: 0,
      }
    );

    const overall = calcOverall(user);
    const responseImage = item.image || user.image || null;

    return res.json({
      id: item.id,
      month: item.month,
      note: item.note || "",
      image: responseImage,
      governorateId: item.governorateId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      player: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        position: user.position || "",
        image: user.image,
        spd: user.spd,
        fin: user.fin,
        pas: user.pas,
        skl: user.skl,
        tkl: user.tkl,
        str: user.str,
        overall,
        stats: {
          ...totals,
          totalCards: totals.yellowCards + totals.redCards,
        },
      },
    });
  } catch (e) {
    console.error("player of month get error:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/player-of-month/history", optionalAuthenticateToken, async (req, res) => {
  try {
    const governorateScope = getGovernorateScope(req, { allowQuery: true });
    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }

    const rows = await PlayerOfMonth.findAll({
      where: applyGovernorateScope({}, governorateScope),
      include: [
        {
          model: User,
          as: "user",
          attributes: { exclude: ["password"] },
        },
      ],
      order: [["month", "DESC"]],
    });

    const data = rows.map((r) => {
      const j = r.toJSON();
      return {
        id: j.id,
        month: j.month,
        note: j.note || "",
        image: j.image || null,
        governorateId: j.governorateId,
        player: j.user
          ? {
              ...j.user,
              overall: calcOverall(j.user),
            }
          : null,
        createdAt: j.createdAt,
      };
    });

    return res.json({ data });
  } catch (e) {
    console.error("player of month history error:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
