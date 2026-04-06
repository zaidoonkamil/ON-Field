require('dotenv').config();
const express = require('express');
const router = express.Router();
const multer = require("multer");
const upload = multer();
const axios = require('axios');
const { User, UserDevice } = require('../models'); 
const NotificationLog = require("../models/notification_log");
const { Op } = require("sequelize");
const { authenticateToken } = require("../middlewares/auth");
const {
  ensureUserDeviceSchema,
  sendNotificationToAll,
  sendNotificationToRole,
  sendNotificationToUser,
  getUserChatNotificationSetting,
  updateUserChatNotificationSetting,
} = require('../services/notifications');

router.post("/notification/user", upload.none(), async (req, res) => {
  try {
    const { user_id, message, title } = req.body;

    if (!user_id || !message || !title) {
      return res.status(400).json({ error: "الحقول مطلوبة: user_id, message, title" });
    }

    const result = await sendNotificationToUser(user_id, message, title);

    await NotificationLog.create({
      target_type: "user",
      target_value: user_id.toString(),
      message,
      title,
    });

    res.json({ success: true, result });
  } catch (err) {
    console.error("❌ Error sending user notification:", err);
    res.status(500).json({ error: "خطأ في السيرفر", details: err.message });
  }
});

router.post("/register-device", async (req, res) => {
  const { user_id, player_id, chat_notifications_enabled } = req.body;

  if (!user_id || !player_id) {
    return res.status(400).json({ error: "user_id و player_id مطلوبان" });
  }

  try {
    await ensureUserDeviceSchema();

    const existingUserDevice = await UserDevice.findOne({
      where: { user_id },
      order: [["createdAt", "DESC"]],
    });

    const normalizedChatNotificationsEnabled =
      chat_notifications_enabled === undefined
        ? existingUserDevice
          ? Boolean(existingUserDevice.chat_notifications_enabled)
          : true
        : String(chat_notifications_enabled).toLowerCase() === "true";

    let device = await UserDevice.findOne({ where: { player_id } });

    if (device) {
      device.user_id = user_id;
      device.chat_notifications_enabled = normalizedChatNotificationsEnabled;
      await device.save();
    } else {
      await UserDevice.create({
        user_id,
        player_id,
        chat_notifications_enabled: normalizedChatNotificationsEnabled,
      });
    }

    res.json({ success: true, message: "تم تسجيل الجهاز بنجاح" });
  } catch (error) {
    console.error("❌ Error registering device:", error);
    res.status(500).json({ error: "حدث خطأ أثناء تسجيل الجهاز" });
  }
});

router.post("/notification", upload.none(), async (req, res) => {
  try {
    const { target_type, target_value, message, title } = req.body;

    if (!target_type || !message || !title) {
      return res.status(400).json({ error: "الحقول مطلوبة: target_type, message, title" });
    }

    let result;

    if (target_type === "all") {
      result = await sendNotificationToAll(message, title);
    } else if (target_type === "role") {
      if (!target_value) return res.status(400).json({ error: "يجب إدخال اسم الدور" });
      result = await sendNotificationToRole(target_value, message, title);
    } else if (target_type === "user") {
      if (!target_value) return res.status(400).json({ error: "يجب إدخال userId" });
      result = await sendNotificationToUser(target_value, message, title);
    } else {
      return res.status(400).json({ error: "target_type غير صحيح (all, role, user)" });
    }

    res.json({ success: true, result });
  } catch (err) {
    console.error("❌ Error sending notification:", err);
    res.status(500).json({ error: "خطأ في السيرفر", details: err.message });
  }
});

router.get("/chat/notifications/settings", authenticateToken, async (req, res) => {
  try {
    const chatNotificationsEnabled = await getUserChatNotificationSetting(req.user.id);

    return res.status(200).json({
      success: true,
      chatNotificationsEnabled,
    });
  } catch (error) {
    console.error("Error fetching chat notification settings:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/chat/notifications/settings", authenticateToken, upload.none(), async (req, res) => {
  try {
    const { chatNotificationsEnabled } = req.body;

    if (chatNotificationsEnabled === undefined) {
      return res.status(400).json({ error: "chatNotificationsEnabled مطلوب" });
    }

    const normalizedEnabled = String(chatNotificationsEnabled).toLowerCase() === "true";
    const result = await updateUserChatNotificationSetting(req.user.id, normalizedEnabled);

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Error updating chat notification settings:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/notifications-log", async (req, res) => {
  const { role, user_id, page = 1, limit = 20 } = req.query;

  try {
    const orConditions = [{ target_type: 'all' }];

    if (role) {
      orConditions.push({ target_type: 'role', target_value: role });
    }

    if (user_id) {
      orConditions.push({ target_type: 'user', target_value: user_id.toString() });
    }

    const offset = (page - 1) * limit;

    const { count, rows: logs } = await NotificationLog.findAndCountAll({
      where: { [Op.or]: orConditions },
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    res.json({
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      logs
    });

  } catch (err) {
    console.error("❌ Error fetching notification logs:", err);
    res.status(500).json({ error: "خطأ أثناء جلب السجل" });
  }
});


module.exports = router;
