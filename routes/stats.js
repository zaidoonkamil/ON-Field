const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");
const { User, PlayerMatchStats, Game } = require("../models");

const calcOverall = (u) =>
  Math.round((u.spd + u.fin + u.pas + u.skl + u.tkl + u.str) / 6);

router.get("/players/stats", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);
    const offset = (page - 1) * limit;

    const status = req.query.status;
    const from = req.query.from;
    const to = req.query.to;

    const gameWhere = {};
    if (status) gameWhere.status = status;
    if (from || to) {
      gameWhere.date = {};
      if (from) gameWhere.date[Op.gte] = new Date(from);
      if (to) gameWhere.date[Op.lte] = new Date(to);
    }

    const includeGame = (status || from || to)
      ? [{
          model: Game,
          as: "game",
          where: gameWhere,
          required: true,
          attributes: ["id", "status", "date"],
        }]
      : [];

    const { count, rows } = await User.findAndCountAll({
      where: { role: { [Op.notIn]: ["admin"] } },
      limit,
      offset,
      order: [["createdAt", "DESC"]],
      attributes: { exclude: ["password"] },
      include: [
        {
          model: PlayerMatchStats,
          as: "stats", 
          required: false,
          attributes: ["gameId", "team", "goals", "assists", "yellowCards", "redCards", "isMotm"],
          include: includeGame,
        },
      ],
      distinct: true, 
    });

    const players = rows.map((u) => {
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
        name: user.name,
        phone: user.phone,
        role: user.role,
        position: user.position,
        overall: calcOverall(user),
        image: user.image,
        stats: totals,
      };
    });

    return res.json({
      players,
      pagination: {
        totalUsers: count,
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        limit,
      },
    });
  } catch (e) {
    console.error("❌ players stats error:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
