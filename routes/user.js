const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { Op } = require("sequelize");
const {
  User,
  UserDevice,
  PlayerMatchStats,
  Game,
  Governorate,
  PlayerOfMonth,
} = require("../models");
const uploadImage = require("../middlewares/uploads");
const { optionalAuthenticateToken } = require("../middlewares/auth");
const { normalizeGovernorateName } = require("../services/governorates");
const {
  getGovernorateScope,
  applyGovernorateScope,
} = require("../services/accessScope");
const { createOtp, verifyOtp } = require("../services/otpService");
const { sendWhatsAppText } = require("../services/waSender");

const router = express.Router();
const upload = multer();
const saltRounds = 10;

const POSITIONS = ["GK", "CB", "LB", "RB", "CM", "AMF", "RWF", "LWF", "CF"];
const GOVERNORATE_ADMIN_ROLES = ["admin"];

const normalizePhone = (phone = "") => {
  phone = String(phone).trim();
  if (phone.startsWith("0")) return "964" + phone.slice(1);
  return phone;
};

const clampStat = (v, def = 100) => {
  const n = Number(v);
  if (Number.isNaN(n)) return def;
  return Math.max(1, Math.min(100, Math.floor(n)));
};

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      phone: user.phone,
      role: user.role,
      governorateId: user.governorateId ?? null,
    },
    process.env.JWT_SECRET,
    { expiresIn: "700d" }
  );
};

const mapGovernorate = (governorate) => {
  if (!governorate) return null;

  return {
    id: governorate.id,
    name: governorate.name,
    isActive: governorate.isActive,
  };
};

const normalizeImagePayload = (image) => {
  if (image && typeof image === "object" && !Array.isArray(image)) {
    return {
      main: image.main || "",
      images: Array.isArray(image.images) ? image.images : [],
    };
  }

  return {
    main: "",
    images: [],
  };
};

const normalizeStatsPayload = (stats) => {
  if (stats && typeof stats === "object" && !Array.isArray(stats)) {
    return {
      games: Number(stats.games) || 0,
      goals: Number(stats.goals) || 0,
      assists: Number(stats.assists) || 0,
      yellowCards: Number(stats.yellowCards) || 0,
      redCards: Number(stats.redCards) || 0,
      motm: Number(stats.motm) || 0,
      wins: Number(stats.wins) || 0,
      draws: Number(stats.draws) || 0,
      losses: Number(stats.losses) || 0,
    };
  }

  return {
    games: 0,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    motm: 0,
    wins: 0,
    draws: 0,
    losses: 0,
  };
};

const getPlayerOfMonthAwards = async (userId, governorateId) => {
  const where = { userId };
  if (governorateId !== null && governorateId !== undefined) {
    where.governorateId = governorateId;
  }

  const awards = await PlayerOfMonth.findAll({
    where,
    attributes: ["month", "note"],
    order: [["month", "DESC"], ["id", "DESC"]],
  });

  return awards.map((award) => ({
    month: award.month,
    note: award.note || null,
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

async function resolveGovernorate({ governorateId, governorate }) {
  if (governorateId) {
    return Governorate.findByPk(Number(governorateId));
  }

  if (governorate) {
    return Governorate.findOne({
      where: { name: normalizeGovernorateName(governorate) },
    });
  }

  return null;
}

router.post("/users", uploadImage.array("images", 5), async (req, res) => {
  try {
    const { name, password, position } = req.body;
    let { phone, governorateId, governorate } = req.body;

    phone = normalizePhone(phone);

    if (!name || !phone || !password || (!governorateId && !governorate)) {
      return res.status(400).json({
        error:
          "All required fields must be provided: name, phone, password, governorate",
      });
    }

    if (position && !POSITIONS.includes(position)) {
      return res.status(400).json({ error: "Invalid position" });
    }

    const spd = clampStat(req.body.spd, 100);
    const fin = clampStat(req.body.fin, 100);
    const pas = clampStat(req.body.pas, 100);
    const skl = clampStat(req.body.skl, 100);
    const tkl = clampStat(req.body.tkl, 100);
    const str = clampStat(req.body.str, 100);

    const existingPhone = await User.findOne({ where: { phone } });
    if (existingPhone) {
      return res.status(400).json({ error: "Phone already exists" });
    }

    const selectedGovernorate = await resolveGovernorate({
      governorateId,
      governorate,
    });

    if (!selectedGovernorate || !selectedGovernorate.isActive) {
      return res.status(400).json({ error: "Governorate is not available" });
    }

    const adminsCount = await User.count({
      where: {
        governorateId: selectedGovernorate.id,
        role: { [Op.in]: GOVERNORATE_ADMIN_ROLES },
        isActive: true,
      },
    });

    if (!adminsCount) {
      return res.status(400).json({
        error: "This governorate does not have an admin yet",
      });
    }

    const images = req.files && Array.isArray(req.files)
      ? req.files.map((f) => f.filename)
      : [];

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const user = await User.create({
      name,
      phone,
      password: hashedPassword,
      role: "user",
      governorateId: selectedGovernorate.id,
      position: position || null,
      spd,
      fin,
      pas,
      skl,
      tkl,
      str,
      image: images.length ? { main: images[0], images } : null,
    });

    return res.status(201).json({
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      governorateId: user.governorateId,
      governorate: mapGovernorate(selectedGovernorate),
      position: user.position,
      stats: {
        spd: user.spd,
        fin: user.fin,
        pas: user.pas,
        skl: user.skl,
        tkl: user.tkl,
        str: user.str,
      },
      image: user.image,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  } catch (err) {
    console.error("Error creating user:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/login", upload.none(), async (req, res) => {
  try {
    let { phone } = req.body;
    const { password } = req.body;

    phone = normalizePhone(phone);

    if (!phone || !password) {
      return res.status(400).json({ error: "Phone and password are required" });
    }

    const user = await User.findOne({
      where: { phone },
      include: [{ model: Governorate, as: "governorate" }],
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid phone number" });
    }

    if (!user.isActive) {
      return res.status(403).json({ error: "This account has been deactivated" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(400).json({ error: "Invalid password" });
    }

    const token = generateToken(user);

    return res.status(200).json({
      message: "Login successful",
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        governorateId: user.governorateId,
        governorate: mapGovernorate(user.governorate),
        position: user.position,
        stats: {
          spd: user.spd,
          fin: user.fin,
          pas: user.pas,
          skl: user.skl,
          tkl: user.tkl,
          str: user.str,
        },
        image: user.image,
      },
      token,
    });
  } catch (err) {
    console.error("Error logging in:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/forgot-password/request", upload.none(), async (req, res) => {
  try {
    let { phone } = req.body;
    phone = normalizePhone(phone);

    if (!phone) {
      return res.status(400).json({ error: "Phone is required" });
    }

    const user = await User.findOne({ where: { phone } });
    if (!user) {
      return res.status(404).json({ error: "Phone number is not registered" });
    }

    const otp = createOtp(phone);
    const message = `رمز إعادة تعيين كلمة السر هو: ${otp.code}\nصالح لمدة ${Math.floor(otp.expiresInSeconds / 60)} دقائق.`;

    await sendWhatsAppText(otp.phone, message);

    return res.status(200).json({
      success: true,
      phone: otp.phone,
      expiresInSeconds: otp.expiresInSeconds,
      retryAfterSeconds: otp.retryAfterSeconds,
      message: "Password reset OTP sent successfully",
    });
  } catch (error) {
    console.error("Forgot password OTP request error:", error.message);
    return res.status(400).json({ error: error.message });
  }
});

router.post("/forgot-password/reset", upload.none(), async (req, res) => {
  try {
    let { phone, code, password } = req.body;
    phone = normalizePhone(phone);
    password = String(password || "").trim();

    if (!phone || !code || !password) {
      return res.status(400).json({
        error: "phone, code and password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "Password must be at least 6 characters",
      });
    }

    const result = verifyOtp(phone, code);
    const user = await User.findOne({ where: { phone: result.phone } });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.password = await bcrypt.hash(password, saltRounds);
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Forgot password reset error:", error.message);
    return res.status(400).json({ error: error.message });
  }
});

router.get("/usersOnly", optionalAuthenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 30;
    const offset = (page - 1) * limit;
    const governorateScope = getGovernorateScope(req, { allowQuery: true });

    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }

    const { count, rows: users } = await User.findAndCountAll({
      where: applyGovernorateScope(
        { role: { [Op.notIn]: ["admin", "super_admin", "photographer"] } },
        governorateScope
      ),
      limit,
      offset,
      order: [["createdAt", "DESC"]],
      attributes: { exclude: ["password"] },
      include: [{ model: Governorate, as: "governorate" }],
    });

    return res.status(200).json({
      users,
      pagination: {
        totalUsers: count,
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        limit,
      },
    });
  } catch (err) {
    console.error("Error fetching users:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/user/:id", optionalAuthenticateToken, async (req, res) => {
  try {
    const governorateScope = getGovernorateScope(req, { allowQuery: true });
    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }

    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ["password"] },
      include: [{ model: Governorate, as: "governorate" }],
    });

    if (!user) return res.status(404).json({ error: "User not found" });
    if (
      governorateScope !== null &&
      Number(user.governorateId) !== Number(governorateScope)
    ) {
      return res.status(404).json({ error: "User not found" });
    }

    const overall = Math.round(
      (user.spd + user.fin + user.pas + user.skl + user.tkl + user.str) / 6
    );

    const playerOfMonthAwards = await getPlayerOfMonthAwards(
      user.id,
      user.governorateId
    );

    return res.status(200).json({
      ...user.toJSON(),
      governorate: mapGovernorate(user.governorate),
      image: normalizeImagePayload(user.image),
      position: user.position || "",
      overall,
      stats: normalizeStatsPayload(),
      playerOfMonthAwards,
    });
  } catch (err) {
    console.error("Error fetching user:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/user-stats/:id", optionalAuthenticateToken, async (req, res) => {
  try {
    const governorateScope = getGovernorateScope(req, { allowQuery: true });
    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }

    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ["password"] },
      include: [
        {
          model: Governorate,
          as: "governorate",
        },
        {
          model: PlayerMatchStats,
          as: "stats",
          required: false,
          attributes: [
            "gameId",
            "team",
            "goals",
            "assists",
            "yellowCards",
            "redCards",
            "isMotm",
            "individualAward",
          ],
          include: [{
            model: Game,
            as: "game",
            required: false,
            attributes: ["id", "stadiumName", "startsAt"],
          }],
        },
      ],
      distinct: true,
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (
      governorateScope !== null &&
      Number(user.governorateId) !== Number(governorateScope)
    ) {
      return res.status(404).json({ error: "User not found" });
    }

    const userJson = user.toJSON();
    const statsRows = Array.isArray(userJson.stats) ? userJson.stats : [];

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
        motm: 0,
      }
    );

    const overall = Math.round(
      (userJson.spd +
        userJson.fin +
        userJson.pas +
        userJson.skl +
        userJson.tkl +
        userJson.str) /
        6
    );

    const playerOfMonthAwards = await getPlayerOfMonthAwards(
      userJson.id,
      userJson.governorateId
    );

    return res.status(200).json({
      id: userJson.id,
      name: userJson.name,
      phone: userJson.phone,
      role: userJson.role,
      isVerified: Boolean(userJson.isVerified),
      governorateId: userJson.governorateId,
      governorate: mapGovernorate(userJson.governorate),
      position: userJson.position || "",
      image: userJson.image,
      overall,
      stats: {
        ...totals,
        totalCards: totals.yellowCards + totals.redCards,
      },
      playerOfMonthAwards,
      individualAwards: mapIndividualAwards(statsRows),
    });
  } catch (err) {
    console.error("Error fetching user stats:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/profile", async (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Token is missing" });

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) return res.status(401).json({ error: "Invalid token" });

    try {
      const status = req.query.status;
      const from = req.query.from;
      const to = req.query.to;

      const gameWhere = {};
      if (status) gameWhere.status = status;

      if (from || to) {
        gameWhere.startsAt = {};
        if (from) gameWhere.startsAt[Op.gte] = new Date(from);
        if (to) gameWhere.startsAt[Op.lte] = new Date(to);
      }

      const includeGame =
        status || from || to
          ? [
              {
                model: Game,
                as: "game",
                where: gameWhere,
                required: true,
                attributes: ["id", "status", "startsAt", "stadiumName"],
              },
            ]
          : [];

      const userRow = await User.findByPk(decoded.id, {
        attributes: { exclude: ["password"] },
        include: [
          {
            model: Governorate,
            as: "governorate",
          },
          {
            model: PlayerMatchStats,
            as: "stats",
            required: false,
            attributes: [
              "gameId",
              "team",
              "goals",
              "assists",
              "yellowCards",
              "redCards",
              "isMotm",
              "individualAward",
            ],
            include: includeGame.length
              ? includeGame
              : [{
                  model: Game,
                  as: "game",
                  required: false,
                  attributes: ["id", "stadiumName", "startsAt"],
                }],
          },
        ],
        distinct: true,
      });

      if (!userRow) return res.status(404).json({ error: "User not found" });

      const user = userRow.toJSON();
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
          motm: 0,
        }
      );

      const overall = Math.round(
        (user.spd + user.fin + user.pas + user.skl + user.tkl + user.str) / 6
      );

      const playerOfMonthAwards = await getPlayerOfMonthAwards(
        user.id,
        user.governorateId
      );

      const gameIds = [...new Set(statsRows.map((r) => r.gameId).filter(Boolean))];

      let wdl = { wins: 0, draws: 0, losses: 0 };

      if (gameIds.length) {
        const allStatsInGames = await PlayerMatchStats.findAll({
          where: { gameId: { [Op.in]: gameIds } },
          attributes: ["gameId", "team", "goals"],
        });

        const scoreMap = new Map();
        for (const row of allStatsInGames) {
          const j = row.toJSON();
          const gid = j.gameId;
          const team = j.team;
          const goals = Number(j.goals) || 0;

          if (!scoreMap.has(gid)) scoreMap.set(gid, { A: 0, B: 0 });
          const s = scoreMap.get(gid);
          if (team === "A") s.A += goals;
          else if (team === "B") s.B += goals;
        }

        for (const r of statsRows) {
          const s = scoreMap.get(r.gameId);
          if (!s) continue;

          const my = r.team === "A" ? s.A : s.B;
          const opp = r.team === "A" ? s.B : s.A;

          if (my > opp) wdl.wins += 1;
          else if (my < opp) wdl.losses += 1;
          else wdl.draws += 1;
        }
      }

      return res.status(200).json({
        ...user,
        governorate: mapGovernorate(user.governorate),
        image: normalizeImagePayload(user.image),
        position: user.position || "",
        overall,
        stats: normalizeStatsPayload({
          ...totals,
          ...wdl,
        }),
        playerOfMonthAwards,
        individualAwards: mapIndividualAwards(statsRows),
      });
    } catch (error) {
      console.error("Error fetching user profile:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });
});

router.put("/profile", uploadImage.array("images", 5), async (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Token is missing" });

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) return res.status(401).json({ error: "Invalid token" });

    try {
      const user = await User.findByPk(decoded.id);
      if (!user) return res.status(404).json({ error: "User not found" });

      let { name, phone, password, position, governorateId } = req.body;

      if (position && !POSITIONS.includes(position)) {
        return res.status(400).json({ error: "Invalid position" });
      }

      if (phone) {
        phone = normalizePhone(phone);
        const exists = await User.findOne({
          where: { phone, id: { [Op.ne]: user.id } },
        });
        if (exists) {
          return res.status(400).json({ error: "Phone already exists" });
        }
        user.phone = phone;
      }

      if (name !== undefined) user.name = name;
      if (position !== undefined) user.position = position || null;

      if (governorateId !== undefined) {
        const governorate = await Governorate.findByPk(Number(governorateId));
        if (!governorate) {
          return res.status(404).json({ error: "Governorate not found" });
        }
        user.governorateId = governorate.id;
      }

      if (password) {
        const hashed = await bcrypt.hash(password, saltRounds);
        user.password = hashed;
      }

      const images = req.files && Array.isArray(req.files)
        ? req.files.map((f) => f.filename)
        : [];
      if (images.length) {
        user.image = { main: images[0], images };
      }

      await user.save();

      const overall = Math.round(
        (user.spd + user.fin + user.pas + user.skl + user.tkl + user.str) / 6
      );

      return res.status(200).json({
        message: "Profile updated successfully",
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          governorateId: user.governorateId,
          position: user.position,
          stats: {
            spd: user.spd,
            fin: user.fin,
            pas: user.pas,
            skl: user.skl,
            tkl: user.tkl,
            str: user.str,
          },
          overall,
          image: user.image,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      });
    } catch (error) {
      console.error("Error updating profile:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });
});

router.delete("/users/:id", async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      include: { model: UserDevice, as: "devices" },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    await user.destroy();
    return res
      .status(200)
      .json({ message: "User and devices deleted successfully" });
  } catch (err) {
    console.error("Error deleting user:", err);
    return res.status(500).json({ error: "Delete failed" });
  }
});

router.put("/users/:id", uploadImage.array("images", 5), async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ error: "User not found" });

    let { name, phone, password, role, position, governorateId } = req.body;

    if (position && !POSITIONS.includes(position)) {
      return res.status(400).json({ error: "Invalid position" });
    }

    if (phone) {
      phone = normalizePhone(phone);

      const exists = await User.findOne({
        where: { phone, id: { [Op.ne]: user.id } },
      });
      if (exists) {
        return res.status(400).json({ error: "Phone already exists" });
      }

      user.phone = phone;
    }

    if (name !== undefined) user.name = name;
    if (role !== undefined) user.role = role;
    if (position !== undefined) user.position = position || null;

    if (governorateId !== undefined) {
      const governorate = await Governorate.findByPk(Number(governorateId));
      if (!governorate) {
        return res.status(404).json({ error: "Governorate not found" });
      }
      user.governorateId = governorate.id;
    }

    const hasAnyStat =
      req.body.spd !== undefined ||
      req.body.fin !== undefined ||
      req.body.pas !== undefined ||
      req.body.skl !== undefined ||
      req.body.tkl !== undefined ||
      req.body.str !== undefined;

    if (hasAnyStat) {
      user.spd = clampStat(req.body.spd, user.spd ?? 100);
      user.fin = clampStat(req.body.fin, user.fin ?? 100);
      user.pas = clampStat(req.body.pas, user.pas ?? 100);
      user.skl = clampStat(req.body.skl, user.skl ?? 100);
      user.tkl = clampStat(req.body.tkl, user.tkl ?? 100);
      user.str = clampStat(req.body.str, user.str ?? 100);
    }

    if (password) {
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      user.password = hashedPassword;
    }

    const images = req.files && Array.isArray(req.files)
      ? req.files.map((f) => f.filename)
      : [];

    if (images.length) {
      user.image = { main: images[0], images };
    }

    await user.save();

    const overall = Math.round(
      (user.spd + user.fin + user.pas + user.skl + user.tkl + user.str) / 6
    );

    return res.status(200).json({
      message: "User updated successfully",
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        governorateId: user.governorateId,
        position: user.position,
        spd: user.spd,
        fin: user.fin,
        pas: user.pas,
        skl: user.skl,
        tkl: user.tkl,
        str: user.str,
        overall,
        image: user.image,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (err) {
    console.error("Error updating user:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
