const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const { User, Game, GameSlot } = require("../models");
const upload = require("../middlewares/uploads");
const {
  authenticateToken,
  optionalAuthenticateToken,
} = require("../middlewares/auth.js");
const { sendNotificationToAll  } = require('../services/notifications');
const {
  isAdmin,
  isSuperAdmin,
  getGovernorateScope,
  applyGovernorateScope,
  ensureGovernorateAccess,
} = require("../services/accessScope");

function buildFormation(size) {
  if (String(size) === "5") {
    return [
      { code: "GK", label: "GK حارس", role: "player" },
      { code: "LB", label: "CM مدافع أيسر", role: "player" },
      { code: "CB", label: "CB مدافع", role: "player" },
      { code: "RB", label: "CB مدافع أيمن", role: "player" },
      { code: "CM", label: "CM وسط", role: "player" },
      { code: "CF", label: "CF رأس حربة", role: "player" },
      { code: "BENCH1", label: "احتياط 1", role: "bench" },
      { code: "BENCH2", label: "احتياط 2", role: "bench" },
      { code: "COACH", label: "مدرب", role: "coach" },
    ];
  }
  if (String(size) === "7") {
    return [
      { code: "GK", label: "GK حارس", role: "player" },
      { code: "LB", label: "LB مدافع أيسر", role: "player" },
      { code: "CB", label: "CB مدافع", role: "player" },
      { code: "RB", label: "RB مدافع أيمن", role: "player" },
      { code: "CM1", label: "CM وسط 1", role: "player" },
      { code: "CM2", label: "CM وسط 2", role: "player" },
      { code: "AMF", label: "AMF صانع لعب", role: "player" },
      { code: "CF", label: "CF رأس حربة", role: "player" },
      { code: "BENCH1", label: "احتياط 1", role: "bench" },
      { code: "BENCH2", label: "احتياط 2", role: "bench" },
      { code: "COACH", label: "مدرب", role: "coach" },
    ];
  }
  if (String(size) === "9") {
    return [
      { code: "GK", label: "GK حارس", role: "player" },
      { code: "LB", label: "LB مدافع أيسر", role: "player" },
      { code: "CB1", label: "CB مدافع 1", role: "player" },
      { code: "CB2", label: "CB مدافع 2", role: "player" },
      { code: "RB", label: "RB مدافع أيمن", role: "player" },
      { code: "CM1", label: "CM وسط 1", role: "player" },
      { code: "CM2", label: "CM وسط 2", role: "player" },
      { code: "LWF", label: "LWF مهاجم أيسر", role: "player" },
      { code: "CF", label: "CF رأس حربة", role: "player" },
      { code: "BENCH1", label: "احتياط 1", role: "bench" },
      { code: "BENCH2", label: "احتياط 2", role: "bench" },
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
    { code: "BENCH1", label: "احتياط 1", role: "bench" },
    { code: "BENCH2", label: "احتياط 2", role: "bench" },
    { code: "COACH", label: "مدرب", role: "coach" },
  ];
}

const formatPrice = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  return Number(value);
};

const calcOverall = (u) =>
  Math.round((u.spd + u.fin + u.pas + u.skl + u.tkl + u.str) / 6);

function normalizeStartsAtInput(value) {
  const raw = String(value || "").trim();
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day} ${hour}:${minute}:${second || "00"}`;
}

async function getRawStartsAtMap(gameIds = []) {
  const uniqueIds = [...new Set(gameIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!uniqueIds.length) {
    return new Map();
  }

  const placeholders = uniqueIds.map(() => "?").join(", ");
  const [rows] = await sequelize.query(
    `
      SELECT id, DATE_FORMAT(startsAt, '%Y-%m-%d %H:%i:%s') AS startsAt
      FROM Games
      WHERE id IN (${placeholders})
    `,
    { replacements: uniqueIds }
  );

  return new Map(rows.map((row) => [Number(row.id), row.startsAt]));
}

async function serializeGamesWithRawStartsAt(games = []) {
  const startsAtMap = await getRawStartsAtMap(games.map((game) => game.id));
  return games.map((g) => {
    const j = g.toJSON();
    return {
      ...j,
      startsAt: startsAtMap.get(Number(j.id)) || j.startsAt,
      price: formatPrice(j.price),
    };
  });
}

router.post("/games", upload.single("stadiumImage"), authenticateToken, async (req, res) => {
  try {
    if (!isAdmin(req.user) && !isSuperAdmin(req.user)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const { stadiumName, startsAt, formationSize, locationUrl, price } = req.body;

    if (!stadiumName || !startsAt || !formationSize || !locationUrl) {
      return res.status(400).json({ error: "stadiumName, startsAt, locationUrl, formationSize مطلوبة" });
    }

    if (!["5", "7", "9", "11"].includes(String(formationSize))) {
      return res.status(400).json({ error: "formationSize يجب أن يكون 5 أو 7 أو 9 أو 11" });
    }

    const numericPrice =
      price === undefined || price === null || price === ""
        ? 0
        : Number(price);

    if (Number.isNaN(numericPrice) || numericPrice < 0) {
      return res.status(400).json({ error: "price يجب أن يكون رقم صحيح أو عشري وأكبر أو يساوي 0" });
    }

    const normalizedStartsAt = normalizeStartsAtInput(startsAt);
    if (!normalizedStartsAt) {
      return res.status(400).json({ error: "startsAt format is invalid" });
    }

    const game = await Game.create({
      stadiumName,
      stadiumImage: req.file?.filename || null,
      startsAt: normalizedStartsAt,
      formationSize: String(formationSize),
      status: "open",
      locationUrl: locationUrl || null,
      price: numericPrice,
      governorateId: req.user.governorateId || null,
    });

    await sequelize.query(
      `
        UPDATE Games
        SET startsAt = STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s')
        WHERE id = ?
      `,
      {
        replacements: [normalizedStartsAt, game.id],
      }
    );

    const slots = buildFormation(formationSize);
    const bulk = [];

    for (const team of ["A", "B"]) {
      for (const s of slots) {
        bulk.push({ gameId: game.id, team, ...s });
      }
    }

    await GameSlot.bulkCreate(bulk);

    res.status(201).json({
      message: "Game created",
      gameId: game.id,
      price: formatPrice(game.price),
    });

    //sendNotificationToAll('تم نشر مباراة جديدة راجع سجل المباريات', 'مباراة جديدة')
    //  .catch(err => console.error("sendNotificationToAll error:", err));

    return;
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/games", optionalAuthenticateToken, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 15), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "15", 15), 1), 50);
    const offset = (page - 1) * limit;

    const now = new Date();

    const governorateScope = getGovernorateScope(req, { allowQuery: true });
    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }

    let where = applyGovernorateScope({}, governorateScope);
    if (req.query.formationSize) {
      where.formationSize = String(req.query.formationSize);
    }

    const { rows: games, count: total } = await Game.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    const data = await serializeGamesWithRawStartsAt(games);

    return res.json({
      data,
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

router.get("/games/open", optionalAuthenticateToken, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "15", 10), 1), 50);
    const offset = (page - 1) * limit;

    const now = new Date();

    const governorateScope = getGovernorateScope(req, { allowQuery: true });
    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }

    let where = applyGovernorateScope({ status: "open" }, governorateScope);
    if (req.query.formationSize) {
      where.formationSize = String(req.query.formationSize);
    }

    const { rows: games, count: total } = await Game.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    const data = await serializeGamesWithRawStartsAt(games);

    return res.json({
      data,
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

router.get("/games/closed", optionalAuthenticateToken, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "15", 10), 1), 50);
    const offset = (page - 1) * limit;

    const now = new Date();

    const governorateScope = getGovernorateScope(req, { allowQuery: true });
    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }

    let where = applyGovernorateScope({ status: "closed" }, governorateScope);
    if (req.query.formationSize) {
      where.formationSize = String(req.query.formationSize);
    }

    const { rows: games, count: total } = await Game.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    const data = await serializeGamesWithRawStartsAt(games);

    return res.json({
      data,
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

router.get("/games/:id", optionalAuthenticateToken, async (req, res) => {
  try {
    const gameId = req.params.id;

    const game = await Game.findByPk(gameId);
    const governorateScope = getGovernorateScope(req, { allowQuery: true });
    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }
    if (!game) return res.status(404).json({ error: "المباراة غير موجودة" });

    if (
      game &&
      governorateScope !== null &&
      Number(game.governorateId) !== Number(governorateScope)
    ) {
      return res.status(404).json({ error: "Game not found" });
    }

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

    const gameData = game.toJSON();
    const startsAtMap = await getRawStartsAtMap([game.id]);

    return res.json({
      game: {
        ...gameData,
        startsAt: startsAtMap.get(Number(gameData.id)) || gameData.startsAt,
        price: formatPrice(gameData.price),
      },
      slots: mapped,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/games/:id", authenticateToken, async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!isAdmin(req.user) && !isSuperAdmin(req.user)) {
      await t.rollback();
      return res.status(403).json({ error: "Not allowed" });
    }

    const gameId = req.params.id;

    const game = await Game.findByPk(gameId, { transaction: t });
    if (game && !ensureGovernorateAccess(req, res, game.governorateId)) {
      await t.rollback();
      return;
    }
    if (game && !ensureGovernorateAccess(req, res, game.governorateId)) {
      await t.rollback();
      return;
    }
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
    if (user && Number(user.governorateId) !== Number(game.governorateId)) {
      await t.rollback();
      return res.status(403).json({ error: "Not allowed for this governorate" });
    }
    if (!user) {
      await t.rollback();
      return res.status(404).json({ error: "المستخدم غير موجود بالنظام" });
    }

    if (!isAdmin(req.user)) {
      const already = await GameSlot.findOne({
        where: { gameId, userId },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (already) {
        await t.rollback();
        return res.status(409).json({ error: "أنت حاجز مقعد بالفعل بهذه المباراة" });
      }
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
    const userId = Number(req.body.userId);
    const { team, code } = req.body;

    if (!userId || !Number.isInteger(userId)) {
        await t.rollback();
        return res.status(400).json({ error: "userId مطلوب وبصيغة صحيحة" });
      }

    const slot = await GameSlot.findOne({
      where:
        team && code
          ? { gameId, userId, team, code }
          : { gameId, userId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!slot) {
      await t.rollback();
      return res.status(404).json({ error: "ما عندك حجز بهذه المباراة" });
    }

    if (!isAdmin(req.user) && Number(req.user.id) !== userId) {
      await t.rollback();
      return res.status(403).json({ error: "Not allowed" });
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
