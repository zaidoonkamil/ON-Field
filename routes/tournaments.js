const express = require("express");
const crypto = require("crypto");
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const upload = require("../middlewares/uploads");
const { authenticateToken, optionalAuthenticateToken } = require("../middlewares/auth");
const { isAdmin, isSuperAdmin, getGovernorateScope, applyGovernorateScope, ensureGovernorateAccess } = require("../services/accessScope");
const {
  Tournament,
  TournamentTeam,
  TournamentSlot,
  TournamentMatch,
  TournamentMatchStats,
  TournamentPlayerMatchStats,
  User,
} = require("../models");

const router = express.Router();
const userAttributes = [
  "id",
  "name",
  "phone",
  "image",
  "position",
  "spd",
  "fin",
  "pas",
  "skl",
  "tkl",
  "str",
  "isVerified",
];

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

const calcOverall = (u) =>
  Math.round(((Number(u.spd) || 0) + (Number(u.fin) || 0) + (Number(u.pas) || 0) + (Number(u.skl) || 0) + (Number(u.tkl) || 0) + (Number(u.str) || 0)) / 6);

const statsIncludeUser = [{ model: User, as: "user", attributes: { exclude: ["password"] } }];

function teamInclude() {
  return [
    { model: TournamentTeam, as: "teamA", required: false },
    { model: TournamentTeam, as: "teamB", required: false },
    { model: TournamentMatchStats, as: "matchStats", required: false },
    { model: TournamentPlayerMatchStats, as: "playerStats", required: false, include: statsIncludeUser },
  ];
}

function matchScore(playerStats = []) {
  const sum = (side) => playerStats
    .filter((item) => item.teamSide === side)
    .reduce((total, item) => total + (Number(item.goals) || 0), 0);
  return { goalsA: sum("A"), goalsB: sum("B") };
}

function serializeMatch(match) {
  const data = typeof match.toJSON === "function" ? match.toJSON() : match;
  const playerStats = data.playerStats || [];
  for (const stat of playerStats) {
    attachOverallToUser(stat.user);
  }
  const storedScoreA = data.scoreA == null ? null : Number(data.scoreA);
  const storedScoreB = data.scoreB == null ? null : Number(data.scoreB);
  return {
    ...data,
    score: Number.isFinite(storedScoreA) && Number.isFinite(storedScoreB)
      ? { goalsA: storedScoreA, goalsB: storedScoreB }
      : matchScore(playerStats),
  };
}

function attachOverallToUser(user) {
  if (!user) return;
  const overall = calcOverall(user);
  if (typeof user.setDataValue === "function") {
    user.setDataValue("overall", overall);
  } else {
    user.overall = overall;
  }
}

function attachOverallToSlots(slots = []) {
  for (const slot of slots) {
    attachOverallToUser(slot.user);
  }
}

async function qualifiedTeams(tournamentId, transaction) {
  return TournamentTeam.findAll({
    where: { tournamentId },
    order: [["teamNumber", "ASC"]],
    transaction,
  });
}

async function ensureTournamentTeams(tournament, transaction) {
  const capacity = Number(tournament.teamCapacity);
  if (!Number.isInteger(capacity) || capacity < 2) return [];

  for (let teamNumber = 1; teamNumber <= capacity; teamNumber += 1) {
    let team = await TournamentTeam.findOne({
      where: { tournamentId: tournament.id, teamNumber },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!team) {
      team = await TournamentTeam.create({
        tournamentId: tournament.id,
        teamNumber,
        name: `الفريق ${teamNumber}`,
        joinCode: randomCode(),
        createdBy: null,
      }, { transaction });
    }

    await TournamentSlot.update(
      { tournamentTeamId: team.id },
      { where: { tournamentId: tournament.id, teamNumber }, transaction }
    );
  }

  return qualifiedTeams(tournament.id, transaction);
}

function knockoutRoundLabel(capacity, roundIndex = 1) {
  const totalRounds = Math.log2(Number(capacity) || 2);
  const teamsInRound = Math.max(2, Math.round((Number(capacity) || 2) / Math.pow(2, roundIndex - 1)));
  if (roundIndex >= totalRounds) return "النهائي";
  if (roundIndex === totalRounds - 1) return "نصف النهائي";
  if (roundIndex === totalRounds - 2) return "ربع النهائي";
  return `دور ${teamsInRound}`;
}

function groupNameForIndex(index) {
  const names = ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح", "ط", "ي", "ك", "ل", "م", "ن", "س", "ع"];
  return names[index] || `${index + 1}`;
}

async function buildInitialTournamentMatches(tournament, transaction) {
  const teams = await ensureTournamentTeams(tournament, transaction);
  if (teams.length < 2) return [];

  const capacity = Number(tournament.teamCapacity);
  const matches = [];
  if (capacity === 64 || tournament.competitionFormat === "groups") {
    const groupCount = 16;
    const grouped = Array.from({ length: groupCount }, () => []);
    teams.forEach((team, index) => grouped[index % groupCount].push(team));
    grouped.forEach((groupTeams, groupIndex) => {
      for (let i = 0; i < groupTeams.length; i += 1) {
        for (let j = i + 1; j < groupTeams.length; j += 1) {
          matches.push({
            tournamentId: tournament.id,
            teamAId: groupTeams[i].id,
            teamBId: groupTeams[j].id,
            roundIndex: 1,
            roundLabel: "دور المجموعات",
            groupName: groupNameForIndex(groupIndex),
          });
        }
      }
    });
  } else {
    const label = knockoutRoundLabel(capacity);
    for (let i = 0; i < teams.length; i += 2) {
      if (!teams[i + 1]) break;
      matches.push({
        tournamentId: tournament.id,
        teamAId: teams[i].id,
        teamBId: teams[i + 1].id,
        roundIndex: 1,
        roundLabel: label,
      });
    }
    const totalRounds = Math.log2(capacity);
    for (let roundIndex = 2; roundIndex <= totalRounds; roundIndex += 1) {
      const matchCount = capacity / Math.pow(2, roundIndex);
      for (let i = 0; i < matchCount; i += 1) {
        matches.push({
          tournamentId: tournament.id,
          teamAId: null,
          teamBId: null,
          roundIndex,
          roundLabel: knockoutRoundLabel(capacity, roundIndex),
        });
      }
    }
  }
  return matches;
}

async function advanceKnockoutWinner(tournament, match, winnerTeamId, transaction) {
  if (!winnerTeamId || tournament.competitionFormat === "groups") return;

  const capacity = Number(tournament.teamCapacity);
  const totalRounds = Math.log2(capacity);
  const currentRound = Number(match.roundIndex) || 1;
  if (!Number.isInteger(totalRounds) || currentRound >= totalRounds) return;

  const currentRoundMatches = await TournamentMatch.findAll({
    where: { tournamentId: tournament.id, roundIndex: currentRound },
    order: [["id", "ASC"]],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  const currentIndex = currentRoundMatches.findIndex((item) => Number(item.id) === Number(match.id));
  if (currentIndex < 0) return;

  const nextRound = currentRound + 1;
  const nextMatchIndex = Math.floor(currentIndex / 2);
  const nextSide = currentIndex % 2 === 0 ? "teamAId" : "teamBId";
  const nextRoundLabel = knockoutRoundLabel(capacity, nextRound);

  let nextMatch = (await TournamentMatch.findAll({
    where: { tournamentId: tournament.id, roundIndex: nextRound },
    order: [["id", "ASC"]],
    transaction,
    lock: transaction.LOCK.UPDATE,
  }))[nextMatchIndex];

  if (!nextMatch) {
    const nextRoundMatchCount = capacity / Math.pow(2, nextRound);
    const createdMatches = [];
    for (let i = 0; i < nextRoundMatchCount; i += 1) {
      createdMatches.push(await TournamentMatch.create({
        tournamentId: tournament.id,
        teamAId: null,
        teamBId: null,
        roundIndex: nextRound,
        roundLabel: nextRoundLabel,
        status: "scheduled",
      }, { transaction }));
    }
    nextMatch = createdMatches[nextMatchIndex];
  }

  await nextMatch.update({
    [nextSide]: winnerTeamId,
    roundLabel: nextRoundLabel,
  }, { transaction });
}

async function syncClosedKnockoutWinners(tournament, transaction) {
  if (tournament.competitionFormat === "groups") return;
  const closedMatches = await TournamentMatch.findAll({
    where: { tournamentId: tournament.id, status: "closed" },
    order: [["roundIndex", "ASC"], ["id", "ASC"]],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  for (const match of closedMatches) {
    let score = null;
    if (match.scoreA != null && match.scoreB != null) {
      score = { goalsA: Number(match.scoreA) || 0, goalsB: Number(match.scoreB) || 0 };
    } else {
      const playerStats = await TournamentPlayerMatchStats.findAll({
        where: { tournamentMatchId: match.id },
        transaction,
      });
      score = matchScore(playerStats.map((item) => item.toJSON()));
    }
    if (score.goalsA === score.goalsB) continue;
    await advanceKnockoutWinner(
      tournament,
      match,
      score.goalsA > score.goalsB ? match.teamAId : match.teamBId,
      transaction
    );
  }
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
    attachOverallToSlots(data.slots);
    data.mySlot = data.slots.find((slot) => Number(slot.userId) === Number(req.user.id)) || null;
    return res.json(data);
  } catch (error) {
    console.error("Get tournament detail error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/tournaments", authenticateToken, upload.single("bannerImage"), async (req, res) => {
  let transaction;
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
    transaction = await sequelize.transaction();
    const tournament = await Tournament.create({
      title: String(title).trim(), startsAt, formationSize: String(formationSize), teamCapacity: String(capacity),
      competitionFormat, bannerImage: req.file?.filename || null, governorateId: req.user.governorateId || null, createdBy: req.user.id,
    }, { transaction });
    const slots = [];
    for (let teamNumber = 1; teamNumber <= capacity; teamNumber += 1) {
      for (const slot of formation(formationSize)) slots.push({ tournamentId: tournament.id, teamNumber, ...slot });
    }
    await TournamentSlot.bulkCreate(slots, { transaction });
    await transaction.commit();
    return res.status(201).json({ message: "تم إنشاء البطولة", tournamentId: tournament.id });
  } catch (error) {
    if (transaction) await transaction.rollback();
    console.error("Create tournament error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/tournaments/:id/start", authenticateToken, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    if (!canManage(req.user)) { await transaction.rollback(); return res.status(403).json({ error: "Not allowed" }); }
    const tournament = await tournamentForRequest(req, res, req.params.id, transaction);
    if (!tournament) { await transaction.rollback(); return; }
    if (tournament.status !== "open") {
      await transaction.rollback();
      return res.status(400).json({ error: "البطولة بدأت أو مغلقة مسبقاً" });
    }
    await tournament.update({ status: "closed" }, { transaction });
    const existingMatches = await TournamentMatch.count({ where: { tournamentId: tournament.id }, transaction });
    if (existingMatches === 0) {
      const matches = await buildInitialTournamentMatches(tournament, transaction);
      if (matches.length) await TournamentMatch.bulkCreate(matches, { transaction });
    }
    await transaction.commit();
    return res.json({ message: "تم بدء البطولة وإغلاق التسجيل", tournament });
  } catch (error) {
    await transaction.rollback();
    console.error("Start tournament error:", error);
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

router.post("/tournaments/:id/teams/:teamId/slots/:slotId/assign", authenticateToken, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const tournament = await tournamentForRequest(req, res, req.params.id, transaction);
    if (!tournament) { await transaction.rollback(); return; }
    const team = await TournamentTeam.findOne({
      where: { id: req.params.teamId, tournamentId: tournament.id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!team) { await transaction.rollback(); return res.status(404).json({ error: "الفريق غير موجود" }); }
    if (tournament.status !== "open" && !canManage(req.user)) {
      await transaction.rollback();
      return res.status(403).json({ error: "التسجيل مغلق، الادمن فقط يستطيع إضافة اللاعبين" });
    }
    if (!canManage(req.user) && Number(team.createdBy) !== Number(req.user.id)) {
      await transaction.rollback();
      return res.status(403).json({ error: "فقط قائد الفريق يستطيع إضافة اللاعبين" });
    }
    const userId = toNumber(req.body.userId);
    const player = userId ? await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE }) : null;
    if (!player || Number(player.governorateId) !== Number(tournament.governorateId)) {
      await transaction.rollback();
      return res.status(404).json({ error: "اللاعب غير متاح ضمن هذه المحافظة" });
    }
    if (await hasTournamentEntry(tournament.id, player.id, transaction)) {
      await transaction.rollback();
      return res.status(409).json({ error: "اللاعب مسجل مسبقاً في البطولة" });
    }
    const slot = await TournamentSlot.findOne({
      where: { id: req.params.slotId, tournamentId: tournament.id, tournamentTeamId: team.id, userId: null },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!slot) { await transaction.rollback(); return res.status(409).json({ error: "هذا المركز لم يعد متاحاً" }); }
    await slot.update({ userId: player.id, assignedAt: new Date() }, { transaction });
    await transaction.commit();
    return res.json({ message: "تمت إضافة اللاعب إلى الفريق" });
  } catch (error) {
    await transaction.rollback();
    console.error("Assign tournament player error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
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

router.post("/tournaments/:id/draw/generate", authenticateToken, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    if (!canManage(req.user)) { await transaction.rollback(); return res.status(403).json({ error: "Not allowed" }); }
    const tournament = await tournamentForRequest(req, res, req.params.id, transaction);
    if (!tournament) { await transaction.rollback(); return; }
    const teams = await ensureTournamentTeams(tournament, transaction);
    if (teams.length < 2) {
      await transaction.rollback();
      return res.status(400).json({ error: "لا توجد فرق كافية لإنشاء القرعة" });
    }

    await TournamentMatch.destroy({ where: { tournamentId: tournament.id }, transaction });

    const matches = await buildInitialTournamentMatches(tournament, transaction);

    await TournamentMatch.bulkCreate(matches, { transaction });
    await transaction.commit();
    return res.status(201).json({ message: "تم إنشاء القرعة", count: matches.length });
  } catch (error) {
    await transaction.rollback();
    console.error("Generate tournament draw error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/tournaments/:id/matches", authenticateToken, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const tournament = await tournamentForRequest(req, res, req.params.id, transaction);
    if (!tournament) { await transaction.rollback(); return; }
    await syncClosedKnockoutWinners(tournament, transaction);
    const matches = await TournamentMatch.findAll({
      where: { tournamentId: tournament.id },
      include: teamInclude(),
      order: [["roundIndex", "ASC"], ["groupName", "ASC"], ["id", "ASC"]],
      transaction,
    });
    await transaction.commit();
    return res.json({
      tournament,
      matches: matches.map(serializeMatch),
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Get tournament matches error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/tournaments/:id/matches", authenticateToken, async (req, res) => {
  try {
    if (!canManage(req.user)) return res.status(403).json({ error: "Not allowed" });
    const tournament = await tournamentForRequest(req, res, req.params.id);
    if (!tournament) return;
    const teamAId = toNumber(req.body.teamAId);
    const teamBId = toNumber(req.body.teamBId);
    if (!teamAId || !teamBId || teamAId === teamBId) {
      return res.status(400).json({ error: "اختر فريقين مختلفين" });
    }
    const count = await TournamentTeam.count({
      where: { tournamentId: tournament.id, id: { [Op.in]: [teamAId, teamBId] } },
    });
    if (count !== 2) return res.status(400).json({ error: "الفرق المختارة غير صحيحة" });
    const match = await TournamentMatch.create({
      tournamentId: tournament.id,
      teamAId,
      teamBId,
      roundIndex: toNumber(req.body.roundIndex) || 1,
      roundLabel: String(req.body.roundLabel || "الجولة 1").trim(),
      groupName: req.body.groupName ? String(req.body.groupName).trim() : null,
      startsAt: req.body.startsAt || null,
    });
    return res.status(201).json({ message: "تمت إضافة المباراة", match });
  } catch (error) {
    console.error("Create tournament match error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.patch("/tournaments/:id/matches/:matchId", authenticateToken, async (req, res) => {
  try {
    if (!canManage(req.user)) return res.status(403).json({ error: "Not allowed" });
    const tournament = await tournamentForRequest(req, res, req.params.id);
    if (!tournament) return;
    const match = await TournamentMatch.findOne({ where: { id: req.params.matchId, tournamentId: tournament.id } });
    if (!match) return res.status(404).json({ error: "المباراة غير موجودة" });
    if (match.status !== "scheduled") return res.status(400).json({ error: "لا يمكن تعديل مباراة بدأت أو انتهت" });
    const updates = {};
    for (const key of ["teamAId", "teamBId", "roundIndex", "roundLabel", "groupName", "startsAt", "status"]) {
      if (req.body[key] !== undefined) updates[key] = req.body[key] || null;
    }
    if (updates.teamAId && updates.teamBId && Number(updates.teamAId) === Number(updates.teamBId)) {
      return res.status(400).json({ error: "اختر فريقين مختلفين" });
    }
    await match.update(updates);
    return res.json({ message: "تم تحديث المباراة", match });
  } catch (error) {
    console.error("Update tournament match error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/tournaments/:id/matches/:matchId/results", authenticateToken, async (req, res) => {
  try {
    const tournament = await tournamentForRequest(req, res, req.params.id);
    if (!tournament) return;
    const match = await TournamentMatch.findOne({
      where: { id: req.params.matchId, tournamentId: tournament.id },
      include: teamInclude(),
    });
    if (!match) return res.status(404).json({ error: "المباراة غير موجودة" });
    const lineups = await TournamentSlot.findAll({
      where: {
        tournamentId: tournament.id,
        tournamentTeamId: { [Op.in]: [match.teamAId, match.teamBId] },
      },
      include: [{ model: User, as: "user", attributes: userAttributes, required: false }],
      order: [["tournamentTeamId", "ASC"], ["role", "ASC"], ["code", "ASC"]],
    });
    const mappedLineups = lineups.map((slot) => slot.toJSON());
    attachOverallToSlots(mappedLineups);
    return res.json({ tournament, match: serializeMatch(match), lineups: mappedLineups });
  } catch (error) {
    console.error("Get tournament match result error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/tournaments/:id/matches/:matchId/results", authenticateToken, async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    if (!canManage(req.user)) { await transaction.rollback(); return res.status(403).json({ error: "Not allowed" }); }
    const tournament = await tournamentForRequest(req, res, req.params.id, transaction);
    if (!tournament) { await transaction.rollback(); return; }
    const match = await TournamentMatch.findOne({
      where: { id: req.params.matchId, tournamentId: tournament.id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!match) { await transaction.rollback(); return res.status(404).json({ error: "المباراة غير موجودة" }); }

    const matchStats = req.body.matchStats || {};
    const playersStats = Array.isArray(req.body.playersStats) ? req.body.playersStats : [];
    const motmUserId = req.body.motmUserId ? Number(req.body.motmUserId) : null;
    const directScore = req.body.score || {};
    let possessionA = Number(matchStats.possessionA ?? 50);
    let possessionB = Number(matchStats.possessionB ?? (100 - possessionA));
    if (!Number.isFinite(possessionA)) possessionA = 50;
    if (!Number.isFinite(possessionB)) possessionB = 50;

    await TournamentMatchStats.upsert({
      tournamentMatchId: match.id,
      offsidesA: Number(matchStats.offsidesA) || 0,
      offsidesB: Number(matchStats.offsidesB) || 0,
      cornersA: Number(matchStats.cornersA) || 0,
      cornersB: Number(matchStats.cornersB) || 0,
      bigChancesA: Number(matchStats.bigChancesA) || 0,
      bigChancesB: Number(matchStats.bigChancesB) || 0,
      shotsA: Number(matchStats.shotsA) || 0,
      shotsB: Number(matchStats.shotsB) || 0,
      xgA: Number(matchStats.xgA) || 0,
      xgB: Number(matchStats.xgB) || 0,
      possessionA,
      possessionB,
    }, { transaction });

    await TournamentPlayerMatchStats.destroy({ where: { tournamentMatchId: match.id }, transaction });
    let goalsA = 0;
    let goalsB = 0;
    for (const item of playersStats) {
      const userId = Number(item.userId);
      const teamSide = item.teamSide === "B" || item.team === "B" ? "B" : "A";
      const tournamentTeamId = teamSide === "A" ? match.teamAId : match.teamBId;
      if (!Number.isInteger(userId) || userId <= 0) continue;
      if (teamSide === "A") goalsA += Number(item.goals) || 0;
      if (teamSide === "B") goalsB += Number(item.goals) || 0;
      await TournamentPlayerMatchStats.create({
        tournamentMatchId: match.id,
        tournamentId: tournament.id,
        userId,
        teamSide,
        tournamentTeamId,
        goals: Number(item.goals) || 0,
        assists: Number(item.assists) || 0,
        yellowCards: Number(item.yellowCards) || 0,
        redCards: Number(item.redCards) || 0,
        isMotm: motmUserId ? userId === motmUserId : false,
        individualAward: item.individualAward || null,
      }, { transaction });
    }
    const scoreA = Number.isFinite(Number(directScore.goalsA ?? directScore.scoreA))
      ? Number(directScore.goalsA ?? directScore.scoreA)
      : goalsA;
    const scoreB = Number.isFinite(Number(directScore.goalsB ?? directScore.scoreB))
      ? Number(directScore.goalsB ?? directScore.scoreB)
      : goalsB;

    await match.update({ status: "closed", scoreA, scoreB }, { transaction });
    if (scoreA !== scoreB) {
      await advanceKnockoutWinner(
        tournament,
        match,
        scoreA > scoreB ? match.teamAId : match.teamBId,
        transaction
      );
    }
    await transaction.commit();
    return res.json({ message: "تم حفظ نتيجة مباراة البطولة" });
  } catch (error) {
    await transaction.rollback();
    console.error("Save tournament match result error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/tournaments/:id/dashboard", authenticateToken, async (req, res) => {
  try {
    const tournament = await tournamentForRequest(req, res, req.params.id);
    if (!tournament) return;
    const stats = await TournamentPlayerMatchStats.findAll({
      where: { tournamentId: tournament.id },
      include: statsIncludeUser,
    });
    const byUser = new Map();
    for (const row of stats.map((item) => item.toJSON())) {
      const current = byUser.get(row.userId) || {
        user: row.user,
        games: 0,
        goals: 0,
        assists: 0,
        yellowCards: 0,
        redCards: 0,
        motm: 0,
      };
      current.games += 1;
      current.goals += Number(row.goals) || 0;
      current.assists += Number(row.assists) || 0;
      current.yellowCards += Number(row.yellowCards) || 0;
      current.redCards += Number(row.redCards) || 0;
      if (row.isMotm) current.motm += 1;
      if (current.user) current.user.overall = calcOverall(current.user);
      byUser.set(row.userId, current);
    }
    const players = [...byUser.values()];
    const top = (key) => [...players].sort((a, b) => (b[key] || 0) - (a[key] || 0)).slice(0, 10);
    return res.json({
      tournament,
      leaders: {
        goals: top("goals"),
        assists: top("assists"),
        cards: [...players].sort((a, b) => ((b.yellowCards + b.redCards) - (a.yellowCards + a.redCards))).slice(0, 10),
        motm: top("motm"),
      },
    });
  } catch (error) {
    console.error("Tournament dashboard error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
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
