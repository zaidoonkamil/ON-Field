const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const { User, Game, GameSlot } = require("../models");
const upload = require("../middlewares/uploads");
const { authenticateToken } = require("../middlewares/auth.js");
const { sendNotificationToAll  } = require('../services/notifications');

function buildFormation(size) {
  if (String(size) === "5") {
    return [
      { code: "GK", label: "GK حارس", role: "player" },
      { code: "LB", label: "CM مدافع أيسر", role: "player" },
      { code: "CB", label: "CB مدافع", role: "player" },
      { code: "RB", label: "CB مدافع أيمن", role: "player" },
      { code: "CF", label: "CF رأس حربة", role: "player" },
      { code: "BENCH", label: "احتياط", role: "bench" },
      { code: "COACH", label: "مدرب", role: "coach" },
    ];
  }
  if (String(size) === "7") {
    return [
      { code: "GK", label: "GK حارس", role: "player" },
      { code: "LB", label: "LB مدافع أيسر", role: "player" },
      { code: "CB", label: "CB مدافع", role: "player" },
      { code: "RB", label: "RB مدافع أيمن", role: "player" },
      { code: "CM", label: "CM وسط", role: "player" },
      { code: "AMF", label: "AMF صانع لعب", role: "player" },
      { code: "CF", label: "CF رأس حربة", role: "player" },
      { code: "BENCH", label: "احتياط", role: "bench" },
      { code: "COACH", label: "مدرب", role: "coach" },
    ];
  }
  return [
    { code: "GK", label: "GK حارس", role: "player" },
    { code: "LB", label: "LB مدافع أيسر", role: "player" },
    { code: "CB1", label: "CB مدافع 1", role: "player" },
    { code: "CB2", label: "CB مدافع 2", role: "player" },
    { code: "RB", label: "RB مدافع أيمن", role: "player" },
    { code: "CM1", label: "CM وسط 1", role: "player" },
    { code: "CM2", label: "CM وسط 2", role: "player" },
    { code: "AMF", label: "AMF صانع لعب", role: "player" },
    { code: "LWF", label: "LWF مهاجم أيسر", role: "player" },
    { code: "RWF", label: "RWF مهاجم أيمن", role: "player" },
    { code: "CF", label: "CF رأس حربة", role: "player" },
    { code: "BENCH", label: "احتياط", role: "bench" },
    { code: "COACH", label: "مدرب", role: "coach" },
  ];
}

const calcOverall = (u) =>
  Math.round((u.spd + u.fin + u.pas + u.skl + u.tkl + u.str) / 6);

router.post("/games", upload.none(), authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Not allowed" });
    }

    const { stadiumName, startsAt, formationSize } = req.body;
    if (!stadiumName || !startsAt || !formationSize) {
      return res.status(400).json({ error: "stadiumName, startsAt, formationSize مطلوبة" });
    }

    const game = await Game.create({
      stadiumName,
      startsAt,
      formationSize: String(formationSize),
      status: "open",
    });

    const slots = buildFormation(formationSize);
    const bulk = [];

    for (const team of ["A", "B"]) {
      for (const s of slots) {
        bulk.push({ gameId: game.id, team, ...s });
      }
    }

    await GameSlot.bulkCreate(bulk);

    await sendNotificationToAll ( 'تم نشر مباراة جديدة راجع سجل المباريات' , 'مباراة جديدة' );

    return res.status(201).json({ message: "Game created", gameId: game.id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/games", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 15), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "15", 15), 1), 50);
    const offset = (page - 1) * limit;

    const now = new Date();

    const { rows: games, count: total } = await Game.findAndCountAll({
      order: [["startsAt", "ASC"]],
      limit,
      offset,
    });

    return res.json({
      data: games,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: offset + games.length < total,
        hasPrev: page > 1,
      },
      serverNow: now.toISOString(),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/games/:id", async (req, res) => {
  try {
    const gameId = req.params.id;

    const game = await Game.findByPk(gameId);
    if (!game) return res.status(404).json({ error: "المباراة غير موجودة" });

    const slots = await GameSlot.findAll({
      where: { gameId },
      include: [{
        model: User,
        as: "user",
        attributes: { exclude: ["password"] },
      }],
      order: [["team", "ASC"], ["role", "ASC"], ["code", "ASC"]],
    });

    const mapped = slots.map(s => {
      const j = s.toJSON();
      if (j.user) j.user.overall = calcOverall(j.user);
      return j;
    });

    return res.json({ game, slots: mapped });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/games/:id", authenticateToken, async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (req.user.role !== "admin") {
      await t.rollback();
      return res.status(403).json({ error: "Not allowed" });
    }

    const gameId = req.params.id;

    const game = await Game.findByPk(gameId, { transaction: t });
    if (!game) {
      await t.rollback();
      return res.status(404).json({ error: "المباراة غير موجودة" });
    }

    await GameSlot.destroy({
      where: { gameId },
      transaction: t,
    });

    await Game.destroy({
      where: { id: gameId },
      transaction: t,
    });

    await t.commit();
    return res.json({ message: "Game deleted", gameId });
  } catch (e) {
    await t.rollback();
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ حجز مركز (اختيار فريق + مركز/مقعد)
router.post("/games/:id/book", upload.none(), authenticateToken, async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const gameId = Number(req.params.id);
    const { team, code } = req.body;
    const userId = req.user.id;

    if (!team || !code) {
      await t.rollback();
      return res.status(400).json({ error: "team و code مطلوبات" });
    }

    const game = await Game.findByPk(gameId, { transaction: t });
    if (!game) {
      await t.rollback();
      return res.status(404).json({ error: "المباراة غير موجودة" });
    }
    if (game.status !== "open") {
      await t.rollback();
      return res.status(403).json({ error: "الحجز مغلق لهذه المباراة" });
    }

    const user = await User.findByPk(userId, { transaction: t });
    if (!user) {
      await t.rollback();
      return res.status(404).json({ error: "المستخدم غير موجود بالنظام" });
    }

    const already = await GameSlot.findOne({
      where: { gameId, userId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (already) {
      await t.rollback();
      return res.status(409).json({ error: "أنت حاجز مقعد بالفعل بهذه المباراة" });
    }

    const slot = await GameSlot.findOne({
      where: { gameId, team, code },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!slot) {
      await t.rollback();
      return res.status(404).json({ error: "المقعد غير موجود" });
    }
    if (slot.userId) {
      await t.rollback();
      return res.status(409).json({ error: "هذا المقعد محجوز" });
    }

    slot.userId = userId;
    slot.bookedAt = new Date();
    await slot.save({ transaction: t });

    await t.commit();
    return res.json({ message: "تم الحجز", slot });
  } catch (e) {
    await t.rollback();
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ إلغاء حجز (اللاعب يلغي حجزة)
router.post("/games/:id/unbook", upload.none(), authenticateToken, async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const gameId = Number(req.params.id);
    const userId = req.user.id;

    const slot = await GameSlot.findOne({
      where: { gameId, userId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!slot) {
      await t.rollback();
      return res.status(404).json({ error: "ما عندك حجز بهذه المباراة" });
    }

    slot.userId = null;
    slot.bookedAt = null;
    await slot.save({ transaction: t });

    await t.commit();
    return res.json({ message: "تم إلغاء الحجز" });
  } catch (e) {
    await t.rollback();
    return res.status(500).json({ error: "Internal Server Error" });
  }
});


module.exports = router;
