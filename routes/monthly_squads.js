const express = require("express");
const router = express.Router();
const sequelize = require("../config/db");
const upload = require("../middlewares/uploads");
const { authenticateToken } = require("../middlewares/auth.js");
const { User, MonthlySquad, MonthlySquadSlot, PlayerMatchStats, Game  } = require("../models");
const { Op } = require("sequelize");

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

const calcOverall = (u) =>
  Math.round((u.spd + u.fin + u.pas + u.skl + u.tkl + u.str) / 6);

const isAdmin = (req) => req.user?.role === "admin";

router.post("/monthly-squads", upload.none(), authenticateToken, async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!isAdmin(req)) {
      await t.rollback();
      return res.status(403).json({ error: "Not allowed" });
    }

    const { title, formationSize, status } = req.body;

    if (!title || !formationSize) {
      await t.rollback();
      return res.status(400).json({ error: "title و formationSize مطلوبات" });
    }

    const squad = await MonthlySquad.create({
      title: String(title).trim(),
      formationSize: String(formationSize),
      status: status ? String(status) : "draft",
      createdBy: req.user.id,
    }, { transaction: t });

    const slots = buildFormation(formationSize).map(s => ({
      squadId: squad.id,
      ...s,
    }));

    await MonthlySquadSlot.bulkCreate(slots, { transaction: t });

    await t.commit();
    return res.status(201).json({ message: "Monthly squad created", squadId: squad.id });
  } catch (e) {
    await t.rollback();
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/monthly-squads", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "15", 10), 1), 50);
    const offset = (page - 1) * limit;

    const { rows, count } = await MonthlySquad.findAndCountAll({
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    return res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
        hasNext: offset + rows.length < count,
        hasPrev: page > 1,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/monthly-squads/:id", async (req, res) => {
  try {
    const squadId = Number(req.params.id);

    const squad = await MonthlySquad.findByPk(squadId);
    if (!squad) return res.status(404).json({ error: "التشكيلة غير موجودة" });

    const from = req.query.from;
    const to = req.query.to;

    const gameWhere = {};
    if (from || to) {
      gameWhere.date = {};
      if (from) gameWhere.date[Op.gte] = new Date(from);
      if (to) gameWhere.date[Op.lte] = new Date(to);
    }

    const slots = await MonthlySquadSlot.findAll({
      where: { squadId },
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
              attributes: ["gameId", "team", "goals", "assists", "yellowCards", "redCards", "isMotm"],
              include: (from || to)
                ? [{
                    model: Game,
                    as: "game",
                    where: gameWhere,
                    required: true,
                    attributes: ["id", "status", "date"],
                  }]
                : [{
                    model: Game,
                    as: "game",
                    required: false,
                    attributes: ["id", "status", "date"],
                  }],
            },
          ],
        },
      ],
      order: [["role", "ASC"], ["code", "ASC"]],
    });

    const mapped = slots.map((s) => {
      const j = s.toJSON();

      if (j.user) {
        j.user.overall = calcOverall(j.user);

        const statsRows = Array.isArray(j.user.stats) ? j.user.stats : [];
        const totals = statsRows.reduce(
          (acc, r) => {
            if (!r.gameId) return acc;

            acc.games += 1;
            acc.goals += Number(r.goals) || 0;
            acc.assists += Number(r.assists) || 0;
            acc.yellowCards += Number(r.yellowCards) || 0;
            acc.redCards += Number(r.redCards) || 0;
            if (r.isMotm) acc.motm += 1;
            return acc;
          },
          { games: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, motm: 0 }
        );

        totals.totalCards = totals.yellowCards + totals.redCards;
        j.user.statsTotals = totals;

      }

      return j;
    });

    return res.json({ squad, slots: mapped });
  } catch (e) {
    console.error("❌ monthly-squads/:id error:", e?.message);
    console.error(e?.stack);
    console.error("Sequelize:", e?.parent || e?.original || e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/monthly-squads/:id/assign", upload.none(), authenticateToken, async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!isAdmin(req)) {
      await t.rollback();
      return res.status(403).json({ error: "Not allowed" });
    }

    const squadId = Number(req.params.id);
    const { code, userId } = req.body;

    if (!code || !userId) {
      await t.rollback();
      return res.status(400).json({ error: "code و userId مطلوبات" });
    }

    const slot = await MonthlySquadSlot.findOne({
      where: { squadId, code: String(code) },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!slot) {
      await t.rollback();
      return res.status(404).json({ error: "المركز غير موجود" });
    }

    const already = await MonthlySquadSlot.findOne({
      where: { squadId, userId: Number(userId) },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (already) {
      await t.rollback();
      return res.status(409).json({ error: "هذا اللاعب موجود بالتشكيلة بالفعل" });
    }

    slot.userId = Number(userId);
    slot.assignedAt = new Date();
    await slot.save({ transaction: t });

    await t.commit();
    return res.json({ message: "تم تعيين اللاعب", slot });
  } catch (e) {
    await t.rollback();
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/monthly-squads/:id/unassign", upload.none(), authenticateToken, async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!isAdmin(req)) {
      await t.rollback();
      return res.status(403).json({ error: "Not allowed" });
    }

    const squadId = Number(req.params.id);
    const { code } = req.body;

    if (!code) {
      await t.rollback();
      return res.status(400).json({ error: "code مطلوب" });
    }

    const slot = await MonthlySquadSlot.findOne({
      where: { squadId, code: String(code) },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!slot) {
      await t.rollback();
      return res.status(404).json({ error: "المركز غير موجود" });
    }

    slot.userId = null;
    slot.assignedAt = null;
    await slot.save({ transaction: t });

    await t.commit();
    return res.json({ message: "تم إزالة اللاعب من المركز" });
  } catch (e) {
    await t.rollback();
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/monthly-squads/:id", authenticateToken, async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!isAdmin(req)) {
      await t.rollback();
      return res.status(403).json({ error: "Not allowed" });
    }

    const squadId = Number(req.params.id);

    const squad = await MonthlySquad.findByPk(squadId, { transaction: t });
    if (!squad) {
      await t.rollback();
      return res.status(404).json({ error: "التشكيلة غير موجودة" });
    }

    await MonthlySquadSlot.destroy({ where: { squadId }, transaction: t });
    await MonthlySquad.destroy({ where: { id: squadId }, transaction: t });

    await t.commit();
    return res.json({ message: "Monthly squad deleted", squadId });
  } catch (e) {
    await t.rollback();
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/monthly-squads/:id", upload.none(), authenticateToken, async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!isAdmin(req)) {
      await t.rollback();
      return res.status(403).json({ error: "Not allowed" });
    }

    const squadId = Number(req.params.id);
    const { title, status } = req.body;

    if (!title || !String(title).trim()) {
      await t.rollback();
      return res.status(400).json({ error: "title مطلوب" });
    }

    const squad = await MonthlySquad.findByPk(squadId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!squad) {
      await t.rollback();
      return res.status(404).json({ error: "التشكيلة غير موجودة" });
    }

    squad.title = String(title).trim();

    if (status) squad.status = String(status);

    await squad.save({ transaction: t });

    await t.commit();
    return res.json({ message: "تم تحديث اسم التشكيلة", squad });
  } catch (e) {
    await t.rollback();
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;