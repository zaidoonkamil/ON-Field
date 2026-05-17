const express = require("express");
const multer = require("multer");
const { User } = require("../models");
const { authenticateToken } = require("../middlewares/auth");
const jwt = require("jsonwebtoken");
const {
  getQrCode,
  getStatus,
  initWhatsAppClient,
  logoutWhatsApp,
  normalizeWhatsAppPhone,
  sendWhatsAppText,
  cleanupSessionCache,
  deleteWhatsAppSession,
} = require("../services/waSender");

const router = express.Router();
const upload = multer();

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function ensureAdmin(req, res) {
  if (!["admin", "super_admin"].includes(req.user?.role)) {
    res
      .status(403)
      .json({ error: "Only admin or super admin can use WhatsApp service" });
    return false;
  }

  return true;
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, phone: user.phone, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "700d" }
  );
}

router.post("/whatsapp/otp/request", upload.none(), async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "phone is required" });
    }

    return res.status(200).json({
      success: true,
      phone: normalizeWhatsAppPhone(phone),
      expiresInSeconds: 0,
      retryAfterSeconds: 0,
      bypassed: true,
      message: "OTP bypassed. Booking can continue without WhatsApp verification.",
    });
  } catch (error) {
    console.error("WhatsApp OTP request error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/whatsapp/otp/verify", upload.none(), async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "phone is required" });
    }

    const normalizedPhone = normalizeWhatsAppPhone(phone);
    const user = await User.findOne({ where: { phone: normalizedPhone } });

    if (!user) {
      return res.status(200).json({
        success: true,
        verified: true,
        phone: normalizedPhone,
        userExists: false,
        bypassed: true,
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      verified: true,
      phone: normalizedPhone,
      userExists: true,
      bypassed: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        position: user.position,
        image: user.image,
      },
    });
  } catch (error) {
    console.error("WhatsApp OTP verify error:", error.message);
    return res.status(400).json({ error: error.message });
  }
});

router.post("/whatsapp/init", authenticateToken, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const status = await initWhatsAppClient();
    return res.status(200).json({ success: true, ...status });
  } catch (error) {
    console.error("WhatsApp init error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/whatsapp/status", authenticateToken, async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  return res.status(200).json({ success: true, ...getStatus() });
});

router.get("/whatsapp/qr", authenticateToken, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const qr = await getQrCode();
    return res.status(200).json({ success: true, ...qr });
  } catch (error) {
    console.error("WhatsApp QR error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/whatsapp/session/cleanup", authenticateToken, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const result = cleanupSessionCache();
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("WhatsApp session cleanup error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/whatsapp/session/reset", authenticateToken, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    // Must logout first to kill the browser
    try {
      await logoutWhatsApp();
    } catch (_) {}

    const deleted = deleteWhatsAppSession();
    return res.status(200).json({
      success: true,
      deleted,
      message: deleted
        ? "\u062a\u0645 \u062d\u0630\u0641 \u0627\u0644\u062c\u0644\u0633\u0629. \u0633\u062a\u062d\u062a\u0627\u062c \u0644\u0645\u0633\u062d QR \u0645\u0646 \u062c\u062f\u064a\u062f."
        : "\u0644\u0645 \u064a\u0648\u062c\u062f \u0645\u0644\u0641 \u062c\u0644\u0633\u0629 \u0644\u0644\u062d\u0630\u0641",
    });
  } catch (error) {
    console.error("WhatsApp session reset error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/whatsapp/logout", authenticateToken, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const result = await logoutWhatsApp();
    return res.status(200).json(result);
  } catch (error) {
    console.error("WhatsApp logout error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/whatsapp/send", authenticateToken, upload.none(), async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const { user_id, phone, message } = req.body;

    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    let targetPhone = phone;
    let user = null;

    if (!targetPhone && user_id) {
      user = await User.findByPk(user_id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      targetPhone = user.phone;
    }

    if (!targetPhone) {
      return res.status(400).json({ error: "phone or user_id is required" });
    }

    const result = await sendWhatsAppText(targetPhone, message);

    return res.status(200).json({
      success: true,
      phone: result.to,
      user_id: user ? user.id : null,
      messageId: result.messageId,
      timestamp: result.timestamp,
      status: result.status,
    });
  } catch (error) {
    console.error("WhatsApp send error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/whatsapp/send-bulk", authenticateToken, upload.none(), async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;

    const { message } = req.body;
    const phones = parseList(req.body.phones);
    const userIds = parseList(req.body.user_ids);

    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    if (!phones.length && !userIds.length) {
      return res.status(400).json({ error: "phones or user_ids is required" });
    }

    const targets = new Map();

    for (const rawPhone of phones) {
      const normalizedPhone = normalizeWhatsAppPhone(rawPhone);
      targets.set(normalizedPhone, { phone: normalizedPhone, user_id: null });
    }

    if (userIds.length) {
      const users = await User.findAll({ where: { id: userIds } });

      for (const user of users) {
        if (!user.phone) continue;
        const normalizedPhone = normalizeWhatsAppPhone(user.phone);
        targets.set(normalizedPhone, {
          phone: normalizedPhone,
          user_id: user.id,
        });
      }
    }

    const results = [];

    for (const target of targets.values()) {
      try {
        const sendResult = await sendWhatsAppText(target.phone, message);
        results.push({
          success: true,
          phone: target.phone,
          user_id: target.user_id,
          messageId: sendResult.messageId,
          timestamp: sendResult.timestamp,
        });
      } catch (error) {
        results.push({
          success: false,
          phone: target.phone,
          user_id: target.user_id,
          error: error.message,
        });
      }
    }

    const sent = results.filter((item) => item.success).length;

    return res.status(200).json({
      success: true,
      total: results.length,
      sent,
      failed: results.length - sent,
      results,
    });
  } catch (error) {
    console.error("WhatsApp bulk send error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
