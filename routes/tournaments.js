const express = require("express");
const crypto = require("crypto");
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const upload = require("../middlewares/uploads");
const { authenticateToken, optionalAuthenticateToken } = require("../middlewares/auth");
const { isAdmin, isSuperAdmin, getGovernorateScope, applyGovernorateScope, ensureGovernorateAccess } = require("../services/accessScope");
const { Tournament, TournamentTeam, TournamentSlot, User } = require("../models");

const router = express.Router();
const userAttributes = ["id", "name", "image", "position", "isVerified"];

function formation(size) {
  const count = Number(size);
  const players = count === 5
    ? [["GK", "حارس"], ["LB", "مدافع أيسر"], ["CB", "مدافع"], ["RB", "مدافع أيمن"], ["CM", "وسط"], ["CF", "مهاجم"]]
    : count === 7
      ? [["GK", "حارس"], ["LB", "مدافع أيسر"], ["CB", "مدافع"], ["RB", "مدافع أيمن"], ["CM1", "وسط 1"], ["CM2", "وسط 2"], ["AMF", "صانع لعب"], ["CF", "مهاجم"]]
      : count === 9
        ? [["GK", "حارس"], ["LB", "مدافع أيسر"], ["CB1", "مدافع 1"], ["CB2", "مدافع 2"], ["RB", "مدافع أيمن"], ["CM1", "وسط 1"], ["CM2", "وسط 2"], ["LWF", "جناح أيسر"], ["CF", "مهاجم"]]
        : [["GK", "حارس"], ["LB", "مدافع أيسر"], ["CB1", "مدافع 1"], ["CB2", "مدافع 2"], ["RB", "مدافع أيمن"], ["CM1", "وسط 1"], ["CM2", "وسط 2"], ["AMF", "صانع لعب"], ["LWF", "جناح أيسر"], ["RWF", "جناح أيمن"], ["CF", "مهاجم"]];
  return [...players.map(([code, label]) => ({ code, label, role: "player" })), { code: "BENCH1", label: "احتياط 1", role: "bench" }, { code: "BENCH2", label: "احتياط 2", role: "bench" }, { code: "COACH", label: "مدرب", role: "coach" }];
}

function canManage(user) {
  return isAdmin(user) || isSuperAdmin(user);
}

function toNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

async function tournamentForRequest(req, res, id, transaction) {
  const tournament = await Tournament.findByPk(id, { transaction });
  if (!tournament) {
    res.status(404).json({ error: "البطولة غير موجودة" });
    return null;
  }
  if (!ensureGovernorateAccess(req, res, tournament.governorateId)) return null;
  return tournament;
}

async function hasTournamentEntry(tournamentId, userId, transaction) {
  return TournamentSlot.findOne({ where: { tournamentId, userId }, transaction, lock: transaction?.LOCK.UPDATE });
}

function randomCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

router.get("/tournaments", optionalAuthenticateToken, async (req, res) => {
  try {
    const scope = getGovernorateScope(req, { allowQuery: true });
    if (scope === undefined) return res.status(400).json({ error: "governorateId is required" });
    const tournaments = await Tournament.findAll({
      where: applyGovernorateScope({}, scope),
      include: [{ model: TournamentTeam, as: "teams", attributes: ["id"] }],
      order: [["startsAt", "ASC"]],
    });
    return res.json(tournaments.map((item) => ({ ...item.toJSON(), registeredTeams: item.teams.length })));
  } catch (error) {
    console.error("Get tournaments error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/tournaments/:id", authenticateToken, async (req, res) => {
  try {
    const tournament = await tournamentForRequest(req, res, req.params.id);
    if (!tournament) return;
    const detail = await Tournament.findByPk(tournament.id, {
      include: [
        { model: TournamentTeam, as: "teams", include: [{ model: User, as: "creator", attributes: userAttributes, required: false }] },
        { model: TournamentSlot, as: "slots", include: [{ model: User, as: "user", attributes: userAttributes, required: false }], order: [["teamNumber", "ASC"], ["id", "ASC"]] },
      ],
    });
    const data = detail.toJSON();
    data.mySlot = data.slots.find((slot) => Number(slot.userId) === Number(req.user.id)) || null;
    return res.json(data);
  } catch (error) {
    console.error("Get tournament detail error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/tournaments", authenticateToken, upload.single("bannerImage"), async (req, res) => {
  try {
    if (!canManage(req.user)) return res.status(403).json({ error: "Not allowed" });
    const { title, startsAt, formationSize, teamCapacity, competitionFormat } = req.body;
    const capacity = toNumber(teamCapacity);
    if (!title || !startsAt || !["5", "7", "9", "11"].includes(String(formationSize)) || ![16, 32, 64].includes(capacity)) {
      return res.status(400).json({ error: "بيانات البطولة غير مكتملة" });
    }
    if ((capacity === 64 && competitionFormat !== "groups") || (capacity !== 64 && competitionFormat !== "knockout")) {
      return res.status(400).json({ error: "نظام البطولة لا يطابق عدد الفرق" });
    }
    const tournament = await Tournament.create({
      title: String(title).trim(), startsAt, formationSize: String(formationSize), teamCapacity: String(capacity),
      competitionFormat, bannerImage: req.file?.filename || null, governorateId: req.user.governorateId || null, createdBy: req.user.id,
    });
    const slots = [];
    for (let teamNumber = 1; teamNumber <= capacity; teamNumber += 1) {
      for (const slot of formation(formationSize)) slots.push({ tournamentId: tournament.id, teamNumber, ...slot });
    }
    await TournamentSlot.bulkCreate(slots);
    return res.status(201).json({ message: "تم إنشاء البطولة", tournamentId: tournament.id });
  } catch (error) {
    console.error("Create tournament error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/tournaments/:id/individual/book", authenticateToken, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const tournament = await tournamentForRequest(req, res, req.params.id, transaction);
    if (!tournament) { await transaction.rollback(); return; }
    if (tournament.status !== "open") { await transaction.rollback(); return res.status(400).json({ error: "التسجيل مغلق" }); }
    const teamNumber = toNumber(req.body.teamNumber);
    const code = String(req.body.code || "");
    if (!teamNumber || !code) { await transaction.rollback(); return res.status(400).json({ error: "اختر الفريق والمركز" }); }
    if (await hasTournamentEntry(tournament.id, req.user.id, transaction)) { await transaction.rollback(); return res.status(409).json({ error: "أنت مسجل مسبقاً في هذه البطولة" }); }
    const team = await TournamentTeam.findOne({ where: { tournamentId: tournament.id, teamNumber }, transaction, lock: transaction.LOCK.UPDATE });
    if (team) { await transaction.rollback(); return res.status(409).json({ error: "هذا الفريق محجوز كفريق كامل" }); }
    const slot = await TournamentSlot.findOne({ where: { tournamentId: tournament.id, teamNumber, code, userId: null }, transaction, lock: transaction.LOCK.UPDATE });
    if (!slot) { await transaction.rollback(); return res.status(409).json({ error: "هذا المركز لم يعد متاحاً" }); }
    await slot.update({ userId: req.user.id, assignedAt: new Date() }, { transaction });
    await transaction.commit();
    return res.json({ message: "تم حجز مركزك في البطولة" });
  } catch (error) { await transaction.rollback(); console.error("Individual tournament booking error:", error); return res.status(500).json({ error: "Internal Server Error" }); }
});

router.post("/tournaments/:id/teams", authenticateToken, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const tournament = await tournamentForRequest(req, res, req.params.id, transaction);
    if (!tournament) { await transaction.rollback(); return; }
    const teamNumber = toNumber(req.body.teamNumber);
    const positionCode = String(req.body.positionCode || "");
    const name = String(req.body.name || "").trim();
    if (tournament.status !== "open" || !teamNumber || !positionCode || !name) { await transaction.rollback(); return res.status(400).json({ error: "بيانات الفريق غير مكتملة أو التسجيل مغلق" }); }
    if (await hasTournamentEntry(tournament.id, req.user.id, transaction)) { await transaction.rollback(); return res.status(409).json({ error: "أنت مسجل مسبقاً في هذه البطولة" }); }
    const existingTeam = await TournamentTeam.findOne({ where: { tournamentId: tournament.id, teamNumber }, transaction, lock: transaction.LOCK.UPDATE });
    const existingSlot = await TournamentSlot.findOne({ where: { tournamentId: tournament.id, teamNumber, userId: { [Op.ne]: null } }, transaction, lock: transaction.LOCK.UPDATE });
    if (existingTeam || existingSlot) { await transaction.rollback(); return res.status(409).json({ error: "هذا الفريق لم يعد متاحاً" }); }
    const team = await TournamentTeam.create({ tournamentId: tournament.id, teamNumber, name, joinCode: randomCode(), createdBy: req.user.id }, { transaction });
    const slot = await TournamentSlot.findOne({ where: { tournamentId: tournament.id, teamNumber, code: positionCode, userId: null }, transaction, lock: transaction.LOCK.UPDATE });
    if (!slot) { await transaction.rollback(); return res.status(400).json({ error: "المركز المختار غير صحيح" }); }
    await slot.update({ tournamentTeamId: team.id, userId: req.user.id, assignedAt: new Date() }, { transaction });
    await TournamentSlot.update({ tournamentTeamId: team.id }, { where: { tournamentId: tournament.id, teamNumber }, transaction });
    await transaction.commit();
    return res.status(201).json({ message: "تم إنشاء فريقك", teamId: team.id, joinCode: team.joinCode });
  } catch (error) { await transaction.rollback(); console.error("Create tournament team error:", error); return res.status(500).json({ error: "Internal Server Error" }); }
});

router.post("/tournaments/:id/teams/join", authenticateToken, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const tournament = await tournamentForRequest(req, res, req.params.id, transaction);
    if (!tournament) { await transaction.rollback(); return; }
    const joinCode = String(req.body.joinCode || "").trim().toUpperCase();
    const positionCode = String(req.body.positionCode || "");
    if (tournament.status !== "open" || !joinCode || !positionCode) { await transaction.rollback(); return res.status(400).json({ error: "بيانات الانضمام غير مكتملة" }); }
    if (await hasTournamentEntry(tournament.id, req.user.id, transaction)) { await transaction.rollback(); return res.status(409).json({ error: "أنت مسجل مسبقاً في هذه البطولة" }); }
    const team = await TournamentTeam.findOne({ where: { tournamentId: tournament.id, joinCode }, transaction, lock: transaction.LOCK.UPDATE });
    if (!team) { await transaction.rollback(); return res.status(404).json({ error: "كود الفريق غير صحيح" }); }
    const slot = await TournamentSlot.findOne({ where: { tournamentId: tournament.id, tournamentTeamId: team.id, code: positionCode, userId: null }, transaction, lock: transaction.LOCK.UPDATE });
    if (!slot) { await transaction.rollback(); return res.status(409).json({ error: "هذا المركز غير متاح" }); }
    await slot.update({ userId: req.user.id, assignedAt: new Date() }, { transaction });
    await transaction.commit();
    return res.json({ message: "تم الانضمام إلى الفريق", teamId: team.id });
  } catch (error) { await transaction.rollback(); console.error("Join tournament team error:", error); return res.status(500).json({ error: "Internal Server Error" }); }
});

router.delete("/tournaments/:id/slots/:slotId", authenticateToken, async (req, res) => {
  try {
    if (!canManage(req.user)) return res.status(403).json({ error: "Not allowed" });
    const tournament = await tournamentForRequest(req, res, req.params.id);
    if (!tournament) return;
    const slot = await TournamentSlot.findOne({ where: { id: req.params.slotId, tournamentId: tournament.id } });
    if (!slot) return res.status(404).json({ error: "المركز غير موجود" });
    await slot.update({ userId: null, assignedAt: null });
    return res.json({ message: "تم حذف الحجز" });
  } catch (error) { console.error("Remove tournament slot error:", error); return res.status(500).json({ error: "Internal Server Error" }); }
});

router.delete("/tournaments/:id", authenticateToken, async (req, res) => {
  try {
    if (!canManage(req.user)) return res.status(403).json({ error: "Not allowed" });
    const tournament = await tournamentForRequest(req, res, req.params.id);
    if (!tournament) return;
    await tournament.destroy();
    return res.json({ message: "تم حذف البطولة" });
  } catch (error) { console.error("Delete tournament error:", error); return res.status(500).json({ error: "Internal Server Error" }); }
});

module.exports = router;
