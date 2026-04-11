const express = require("express");
const router = express.Router();
const {
  Game,
  GameSlot,
  User,
  MatchStats,
  PlayerMatchStats,
  Post,
} = require("../models");
const {
  authenticateToken,
  optionalAuthenticateToken,
} = require("../middlewares/auth.js");
const {
  isAdmin,
  isSuperAdmin,
  getGovernorateScope,
  ensureGovernorateAccess,
} = require("../services/accessScope");

const calcOverall = (u) =>
  Math.round((u.spd + u.fin + u.pas + u.skl + u.tkl + u.str) / 6);

router.post("/games/:id/results", authenticateToken, async (req, res) => {
  try {
    if (!isAdmin(req.user) && !isSuperAdmin(req.user)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const gameId = Number(req.params.id);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      return res.status(400).json({ error: "Invalid gameId" });
    }

    const game = await Game.findByPk(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (!ensureGovernorateAccess(req, res, game.governorateId)) {
      return;
    }

    const { matchStats, playersStats, motmUserId } = req.body;
    const errors = [];

    const isNonNegNumber = (v) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0;
    const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;
    const isPercent = (v) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;

    if (
      matchStats !== undefined &&
      (typeof matchStats !== "object" || matchStats === null || Array.isArray(matchStats))
    ) {
      errors.push("matchStats must be an object");
    }

    let pA = 50;
    let pB = 50;

    if (matchStats) {
      const intFields = [
        "offsidesA",
        "offsidesB",
        "cornersA",
        "cornersB",
        "bigChancesA",
        "bigChancesB",
        "shotsA",
        "shotsB",
      ];

      for (const f of intFields) {
        if (matchStats[f] !== undefined && !isNonNegInt(matchStats[f])) {
          errors.push(`${f} must be an integer >= 0`);
        }
      }

      const floatFields = ["xgA", "xgB"];
      for (const f of floatFields) {
        if (matchStats[f] !== undefined && !isNonNegNumber(matchStats[f])) {
          errors.push(`${f} must be a number >= 0`);
        }
      }

      const hasPA = matchStats.possessionA !== undefined;
      const hasPB = matchStats.possessionB !== undefined;

      if (hasPA && !isPercent(matchStats.possessionA)) {
        errors.push("possessionA must be between 0 and 100");
      }
      if (hasPB && !isPercent(matchStats.possessionB)) {
        errors.push("possessionB must be between 0 and 100");
      }

      if (hasPA && hasPB && matchStats.possessionA + matchStats.possessionB !== 100) {
        errors.push("possessionA + possessionB must equal 100");
      }

      if (hasPA) {
        pA = matchStats.possessionA;
        pB = hasPB ? matchStats.possessionB : 100 - pA;
      } else if (hasPB) {
        pB = matchStats.possessionB;
        pA = 100 - pB;
      }
    }

    if (playersStats !== undefined && !Array.isArray(playersStats)) {
      errors.push("playersStats must be an array");
    }

    const validTeams = new Set(["A", "B"]);

    if (Array.isArray(playersStats)) {
      for (let i = 0; i < playersStats.length; i += 1) {
        const p = playersStats[i];

        if (typeof p !== "object" || p === null || Array.isArray(p)) {
          errors.push(`playersStats[${i}] must be an object`);
          continue;
        }

        if (!p.userId || !Number.isInteger(Number(p.userId))) {
          errors.push(`playersStats[${i}].userId is invalid`);
        }

        if (!p.team || !validTeams.has(p.team)) {
          errors.push(`playersStats[${i}].team must be A or B`);
        }

        const statInts = ["goals", "assists", "yellowCards", "redCards"];
        for (const f of statInts) {
          if (p[f] !== undefined && !isNonNegInt(p[f])) {
            errors.push(`playersStats[${i}].${f} must be an integer >= 0`);
          }
        }
      }
    }

    if (motmUserId !== undefined && motmUserId !== null) {
      const motm = Number(motmUserId);

      if (!Number.isInteger(motm) || motm <= 0) {
        errors.push("motmUserId must be a valid integer");
      } else if (Array.isArray(playersStats) && playersStats.length > 0) {
        const existsInPlayers = playersStats.some((p) => Number(p?.userId) === motm);
        if (!existsInPlayers) {
          errors.push("motmUserId must exist inside playersStats");
        }
      }
    }

    if (errors.length) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }

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

    const wasOpen = game.status === "open";
    await game.update({ status: "closed" });
    if (wasOpen) {
      await Post.create({
        userId: null,
        governorateId: game.governorateId || null,
        text: `صور وفيديوهات مباراة ${game.stadiumName || ""}`,
        media: { images: [], videos: [] },
      });
    }

    return res.json({ message: "Results saved successfully" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/games/:id/results", optionalAuthenticateToken, async (req, res) => {
  try {
    const gameId = Number(req.params.id);
    const governorateScope = getGovernorateScope(req, { allowQuery: true });
    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }

    const game = await Game.findByPk(gameId);
    if (!game) return res.status(404).json({ error: "Game not found" });
    if (
      governorateScope !== null &&
      Number(game.governorateId) !== Number(governorateScope)
    ) {
      return res.status(404).json({ error: "Game not found" });
    }

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
