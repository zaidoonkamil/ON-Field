const express = require("express");
const router = express.Router();
const { PlayerOfMonth, User, PlayerMatchStats } = require("../models");
const { authenticateToken } = require("../middlewares/auth");
const uploadImage = require("../middlewares/uploads");

const calcOverall = (u) =>
  Math.round((u.spd + u.fin + u.pas + u.skl + u.tkl + u.str) / 6);

router.post("/player-of-month", authenticateToken, uploadImage.single("image"), async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Not allowed" });
    }

    const { userId, note } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId مطلوب" });
    }

    const now = new Date();
    const selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const user = await User.findByPk(userId, {
      attributes: { exclude: ["password"] },
    });

    if (!user) {
      return res.status(404).json({ error: "اللاعب غير موجود" });
    }

    if (user.role === "admin") {
      return res.status(400).json({ error: "لا يمكن اختيار أدمن كلاعب الشهر" });
    }

    const file = req.file;
    let imageData = null;
    if (file) {
      imageData = { main: file.filename };
    }

    const existing = await PlayerOfMonth.findOne({
      where: { month: selectedMonth },
    });

    if (existing) {
      const updateObj = {
        userId: user.id,
        note: note || null,
      };
      if (imageData) {
        updateObj.image = imageData;
      }
      await existing.update(updateObj);
    } else {
      await PlayerOfMonth.create({
        month: selectedMonth,
        userId: user.id,
        note: note || null,
        image: imageData || user.image || null,
      });
    }

    return res.status(200).json({
      message: "تم تحديد لاعب الشهر بنجاح",
      data: {
        month: selectedMonth,
        userId: user.id,
        name: user.name,
      },
    });
  } catch (e) {
    console.error("❌ player of month save error:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/player-of-month", async (req, res) => {
  try {
    const item = await PlayerOfMonth.findOne({
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
      return res.status(404).json({ error: "لا يوجد لاعب شهر" });
    }

    const user = item.user ? item.user.toJSON() : null;

    if (!user) {
      return res.status(404).json({ error: "بيانات اللاعب غير موجودة" });
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

    const overall = Math.round(
      (user.spd + user.fin + user.pas + user.skl + user.tkl + user.str) / 6
    );

    // pick image from record; fall back to user image if the record doesn't have one
    const responseImage = item.image || (user && user.image) || null;

    return res.json({
      id: item.id,
      month: item.month,
      note: item.note || "",
      image: responseImage,
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
    console.error("❌ player of month get error:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/player-of-month/history", async (req, res) => {
  try {
    const rows = await PlayerOfMonth.findAll({
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
    console.error("❌ player of month history error:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;