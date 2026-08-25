const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");
const { User, PlayerMatchStats, Game, PlayerOfMonth } = require("../models");
const { fn, col, where } = require("sequelize");
const { optionalAuthenticateToken } = require("../middlewares/auth");
const {
  getGovernorateScope,
  applyGovernorateScope,
} = require("../services/accessScope");

const escapeLike = (s) => String(s).replace(/[\\%_]/g, "\\$&");

const normalizePhone = (s) =>
  String(s || "").replace(/\s+/g, "").replace(/[^\d+]/g, "");

const hasDigits = (s) => /\d/.test(String(s || ""));

const calcOverall = (u) =>
  Math.round((u.spd + u.fin + u.pas + u.skl + u.tkl + u.str) / 6);

const safeString = (v, fallback = "") => {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
};

const safeImage = (img) => {
  const main = safeString(img?.main, "");
  const images = Array.isArray(img?.images)
    ? img.images.filter(Boolean).map(String)
    : (main ? [main] : []);
  return { main, images };
};

const safePosition = (p) => safeString(p, ""); 

const baghdadMonthKey = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
};

const getMonthRange = (value) => {
  const monthKey = safeString(value, baghdadMonthKey());
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  const start = `${match[1]}-${match[2]}-01 00:00:00`;
  const next = new Date(Date.UTC(year, month, 1));
  const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01 00:00:00`;
  return { monthKey, start, end };
};

const addPlayerOfMonthAwards = async (players, governorateScope) => {
  const userIds = players.map((player) => player.id).filter(Boolean);
  if (!userIds.length) return players;

  const where = { userId: { [Op.in]: userIds } };
  if (governorateScope !== null && governorateScope !== undefined) {
    where.governorateId = governorateScope;
  }

  const awards = await PlayerOfMonth.findAll({
    where,
    attributes: ["userId", "month", "note"],
    order: [["month", "DESC"], ["id", "DESC"]],
  });
  const byUserId = new Map();

  for (const award of awards) {
    const list = byUserId.get(award.userId) || [];
    list.push({ month: award.month, note: award.note || null });
    byUserId.set(award.userId, list);
  }

  return players.map((player) => ({
    ...player,
    playerOfMonthAwards: byUserId.get(player.id) || [],
  }));
};

const mapIndividualAwards = (statsRows) =>
  statsRows
    .filter((row) => row.individualAward)
    .map((row) => ({
      type: row.individualAward,
      stadiumName: row.game?.stadiumName || "",
      startsAt: row.game?.startsAt || null,
    }))
    .sort((a, b) => String(b.startsAt || "").localeCompare(String(a.startsAt || "")));


router.get("/players/stats", optionalAuthenticateToken, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);

    const status = req.query.status;
    const from = req.query.from;
    const to = req.query.to;
    
    const searchRaw = safeString(req.query.search, "").trim();

    const governorateScope = getGovernorateScope(req, { allowQuery: true });
    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }

    const userWhere = applyGovernorateScope(
      {
        role: { [Op.notIn]: ["admin", "super_admin"] },
      },
      governorateScope
    );

    if (searchRaw) {
      const search = escapeLike(searchRaw);
      const or = [
        { name: { [Op.like]: `%${search}%` } },

        { position: { [Op.eq]: searchRaw } },
      ];

      if (hasDigits(searchRaw)) {
        const phoneSearch = normalizePhone(searchRaw);

        or.push(
          where(fn("REPLACE", col("User.phone"), " ", ""), {
            [Op.like]: `%${phoneSearch}%`,
          })
        );
      }

      userWhere[Op.or] = or;
    }
    
    const gameWhere = {};
    if (status) gameWhere.status = status;
    if (from || to) {
      gameWhere.startsAt = {};
      if (from) gameWhere.startsAt[Op.gte] = new Date(from);
      if (to) gameWhere.startsAt[Op.lte] = new Date(to);
    }

    const includeGame = [{
          model: Game,
          as: "game",
          where: status || from || to ? gameWhere : undefined,
          required: Boolean(status || from || to),
          attributes: ["id", "status", "startsAt", "stadiumName"],
        }];

    const rows = await User.findAll({
      where: userWhere,
      attributes: { exclude: ["password"] },
      include: [
        {
          model: PlayerMatchStats,
          as: "stats",
          required: false,
          attributes: ["gameId", "team", "goals", "assists", "yellowCards", "redCards", "isMotm", "individualAward"],
          include: includeGame,
        },
      ],
      distinct: true,
    });

    let allPlayers = rows.map((u) => {
      const user = u.toJSON();
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
        { games: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, motm: 0 }
      );

      return {
        id: user.id,
        name: safeString(user.name, "بدون اسم"),
        phone: safeString(user.phone, ""),
        role: safeString(user.role, "user"),
        isVerified: Boolean(user.isVerified),
        position: safePosition(user.position),
        overall: Number.isFinite(calcOverall(user)) ? calcOverall(user) : 0,
        image: safeImage(user.image),
        stats: totals,
        individualAwards: mapIndividualAwards(statsRows),
      };
    });

    allPlayers = await addPlayerOfMonthAwards(allPlayers, governorateScope);

    allPlayers.sort((a, b) => 
      a.name.localeCompare(b.name, 'ar', { sensitivity: 'base' })
    );

    const totalUsers = allPlayers.length;
    const totalPages = Math.ceil(totalUsers / limit);
    const start = (page - 1) * limit;
    const players = allPlayers.slice(start, start + limit);

    return res.json({
      players,
      pagination: { totalUsers, currentPage: page, totalPages, limit },
    });
  } catch (e) {
    console.error("❌ players stats error:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/players/leaderboard", optionalAuthenticateToken, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);

    const by = safeString(req.query.by, "goals").toLowerCase();
    const team = safeString(req.query.team, "");
    const min = Number(req.query.min ?? 1);
    const period = safeString(req.query.period, "").toLowerCase();
    const isMonthly = period === "month" || safeString(req.query.month, "").length > 0;
    const monthRange = isMonthly ? getMonthRange(req.query.month) : null;

    if (isMonthly && !monthRange) {
      return res.status(400).json({ error: "month must use YYYY-MM" });
    }

    const status = req.query.status;
    const from = req.query.from;
    const to = req.query.to;

    const searchRaw = safeString(req.query.search, "").trim();

    const governorateScope = getGovernorateScope(req, { allowQuery: true });
    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }

    const userWhere = applyGovernorateScope(
      { role: { [Op.notIn]: ["admin", "super_admin"] } },
      governorateScope
    );

    if (searchRaw) {
      const search = escapeLike(searchRaw);
      const or = [
        { name: { [Op.like]: `%${search}%` } },
        { position: { [Op.eq]: searchRaw } },
      ];

      if (hasDigits(searchRaw)) {
        const phoneSearch = normalizePhone(searchRaw);
        or.push(
          where(fn("REPLACE", col("User.phone"), " ", ""), {
            [Op.like]: `%${phoneSearch}%`,
          })
        );
      }

      userWhere[Op.or] = or;
    }

    const gameWhere = {};
    if (status) gameWhere.status = status;
    if (from || to) {
      gameWhere.startsAt = {};
      if (from) gameWhere.startsAt[Op.gte] = `${from} 00:00:00`;
      if (to) gameWhere.startsAt[Op.lte] = `${to} 23:59:59`;
    }

    const statsWhere = {};
    if (team) statsWhere.team = team;

    // This path is opt-in. Existing app versions keep their all-time totals.
    const monthlyGameWhere = isMonthly
      ? {
          startsAt: {
            [Op.gte]: monthRange.start,
            [Op.lt]: monthRange.end,
          },
        }
      : null;
    if (isMonthly && status) monthlyGameWhere.status = status;

    const rows = await User.findAll({
      where: userWhere,
      attributes: { exclude: ["password"] },
      include: [
        {
          model: PlayerMatchStats,
          as: "stats",
          required: false,
          where: Object.keys(statsWhere).length ? statsWhere : undefined,
          attributes: ["goals", "assists", "yellowCards", "redCards", "isMotm", "individualAward"],
          include: isMonthly
            ? [{
                model: Game,
                as: "game",
                where: monthlyGameWhere,
                required: true,
                attributes: ["id", "status", "startsAt", "stadiumName"],
              }]
            : (status || from || to)
            ? [{
                model: Game,
                as: "game",
                where: gameWhere,
                required: false,
                attributes: ["id", "status", "startsAt", "stadiumName"],
              }]
            : [{
                model: Game,
                as: "game",
                required: false,
                attributes: ["id", "status", "startsAt", "stadiumName"],
              }],
        },
      ],
      distinct: true,
    });

    let players = rows
      .map((u) => {
        const user = u.toJSON();
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
            motm: 0 
          }
        );
        totals.totalCards = totals.yellowCards + totals.redCards;

        const cards = totals.yellowCards + totals.redCards;

        let metric = 0;
        if (by === "overall") metric = calcOverall(user);
        else if (by === "assists") metric = totals.assists;
        else if (by === "cards") metric = cards;
        else metric = totals.goals;

        return {
          id: user.id,
          name: safeString(user.name, "بدون اسم"),
          phone: safeString(user.phone, ""),
          role: safeString(user.role, "user"), 
          isVerified: Boolean(user.isVerified),
          position: safePosition(user.position),
          overall: Number.isFinite(calcOverall(user)) ? calcOverall(user) : 0,
          image: safeImage(user.image),
          stats: totals,
          individualAwards: mapIndividualAwards(statsRows),
          cards,
          metric,
        };
      })
      .filter((p) => (Number.isFinite(min) ? p.metric >= min : p.metric > 0))
      .sort((a, b) => b.metric - a.metric);

    players = await addPlayerOfMonthAwards(players, governorateScope);

    const totalUsers = players.length;
    const totalPages = Math.ceil(totalUsers / limit);
    const start = (page - 1) * limit;
    const paged = players.slice(start, start + limit);

    return res.json({
      by,
      team: team || null,
      period: isMonthly ? "month" : "all",
      month: isMonthly ? monthRange.monthKey : null,
      players: paged,
      pagination: { totalUsers, currentPage: page, totalPages, limit },
    });
  } catch (e) {
    console.error("❌ leaderboard error:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});


module.exports = router;
