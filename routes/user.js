const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { Op } = require("sequelize");
const { User, UserDevice } = require("../models");
const uploadImage = require("../middlewares/uploads");

const router = express.Router();
const upload = multer();
const saltRounds = 10;

const POSITIONS = ["GK","CB","LB","RB","CM","AMF","RWF","LWF","CF"];

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
    { id: user.id, phone: user.phone, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "700d" }
  );
};

router.post("/users", uploadImage.array("images", 5), async (req, res) => {
  try {
    const { name, password, role = "user", position } = req.body;
    let { phone } = req.body;

    phone = normalizePhone(phone);

    if (!name || !phone || !password) {
      return res.status(400).json({ error: "جميع الحقول مطلوبة: name, phone, password" });
    }

    if (position && !POSITIONS.includes(position)) {
      return res.status(400).json({ error: "المركز غير صحيح" });
    }

    const spd = clampStat(req.body.spd, 100);
    const fin = clampStat(req.body.fin, 100);
    const pas = clampStat(req.body.pas, 100);
    const skl = clampStat(req.body.skl, 100);
    const tkl = clampStat(req.body.tkl, 100);
    const str = clampStat(req.body.str, 100);

    const existingPhone = await User.findOne({ where: { phone } });
    if (existingPhone) {
      return res.status(400).json({ error: "تم استخدام رقم الهاتف من مستخدم اخر" });
    }

    const images = req.files && Array.isArray(req.files)
      ? req.files.map((f) => f.filename)
      : [];

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const user = await User.create({
      name,
      phone,
      password: hashedPassword,
      role,
      position: position || null,
      spd, fin, pas, skl, tkl, str,
      image: images.length ? { main: images[0], images } : null,
    });

    return res.status(201).json({
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      position: user.position,
      stats: { spd: user.spd, fin: user.fin, pas: user.pas, skl: user.skl, tkl: user.tkl, str: user.str },
      image: user.image,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  } catch (err) {
    console.error("❌ Error creating user:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/login", upload.none(), async (req, res) => {
  try {
    let { phone } = req.body;
    const { password } = req.body;

    phone = normalizePhone(phone);

    if (!phone || !password) {
      return res.status(400).json({ error: "يرجى إدخال رقم الهاتف وكلمة المرور" });
    }

    const user = await User.findOne({ where: { phone } });
    if (!user) {
      return res.status(400).json({ error: "يرجى إدخال رقم الهاتف بشكل صحيح" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(400).json({ error: "كلمة المرور غير صحيحة" });
    }

    const token = generateToken(user);

    return res.status(200).json({
      message: "Login successful",
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        position: user.position,
        stats: { spd: user.spd, fin: user.fin, pas: user.pas, skl: user.skl, tkl: user.tkl, str: user.str },
        image: user.image,
      },
      token,
    });
  } catch (err) {
    console.error("❌ خطأ أثناء تسجيل الدخول:", err);
    return res.status(500).json({ error: "خطأ داخلي في الخادم" });
  }
});

router.get("/usersOnly", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const offset = (page - 1) * limit;

    const { count, rows: users } = await User.findAndCountAll({
      where: { role: { [Op.notIn]: ["admin"] } },
      limit,
      offset,
      order: [["createdAt", "DESC"]],
      attributes: { exclude: ["password"] },
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
    console.error("❌ Error fetching users:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/user/:id", async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ["password"] },
    });

    if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

    const overall = Math.round(
      (user.spd + user.fin + user.pas + user.skl + user.tkl + user.str) / 6
    );

    return res.status(200).json({
      ...user.toJSON(),
      overall, 
    });
  } catch (err) {
    console.error("❌ Error fetching user:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/profile", async (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Token is missing" });

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) return res.status(401).json({ error: "Invalid token" });

    try {
      const user = await User.findByPk(decoded.id, {
        attributes: { exclude: ["password"] },
      });

      if (!user) return res.status(404).json({ error: "User not found" });

      const overall = Math.round(
        (user.spd + user.fin + user.pas + user.skl + user.tkl + user.str) / 6
      );

      return res.status(200).json({
        ...user.toJSON(),
        overall,
      });
    } catch (error) {
      console.error("❌ Error fetching user profile:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });
});

router.delete("/users/:id", async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      include: { model: UserDevice, as: "devices" },
    });
    if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

    await user.destroy();
    return res.status(200).json({ message: "تم حذف المستخدم وأجهزته بنجاح" });
  } catch (err) {
    console.error("❌ خطأ أثناء الحذف:", err);
    return res.status(500).json({ error: "حدث خطأ أثناء عملية الحذف" });
  }
});

router.put("/users/:id", uploadImage.array("images", 5), async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ error: "المستخدم غير موجود" });

    let { name, phone, password, role, position } = req.body;

    if (position && !POSITIONS.includes(position)) {
      return res.status(400).json({ error: "المركز غير صحيح" });
    }

    if (phone) {
      phone = normalizePhone(phone);

      const exists = await User.findOne({
        where: { phone, id: { [Op.ne]: user.id } },
      });
      if (exists) {
        return res.status(400).json({ error: "تم استخدام رقم الهاتف من مستخدم اخر" });
      }

      user.phone = phone;
    }

    if (name !== undefined) user.name = name;
    if (role !== undefined) user.role = role;
    if (position !== undefined) user.position = position || null;

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
      message: "تم تحديث بيانات المستخدم بنجاح",
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
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
    console.error("❌ Error updating user:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});


module.exports = router;
