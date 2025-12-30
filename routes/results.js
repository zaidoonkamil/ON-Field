const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const { Game, GameSlot, User, MatchStats, PlayerMatchStats } = require("../models");
const { authenticateToken } = require("../middlewares/auth.js");

const calcOverall = (u) =>
  Math.round((u.spd + u.fin + u.pas + u.skl + u.tkl + u.str) / 6);

// ✅ إدخال/تحديث نتائج مباراة كاملة (Admin)
router.post("/games/:id/results", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Not allowed" });
    }

    const gameId = Number(req.params.id);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      return res.status(400).json({ error: "gameId غير صحيح" });
    }

    const game = await Game.findByPk(gameId);
    if (!game) return res.status(404).json({ error: "المباراة غير موجودة" });

    const { matchStats, playersStats, motmUserId } = req.body;

    const errors = [];

    const isNonNegNumber = (v) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0;

    const isNonNegInt = (v) =>
      Number.isInteger(v) && v >= 0;

    const isPercent = (v) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;

    // =======================
    // Validate matchStats
    // =======================
    if (matchStats !== undefined && (typeof matchStats !== "object" || matchStats === null || Array.isArray(matchStats))) {
      errors.push("matchStats لازم يكون object");
    }

    let pA = 50;
    let pB = 50;

    if (matchStats) {
      const intFields = [
        "offsidesA","offsidesB",
        "cornersA","cornersB",
        "bigChancesA","bigChancesB",
        "shotsA","shotsB",
      ];

      for (const f of intFields) {
        if (matchStats[f] !== undefined && !isNonNegInt(matchStats[f])) {
          errors.push(`${f} لازم يكون عدد صحيح >= 0`);
        }
      }

      // xG floats >= 0
      const floatFields = ["xgA","xgB"];
      for (const f of floatFields) {
        if (matchStats[f] !== undefined && !isNonNegNumber(matchStats[f])) {
          errors.push(`${f} لازم يكون رقم >= 0`);
        }
      }

      // possession
      const hasPA = matchStats.possessionA !== undefined;
      const hasPB = matchStats.possessionB !== undefined;

      if (hasPA && !isPercent(matchStats.possessionA)) {
        errors.push("possessionA لازم يكون بين 0 و 100");
      }
      if (hasPB && !isPercent(matchStats.possessionB)) {
        errors.push("possessionB لازم يكون بين 0 و 100");
      }

      if (hasPA && hasPB && (matchStats.possessionA + matchStats.possessionB !== 100)) {
        errors.push("مجموع possessionA + possessionB لازم يساوي 100");
      }

      // قيم افتراضية/تكملة تلقائية
      if (hasPA) {
        pA = matchStats.possessionA;
        pB = hasPB ? matchStats.possessionB : (100 - pA);
      } else if (hasPB) {
        pB = matchStats.possessionB;
        pA = 100 - pB;
      }
    }

    // =======================
    // Validate playersStats
    // =======================
    if (playersStats !== undefined && !Array.isArray(playersStats)) {
      errors.push("playersStats لازم يكون Array");
    }

    const seenUsers = new Set();
    const validTeams = new Set(["A", "B"]);

    if (Array.isArray(playersStats)) {
      for (let i = 0; i < playersStats.length; i++) {
        const p = playersStats[i];

        if (typeof p !== "object" || p === null || Array.isArray(p)) {
          errors.push(`playersStats[${i}] لازم يكون object`);
          continue;
        }

        if (!p.userId || !Number.isInteger(Number(p.userId))) {
          errors.push(`playersStats[${i}].userId مطلوب ولازم يكون رقم صحيح`);
        } else {
          const uid = Number(p.userId);
          if (seenUsers.has(uid)) {
            errors.push(`playersStats: userId مكرر (${uid})`);
          }
          seenUsers.add(uid);
        }

        if (!p.team || !validTeams.has(p.team)) {
          errors.push(`playersStats[${i}].team لازم يكون "A" أو "B"`);
        }

        const statInts = ["goals", "assists", "yellowCards", "redCards"];
        for (const f of statInts) {
          if (p[f] !== undefined && !isNonNegInt(p[f])) {
            errors.push(`playersStats[${i}].${f} لازم يكون عدد صحيح >= 0`);
          }
        }
      }
    }

    // motmUserId validation
    if (motmUserId !== undefined && motmUserId !== null) {
      const motm = Number(motmUserId);
      if (!Number.isInteger(motm) || motm <= 0) {
        errors.push("motmUserId لازم يكون رقم صحيح");
      } else if (Array.isArray(playersStats) && playersStats.length > 0) {
        // لازم يكون ضمن اللاعبين المرسلين
        if (!seenUsers.has(motm)) {
          errors.push("motmUserId لازم يكون ضمن playersStats");
        }
      }
    }

    // إذا اكو أخطاء رجّعها كلها مرة وحدة
    if (errors.length) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }

    // =======================
    // Save (بعد ما صار كلشي صحيح)
    // =======================
    if (matchStats) {
      await MatchStats.upsert({
        gameId,

        offsidesA: matchStats.offsidesA ?? 0,
        offsidesB: matchStats.offsidesB ?? 0,

        cornersA: matchStats.cornersA ?? 0,
        cornersB: matchStats.cornersB ?? 0,

        bigChancesA: matchStats.bigChancesA ?? 0,
        bigChancesB: matchStats.bigChancesB ?? 0,

        shotsA: matchStats.shotsA ?? 0,
        shotsB: matchStats.shotsB ?? 0,

        xgA: matchStats.xgA ?? 0,
        xgB: matchStats.xgB ?? 0,

        possessionA: pA,
        possessionB: pB,
      });
    }

    if (Array.isArray(playersStats)) {
      await PlayerMatchStats.update({ isMotm: false }, { where: { gameId } });

      for (const p of playersStats) {
        await PlayerMatchStats.upsert({
          gameId,
          userId: Number(p.userId),
          team: p.team,
          goals: p.goals ?? 0,
          assists: p.assists ?? 0,
          yellowCards: p.yellowCards ?? 0,
          redCards: p.redCards ?? 0,
          isMotm: motmUserId ? Number(p.userId) === Number(motmUserId) : false,
        });
      }
    }

    await game.update({ status: "closed" });

    return res.json({ message: "تم حفظ النتائج" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ عرض النتائج (للجميع) + التشكيلات + بطاقات اللاعبين + احصائيات المباراة
router.get("/games/:id/results", async (req, res) => {
  try {
    const gameId = Number(req.params.id);

    const game = await Game.findByPk(gameId);
    if (!game) return res.status(404).json({ error: "المباراة غير موجودة" });

    const slots = await GameSlot.findAll({
      where: { gameId },
      include: [{ model: User, as: "user", attributes: { exclude: ["password"] } }],
      order: [["team", "ASC"], ["role", "ASC"], ["code", "ASC"]],
    });

    const mappedSlots = slots.map((s) => {
      const j = s.toJSON();
      if (j.user) j.user.overall = calcOverall(j.user);
      return j;
    });

    const matchStats = await MatchStats.findOne({ where: { gameId } });

    const playerStats = await PlayerMatchStats.findAll({
      where: { gameId },
      include: [{ model: User, as: "user", attributes: { exclude: ["password"] } }],
      order: [["isMotm", "DESC"], ["goals", "DESC"], ["assists", "DESC"]],
    });

    const mappedPlayerStats = playerStats.map((p) => {
      const j = p.toJSON();
      if (j.user) j.user.overall = calcOverall(j.user);
      return j;
    });

    const sumByTeam = (arr, team, key) =>
      arr
        .filter((p) => p.team === team)
        .reduce((s, p) => s + (Number(p[key]) || 0), 0);

    const goalsA = sumByTeam(mappedPlayerStats, "A", "goals");
    const goalsB = sumByTeam(mappedPlayerStats, "B", "goals");

    const assistsA = sumByTeam(mappedPlayerStats, "A", "assists");
    const assistsB = sumByTeam(mappedPlayerStats, "B", "assists");

    const yellowA = sumByTeam(mappedPlayerStats, "A", "yellowCards");
    const yellowB = sumByTeam(mappedPlayerStats, "B", "yellowCards");

    const redA = sumByTeam(mappedPlayerStats, "A", "redCards");
    const redB = sumByTeam(mappedPlayerStats, "B", "redCards");

    const motm = mappedPlayerStats.find((p) => p.isMotm === true) || null;

    return res.json({
      game,
      lineups: mappedSlots,
      matchStats,
      playerStats: mappedPlayerStats,

      score: { goalsA, goalsB },
      totals: {
        assistsA,
        assistsB,
        yellowCardsA: yellowA,
        yellowCardsB: yellowB,
        redCardsA: redA,
        redCardsB: redB,
      },
      motm,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
