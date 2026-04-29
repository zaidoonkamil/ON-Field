const express = require("express");
const router = express.Router();
const sequelize = require("../config/db");
const upload = require("../middlewares/uploads");
const { authenticateToken, optionalAuthenticateToken } = require("../middlewares/auth.js");
const {
  User,
  MonthlySquad,
  MonthlySquadSlot,
  PlayerMatchStats,
  Game,
} = require("../models");
const { Op } = require("sequelize");
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
      { code: "GK", label: "GK Ø­Ø§Ø±Ø³", role: "player" },
      { code: "LB", label: "CM Ù…Ø¯Ø§ÙØ¹ Ø£ÙŠØ³Ø±", role: "player" },
      { code: "CB", label: "CB Ù…Ø¯Ø§ÙØ¹", role: "player" },
      { code: "RB", label: "CB Ù…Ø¯Ø§ÙØ¹ Ø£ÙŠÙ…Ù†", role: "player" },
      { code: "CM", label: "CM ÙˆØ³Ø·", role: "player" },
      { code: "CF", label: "CF Ø±Ø£Ø³ Ø­Ø±Ø¨Ø©", role: "player" },
      { code: "BENCH1", label: "Ø§Ø­ØªÙŠØ§Ø· 1", role: "bench" },
      { code: "BENCH2", label: "Ø§Ø­ØªÙŠØ§Ø· 2", role: "bench" },
      { code: "COACH", label: "Ù…Ø¯Ø±Ø¨", role: "coach" },
    ];
  }
  if (String(size) === "7") {
    return [
      { code: "GK", label: "GK Ø­Ø§Ø±Ø³", role: "player" },
      { code: "LB", label: "LB Ù…Ø¯Ø§ÙØ¹ Ø£ÙŠØ³Ø±", role: "player" },
      { code: "CB", label: "CB Ù…Ø¯Ø§ÙØ¹", role: "player" },
      { code: "RB", label: "RB Ù…Ø¯Ø§ÙØ¹ Ø£ÙŠÙ…Ù†", role: "player" },
      { code: "CM1", label: "CM ÙˆØ³Ø· 1", role: "player" },
      { code: "CM2", label: "CM ÙˆØ³Ø· 2", role: "player" },
      { code: "AMF", label: "AMF ØµØ§Ù†Ø¹ Ù„Ø¹Ø¨", role: "player" },
      { code: "CF", label: "CF Ø±Ø£Ø³ Ø­Ø±Ø¨Ø©", role: "player" },
      { code: "BENCH1", label: "Ø§Ø­ØªÙŠØ§Ø· 1", role: "bench" },
      { code: "BENCH2", label: "Ø§Ø­ØªÙŠØ§Ø· 2", role: "bench" },
      { code: "COACH", label: "Ù…Ø¯Ø±Ø¨", role: "coach" },
    ];
  }
  return [
    { code: "GK", label: "GK Ø­Ø§Ø±Ø³", role: "player" },
    { code: "LB", label: "LB Ù…Ø¯Ø§ÙØ¹ Ø£ÙŠØ³Ø±", role: "player" },
    { code: "CB1", label: "CB Ù…Ø¯Ø§ÙØ¹ 1", role: "player" },
    { code: "CB2", label: "CB Ù…Ø¯Ø§ÙØ¹ 2", role: "player" },
    { code: "RB", label: "RB Ù…Ø¯Ø§ÙØ¹ Ø£ÙŠÙ…Ù†", role: "player" },
    { code: "CM1", label: "CM ÙˆØ³Ø· 1", role: "player" },
    { code: "CM2", label: "CM ÙˆØ³Ø· 2", role: "player" },
    { code: "AMF", label: "AMF ØµØ§Ù†Ø¹ Ù„Ø¹Ø¨", role: "player" },
    { code: "LWF", label: "LWF Ù…Ù‡Ø§Ø¬Ù… Ø£ÙŠØ³Ø±", role: "player" },
    { code: "RWF", label: "RWF Ù…Ù‡Ø§Ø¬Ù… Ø£ÙŠÙ…Ù†", role: "player" },
    { code: "CF", label: "CF Ø±Ø£Ø³ Ø­Ø±Ø¨Ø©", role: "player" },
    { code: "BENCH1", label: "Ø§Ø­ØªÙŠØ§Ø· 1", role: "bench" },
    { code: "BENCH2", label: "Ø§Ø­ØªÙŠØ§Ø· 2", role: "bench" },
    { code: "COACH", label: "Ù…Ø¯Ø±Ø¨", role: "coach" },
  ];
}

const calcOverall = (u) =>
  Math.round((u.spd + u.fin + u.pas + u.skl + u.tkl + u.str) / 6);

async function resolveRequestGovernorateId(req) {
  if (req.user?.governorateId) {
    return Number(req.user.governorateId);
  }

  if (req.user?.id) {
    const currentUser = await User.findByPk(req.user.id, {
      attributes: ["governorateId"],
    });
    if (currentUser?.governorateId) {
      return Number(currentUser.governorateId);
    }
  }

  return null;
}

async function resolveSquadGovernorateId(squad, transaction) {
  if (!squad) return null;

  if (squad.governorateId) {
    return Number(squad.governorateId);
  }

  let governorateId = null;
  if (squad.createdBy) {
    const creator = await User.findByPk(squad.createdBy, {
      attributes: ["governorateId"],
      transaction,
    });
    if (creator?.governorateId) {
      governorateId = Number(creator.governorateId);
    }
  }

  if (governorateId) {
    squad.governorateId = governorateId;
    await squad.save({ transaction });
    return governorateId;
  }

  return null;
}

async function findGovernorateFallbackSquad(governorateId, transaction) {
  if (!governorateId) return null;

  const squads = await MonthlySquad.findAll({
    where: { governorateId },
    order: [["createdAt", "DESC"]],
    transaction,
  });

  if (!squads.length) return null;

  for (const squad of squads) {
    const assignedCount = await MonthlySquadSlot.count({
      where: {
        squadId: squad.id,
        userId: { [Op.ne]: null },
      },
      transaction,
    });

    if (assignedCount > 0) {
      return squad;
    }
  }

  return squads[0];
}

async function ensureGovernorateDefaultSquad(governorateId, transaction) {
  if (!governorateId) return null;

  let squad = await findGovernorateFallbackSquad(governorateId, transaction);
  if (squad) return squad;

  squad = await MonthlySquad.create(
    {
      title: "تشكيلة الشهر",
      formationSize: "11",
      status: "published",
      createdBy: null,
      governorateId,
    },
    transaction ? { transaction } : undefined
  );

  const slots = buildFormation("11").map((slot) => ({
    squadId: squad.id,
    ...slot,
  }));

  await MonthlySquadSlot.bulkCreate(
    slots,
    transaction ? { transaction } : undefined
  );

  return squad;
}

async function resolveScopedSquad({
  squadId,
  governorateScope,
  transaction,
}) {
  let squad = await MonthlySquad.findByPk(squadId, { transaction });
  let effectiveGovernorateId = await resolveSquadGovernorateId(
    squad,
    transaction
  );

  if (
    squad &&
    governorateScope !== null &&
    Number(effectiveGovernorateId) !== Number(governorateScope)
  ) {
    squad = null;
    effectiveGovernorateId = null;
  }

  if (!squad && governorateScope !== null) {
    squad = await ensureGovernorateDefaultSquad(governorateScope, transaction);
    effectiveGovernorateId = await resolveSquadGovernorateId(
      squad,
      transaction
    );
  }

  return { squad, effectiveGovernorateId };
}

router.post("/monthly-squads", upload.none(), authenticateToken, async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!isAdmin(req.user) && !isSuperAdmin(req.user)) {
      await t.rollback();
      return res.status(403).json({ error: "Not allowed" });
    }

    const { title, formationSize, status } = req.body;
    if (!title || !formationSize) {
      await t.rollback();
      return res.status(400).json({ error: "title and formationSize are required" });
    }

    const governorateId = await resolveRequestGovernorateId(req);
    if (!governorateId) {
      await t.rollback();
      return res.status(400).json({ error: "governorateId is required" });
    }

    const squad = await MonthlySquad.create(
      {
        title: String(title).trim(),
        formationSize: String(formationSize),
        status: status ? String(status) : "draft",
        createdBy: req.user.id,
        governorateId,
      },
      { transaction: t }
    );

    const slots = buildFormation(formationSize).map((s) => ({
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

router.get("/monthly-squads", optionalAuthenticateToken, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "15", 10), 1), 50);
    const offset = (page - 1) * limit;
    const governorateScope = getGovernorateScope(req, { allowQuery: true });

    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }

    const { rows, count } = await MonthlySquad.findAndCountAll({
      where: applyGovernorateScope({}, governorateScope),
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

router.get("/monthly-squads/:id", optionalAuthenticateToken, async (req, res) => {
  try {
    const squadId = Number(req.params.id);
    const governorateScope = getGovernorateScope(req, { allowQuery: true });

    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }

    const { squad, effectiveGovernorateId } = await resolveScopedSquad({
      squadId,
      governorateScope,
    });
    if (!squad || !effectiveGovernorateId) {
      return res.status(404).json({ error: "Squad not found" });
    }

    const from = req.query.from;
    const to = req.query.to;
    const gameWhere = {};
    if (from || to) {
      gameWhere.date = {};
      if (from) gameWhere.date[Op.gte] = new Date(from);
      if (to) gameWhere.date[Op.lte] = new Date(to);
    }

    const slots = await MonthlySquadSlot.findAll({
      where: { squadId: squad.id },
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
              include:
                from || to
                  ? [{
                      model: Game,
                      as: "game",
                      where: gameWhere,
                      required: true,
                      attributes: ["id", "status", "startsAt"],
                    }]
                  : [{
                      model: Game,
                      as: "game",
                      required: false,
                      attributes: ["id", "status", "startsAt"],
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
    console.error("monthly-squads/:id error:", e?.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/monthly-squads/:id/assign", upload.none(), authenticateToken, async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!isAdmin(req.user) && !isSuperAdmin(req.user)) {
      await t.rollback();
      return res.status(403).json({ error: "Not allowed" });
    }

    const squadId = Number(req.params.id);
    const { code, userId } = req.body;
    if (!code || !userId) {
      await t.rollback();
      return res.status(400).json({ error: "code and userId are required" });
    }

    const governorateScope =
      (await resolveRequestGovernorateId(req)) ?? req.user?.governorateId ?? null;
    const { squad, effectiveGovernorateId } = await resolveScopedSquad({
      squadId,
      governorateScope,
      transaction: t,
    });
    if (!squad || !effectiveGovernorateId) {
      await t.rollback();
      return res.status(404).json({ error: "Squad not found" });
    }
    if (!ensureGovernorateAccess(req, res, effectiveGovernorateId)) {
      await t.rollback();
      return;
    }

    const user = await User.findByPk(Number(userId), {
      transaction: t,
      attributes: { exclude: ["password"] },
    });
    if (!user || Number(user.governorateId) !== Number(effectiveGovernorateId)) {
      await t.rollback();
      return res.status(403).json({ error: "Not allowed for this governorate" });
    }

    const slot = await MonthlySquadSlot.findOne({
      where: { squadId: squad.id, code: String(code) },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!slot) {
      await t.rollback();
      return res.status(404).json({ error: "Position not found" });
    }

    const already = await MonthlySquadSlot.findOne({
      where: { squadId: squad.id, userId: Number(userId) },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (already) {
      await t.rollback();
      return res.status(409).json({ error: "Player already exists in this squad" });
    }

    slot.userId = Number(userId);
    slot.assignedAt = new Date();
    await slot.save({ transaction: t });

    await t.commit();
    return res.json({ message: "Player assigned", slot });
  } catch (e) {
    await t.rollback();
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/monthly-squads/:id/unassign", upload.none(), authenticateToken, async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!isAdmin(req.user) && !isSuperAdmin(req.user)) {
      await t.rollback();
      return res.status(403).json({ error: "Not allowed" });
    }

    const squadId = Number(req.params.id);
    const { code } = req.body;
    if (!code) {
      await t.rollback();
      return res.status(400).json({ error: "code is required" });
    }

    const governorateScope =
      (await resolveRequestGovernorateId(req)) ?? req.user?.governorateId ?? null;
    const { squad, effectiveGovernorateId } = await resolveScopedSquad({
      squadId,
      governorateScope,
      transaction: t,
    });
    if (!squad || !effectiveGovernorateId) {
      await t.rollback();
      return res.status(404).json({ error: "Squad not found" });
    }
    if (!ensureGovernorateAccess(req, res, effectiveGovernorateId)) {
      await t.rollback();
      return;
    }

    const slot = await MonthlySquadSlot.findOne({
      where: { squadId: squad.id, code: String(code) },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!slot) {
      await t.rollback();
      return res.status(404).json({ error: "Position not found" });
    }

    slot.userId = null;
    slot.assignedAt = null;
    await slot.save({ transaction: t });

    await t.commit();
    return res.json({ message: "Player removed from position" });
  } catch (e) {
    await t.rollback();
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/monthly-squads/:id", authenticateToken, async (req, res) => {
  const t = await sequelize.transaction();
  try {
    if (!isAdmin(req.user) && !isSuperAdmin(req.user)) {
      await t.rollback();
      return res.status(403).json({ error: "Not allowed" });
    }

    const squadId = Number(req.params.id);
    const squad = await MonthlySquad.findByPk(squadId, { transaction: t });
    if (!squad) {
      await t.rollback();
      return res.status(404).json({ error: "Squad not found" });
    }
    const effectiveGovernorateId = await resolveSquadGovernorateId(squad, t);
    if (!ensureGovernorateAccess(req, res, effectiveGovernorateId)) {
      await t.rollback();
      return;
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
    if (!isAdmin(req.user) && !isSuperAdmin(req.user)) {
      await t.rollback();
      return res.status(403).json({ error: "Not allowed" });
    }

    const squadId = Number(req.params.id);
    const { title, status } = req.body;
    if (!title || !String(title).trim()) {
      await t.rollback();
      return res.status(400).json({ error: "title is required" });
    }

    const squad = await MonthlySquad.findByPk(squadId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!squad) {
      await t.rollback();
      return res.status(404).json({ error: "Squad not found" });
    }
    const effectiveGovernorateId = await resolveSquadGovernorateId(squad, t);
    if (!ensureGovernorateAccess(req, res, effectiveGovernorateId)) {
      await t.rollback();
      return;
    }

    squad.title = String(title).trim();
    if (status) squad.status = String(status);
    await squad.save({ transaction: t });

    await t.commit();
    return res.json({ message: "Monthly squad updated", squad });
  } catch (e) {
    await t.rollback();
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
