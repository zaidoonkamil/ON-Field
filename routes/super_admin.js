const express = require("express");
const bcrypt = require("bcrypt");
const { fn, col, Op } = require("sequelize");
const {
  Governorate,
  User,
  Game,
  GameSlot,
  Post,
  LiveStream,
  MonthlySquad,
  PlayerOfMonth,
} = require("../models");
const { authenticateToken } = require("../middlewares/auth");
const { requireRoles } = require("../middlewares/authorization");
const { normalizeGovernorateName } = require("../services/governorates");

const router = express.Router();
const saltRounds = 10;

const ADMIN_ACCOUNT_ROLES = ["admin", "super_admin"];
const GOVERNORATE_ADMIN_ROLES = ["admin"];
const USER_ROLES = ["user", "admin"];
const POSITIONS = ["GK", "CB", "LB", "RB", "CM", "AMF", "RWF", "LWF", "CF"];

function normalizePhone(phone = "") {
  const value = String(phone).trim();
  if (value.startsWith("0")) return `964${value.slice(1)}`;
  return value;
}

function mapGovernorate(governorate) {
  return {
    id: governorate.id,
    name: governorate.name,
    isActive: governorate.isActive,
    createdAt: governorate.createdAt,
    updatedAt: governorate.updatedAt,
  };
}

function mapAdmin(user) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    governorateId: user.governorateId,
    governorate: user.governorate ? mapGovernorate(user.governorate) : null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function resolveGovernorateIdForRole({ role, governorateId }) {
  if (role === "super_admin") {
    return null;
  }

  if (!governorateId) {
    throw { status: 400, message: "governorateId is required for admin" };
  }

  const governorate = await Governorate.findByPk(Number(governorateId));
  if (!governorate) {
    throw { status: 404, message: "Governorate not found" };
  }

  return governorate.id;
}

router.get(
  "/governorates",
  authenticateToken,
  requireRoles("super_admin"),
  async (req, res) => {
    try {
      const governorates = await Governorate.findAll({
        order: [["name", "ASC"]],
      });

      return res.status(200).json(governorates.map(mapGovernorate));
    } catch (error) {
      console.error("Error fetching governorates:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

router.get("/governorates/available", async (req, res) => {
  try {
    const governorates = await Governorate.findAll({
      where: { isActive: true },
      include: [
        {
          model: User,
          as: "users",
          where: {
            role: GOVERNORATE_ADMIN_ROLES,
            isActive: true,
          },
          attributes: [],
          required: true,
        },
      ],
      attributes: [
        "id",
        "name",
        "isActive",
        [fn("COUNT", col("users.id")), "adminsCount"],
      ],
      group: ["Governorate.id", "Governorate.name", "Governorate.isActive"],
      order: [["name", "ASC"]],
    });

    return res.status(200).json(
      governorates.map((governorate) => ({
        id: governorate.id,
        name: governorate.name,
        isActive: governorate.isActive,
        adminsCount: Number(governorate.get("adminsCount")) || 0,
      }))
    );
  } catch (error) {
    console.error("Error fetching available governorates:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/governorates/public-active", async (req, res) => {
  try {
    const governorates = await Governorate.findAll({
      where: { isActive: true },
      attributes: ["id", "name", "isActive"],
      order: [["name", "ASC"]],
    });

    return res.status(200).json(governorates.map(mapGovernorate));
  } catch (error) {
    console.error("Error fetching public governorates:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post(
  "/governorates",
  authenticateToken,
  requireRoles("super_admin"),
  async (req, res) => {
    try {
      const name = normalizeGovernorateName(req.body.name);
      if (!name) {
        return res.status(400).json({ error: "name is required" });
      }

      const existing = await Governorate.findOne({ where: { name } });
      if (existing) {
        return res.status(409).json({ error: "Governorate already exists" });
      }

      const governorate = await Governorate.create({
        name,
        isActive: req.body.isActive !== false,
      });

      return res.status(201).json(mapGovernorate(governorate));
    } catch (error) {
      console.error("Error creating governorate:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

router.get(
  "/super-admin/admins",
  authenticateToken,
  requireRoles("super_admin"),
  async (req, res) => {
    try {
      const admins = await User.findAll({
        where: { role: ADMIN_ACCOUNT_ROLES },
        include: [
          {
            model: Governorate,
            as: "governorate",
          },
        ],
        order: [["createdAt", "DESC"]],
        attributes: { exclude: ["password"] },
      });

      return res.status(200).json(admins.map(mapAdmin));
    } catch (error) {
      console.error("Error fetching admins:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

router.post("/create-super-admin", async (req, res) => {
  try {
    const { name, password, position } = req.body;
    let { phone, governorateId, role } = req.body;

    phone = normalizePhone(phone);
    role = role === "super_admin" ? "super_admin" : "admin";

    if (!name || !phone || !password) {
      return res.status(400).json({
        error: "name, phone and password are required",
      });
    }

    if (position && !POSITIONS.includes(position)) {
      return res.status(400).json({ error: "Invalid position" });
    }

    const resolvedGovernorateId = await resolveGovernorateIdForRole({
      role,
      governorateId,
    });

    const existingPhone = await User.findOne({ where: { phone } });
    if (existingPhone) {
      return res.status(409).json({ error: "Phone already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const admin = await User.create({
      name,
      phone,
      password: hashedPassword,
      role,
      isActive: true,
      position: position || null,
      governorateId: resolvedGovernorateId,
      image: null,
    });

    return res.status(201).json({
      message: "Super admin created successfully",
      admin,
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("Error creating admin:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get(
  "/super-admin/stats",
  authenticateToken,
  requireRoles("super_admin"),
  async (req, res) => {
    try {
      const [
        totalUsers,
        totalAdmins,
        totalSuperAdmins,
        totalGames,
        openGames,
        closedGames,
        totalBookings,
        totalPosts,
        totalLives,
        totalMonthlySquads,
        totalPlayerOfMonthEntries,
        governorates,
      ] = await Promise.all([
        User.count({ where: { role: USER_ROLES } }),
        User.count({ where: { role: "admin" } }),
        User.count({ where: { role: "super_admin" } }),
        Game.count(),
        Game.count({ where: { status: "open" } }),
        Game.count({ where: { status: "closed" } }),
        GameSlot.count({ where: { userId: { [Op.ne]: null } } }),
        Post.count(),
        LiveStream.count(),
        MonthlySquad.count(),
        PlayerOfMonth.count(),
        Governorate.findAll({
          order: [["name", "ASC"]],
        }),
      ]);

      const governorateStats = await Promise.all(
        governorates.map(async (governorate) => {
          const [
            usersCount,
            adminsCount,
            gamesCount,
            postsCount,
            livesCount,
            monthlySquadsCount,
            playerOfMonthCount,
            bookingsCount,
          ] = await Promise.all([
            User.count({
              where: {
                governorateId: governorate.id,
                role: "user",
              },
            }),
            User.count({
              where: {
                governorateId: governorate.id,
                role: "admin",
              },
            }),
            Game.count({ where: { governorateId: governorate.id } }),
            Post.count({ where: { governorateId: governorate.id } }),
            LiveStream.count({ where: { governorateId: governorate.id } }),
            MonthlySquad.count({ where: { governorateId: governorate.id } }),
            PlayerOfMonth.count({ where: { governorateId: governorate.id } }),
            GameSlot.count({
              include: [
                {
                  model: Game,
                  as: "game",
                  required: true,
                  attributes: [],
                  where: { governorateId: governorate.id },
                },
              ],
              where: {
                userId: { [Op.ne]: null },
              },
            }),
          ]);

          return {
            id: governorate.id,
            name: governorate.name,
            isActive: governorate.isActive,
            usersCount,
            adminsCount,
            gamesCount,
            postsCount,
            livesCount,
            monthlySquadsCount,
            playerOfMonthCount,
            bookingsCount,
          };
        })
      );

      return res.status(200).json({
        overview: {
          totalUsers,
          totalAdmins,
          totalSuperAdmins,
          totalGames,
          openGames,
          closedGames,
          totalBookings,
          totalPosts,
          totalLives,
          totalMonthlySquads,
          totalPlayerOfMonthEntries,
          totalGovernorates: governorates.length,
          activeGovernorates: governorates.filter((item) => item.isActive)
            .length,
        },
        governorates: governorateStats,
      });
    } catch (error) {
      console.error("Error fetching super admin stats:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

router.get(
  "/super-admin/governorates/:id/stats",
  authenticateToken,
  requireRoles("super_admin"),
  async (req, res) => {
    try {
      const governorate = await Governorate.findByPk(Number(req.params.id));
      if (!governorate) {
        return res.status(404).json({ error: "Governorate not found" });
      }

      const [
        usersCount,
        adminsCount,
        activeAdminsCount,
        gamesCount,
        openGamesCount,
        closedGamesCount,
        bookingsCount,
        postsCount,
        livesCount,
        activeLivesCount,
        monthlySquadsCount,
        publishedMonthlySquadsCount,
        playerOfMonthCount,
        admins,
        recentGames,
        recentPosts,
      ] = await Promise.all([
        User.count({
          where: { governorateId: governorate.id, role: "user" },
        }),
        User.count({
          where: { governorateId: governorate.id, role: "admin" },
        }),
        User.count({
          where: {
            governorateId: governorate.id,
            role: "admin",
            isActive: true,
          },
        }),
        Game.count({ where: { governorateId: governorate.id } }),
        Game.count({
          where: { governorateId: governorate.id, status: "open" },
        }),
        Game.count({
          where: { governorateId: governorate.id, status: "closed" },
        }),
        GameSlot.count({
          include: [
            {
              model: Game,
              as: "game",
              required: true,
              attributes: [],
              where: { governorateId: governorate.id },
            },
          ],
          where: { userId: { [Op.ne]: null } },
        }),
        Post.count({ where: { governorateId: governorate.id } }),
        LiveStream.count({ where: { governorateId: governorate.id } }),
        LiveStream.count({
          where: { governorateId: governorate.id, isActive: true },
        }),
        MonthlySquad.count({ where: { governorateId: governorate.id } }),
        MonthlySquad.count({
          where: { governorateId: governorate.id, status: "published" },
        }),
        PlayerOfMonth.count({ where: { governorateId: governorate.id } }),
        User.findAll({
          where: { governorateId: governorate.id, role: "admin" },
          order: [["createdAt", "DESC"]],
          attributes: ["id", "name", "phone", "role", "isActive", "createdAt"],
        }),
        Game.findAll({
          where: { governorateId: governorate.id },
          order: [["startsAt", "DESC"]],
          limit: 5,
          attributes: [
            "id",
            "stadiumName",
            "startsAt",
            "formationSize",
            "status",
            "price",
            "createdAt",
          ],
        }),
        Post.findAll({
          where: { governorateId: governorate.id },
          order: [["createdAt", "DESC"]],
          limit: 5,
          attributes: ["id", "text", "media", "createdAt"],
        }),
      ]);

      return res.status(200).json({
        governorate: mapGovernorate(governorate),
        overview: {
          usersCount,
          adminsCount,
          activeAdminsCount,
          gamesCount,
          openGamesCount,
          closedGamesCount,
          bookingsCount,
          postsCount,
          livesCount,
          activeLivesCount,
          monthlySquadsCount,
          publishedMonthlySquadsCount,
          playerOfMonthCount,
        },
        admins: admins.map((admin) => ({
          id: admin.id,
          name: admin.name,
          phone: admin.phone,
          role: admin.role,
          isActive: admin.isActive,
          createdAt: admin.createdAt,
        })),
        recentGames: recentGames.map((game) => ({
          id: game.id,
          stadiumName: game.stadiumName,
          startsAt: game.startsAt,
          formationSize: game.formationSize,
          status: game.status,
          price: game.price,
          createdAt: game.createdAt,
        })),
        recentPosts: recentPosts.map((post) => ({
          id: post.id,
          text: post.text,
          imagesCount: Array.isArray(post.media?.images)
            ? post.media.images.length
            : 0,
          videosCount: Array.isArray(post.media?.videos)
            ? post.media.videos.length
            : 0,
          createdAt: post.createdAt,
        })),
      });
    } catch (error) {
      console.error("Error fetching governorate stats:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

router.post(
  "/super-admin/admins",
  authenticateToken,
  requireRoles("super_admin"),
  async (req, res) => {
    try {
      const { name, password, position } = req.body;
      let { phone, governorateId, role } = req.body;

      phone = normalizePhone(phone);
      role = role === "super_admin" ? "super_admin" : "admin";

      if (!name || !phone || !password) {
        return res.status(400).json({
          error: "name, phone and password are required",
        });
      }

      if (position && !POSITIONS.includes(position)) {
        return res.status(400).json({ error: "Invalid position" });
      }

      const resolvedGovernorateId = await resolveGovernorateIdForRole({
        role,
        governorateId,
      });

      const existingPhone = await User.findOne({ where: { phone } });
      if (existingPhone) {
        return res.status(409).json({ error: "Phone already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, saltRounds);

      const admin = await User.create({
        name,
        phone,
        password: hashedPassword,
        role,
        isActive: true,
        position: position || null,
        governorateId: resolvedGovernorateId,
        image: null,
      });

      const adminWithGovernorate = await User.findByPk(admin.id, {
        include: [
          {
            model: Governorate,
            as: "governorate",
          },
        ],
        attributes: { exclude: ["password"] },
      });

      return res.status(201).json(mapAdmin(adminWithGovernorate));
    } catch (error) {
      if (error?.status) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Error creating admin:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

router.put(
  "/super-admin/admins/:id",
  authenticateToken,
  requireRoles("super_admin"),
  async (req, res) => {
    try {
      const admin = await User.findByPk(req.params.id, {
        include: [{ model: Governorate, as: "governorate" }],
      });

      if (!admin || !ADMIN_ACCOUNT_ROLES.includes(admin.role)) {
        return res.status(404).json({ error: "Admin not found" });
      }

      if (
        Number(admin.id) === Number(req.user.id) &&
        req.body.isActive === false
      ) {
        return res
          .status(400)
          .json({ error: "You cannot deactivate your own account" });
      }

      let { name, phone, password, governorateId, role, isActive } = req.body;

      if (name !== undefined) {
        admin.name = String(name).trim();
      }

      if (phone !== undefined) {
        phone = normalizePhone(phone);
        const existingPhone = await User.findOne({
          where: {
            phone,
            id: { [Op.ne]: admin.id },
          },
        });

        if (existingPhone) {
          return res.status(409).json({ error: "Phone already exists" });
        }

        admin.phone = phone;
      }

      if (password !== undefined && String(password).trim()) {
        admin.password = await bcrypt.hash(String(password).trim(), saltRounds);
      }

      const nextRole =
        role !== undefined
          ? role === "super_admin"
            ? "super_admin"
            : "admin"
          : admin.role;

      if (role !== undefined) {
        admin.role = nextRole;
      }

      if (isActive !== undefined) {
        admin.isActive = Boolean(isActive);
      }

      if (role !== undefined || governorateId !== undefined) {
        const shouldUseGovernorateId =
          governorateId !== undefined ? governorateId : admin.governorateId;
        admin.governorateId = await resolveGovernorateIdForRole({
          role: nextRole,
          governorateId: shouldUseGovernorateId,
        });
      }

      await admin.save();

      const updatedAdmin = await User.findByPk(admin.id, {
        include: [{ model: Governorate, as: "governorate" }],
        attributes: { exclude: ["password"] },
      });

      return res.status(200).json(mapAdmin(updatedAdmin));
    } catch (error) {
      if (error?.status) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Error updating admin:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

router.patch(
  "/super-admin/admins/:id/status",
  authenticateToken,
  requireRoles("super_admin"),
  async (req, res) => {
    try {
      const admin = await User.findByPk(req.params.id, {
        include: [{ model: Governorate, as: "governorate" }],
        attributes: { exclude: ["password"] },
      });

      if (!admin || !ADMIN_ACCOUNT_ROLES.includes(admin.role)) {
        return res.status(404).json({ error: "Admin not found" });
      }

      if (Number(admin.id) === Number(req.user.id)) {
        return res
          .status(400)
          .json({ error: "You cannot change your own status" });
      }

      if (req.body.isActive === undefined) {
        return res.status(400).json({ error: "isActive is required" });
      }

      admin.isActive = Boolean(req.body.isActive);
      await admin.save();

      return res.status(200).json(mapAdmin(admin));
    } catch (error) {
      console.error("Error updating admin status:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

module.exports = router;
