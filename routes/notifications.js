require("dotenv").config();
const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer();
const { User, UserDevice } = require("../models");
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
} = require("../services/notifications");
const { isSuperAdmin, applyGovernorateScope } = require("../services/accessScope");

router.post("/notification/user", authenticateToken, upload.none(), async (req, res) => {
  try {
    const { user_id, message, title } = req.body;

    if (!user_id || !message || !title) {
      return res.status(400).json({ error: "user_id, message, title are required" });
    }

    const targetUser = await User.findByPk(Number(user_id), {
      attributes: ["id", "governorateId"],
    });
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }
    if (
      !isSuperAdmin(req.user) &&
      Number(targetUser.governorateId) !== Number(req.user.governorateId)
    ) {
      return res.status(403).json({ error: "Not allowed for this governorate" });
    }

    const result = await sendNotificationToUser(user_id, message, title);

    await NotificationLog.create({
      target_type: "user",
      target_value: user_id.toString(),
      message,
      title,
      user_id: Number(user_id),
    });

    res.json({ success: true, result });
  } catch (err) {
    console.error("Error sending user notification:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

router.post("/register-device", async (req, res) => {
  const { user_id, player_id, chat_notifications_enabled } = req.body;

  if (!user_id || !player_id) {
    return res.status(400).json({ error: "user_id and player_id are required" });
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

    res.json({ success: true, message: "Device registered successfully" });
  } catch (error) {
    console.error("Error registering device:", error);
    res.status(500).json({ error: "Device registration failed" });
  }
});

router.post("/notification", authenticateToken, upload.none(), async (req, res) => {
  try {
    const { target_type, target_value, message, title } = req.body;

    if (!target_type || !message || !title) {
      return res.status(400).json({ error: "target_type, message, title are required" });
    }

    let result;

    if (target_type === "all") {
      if (isSuperAdmin(req.user)) {
        result = await sendNotificationToAll(message, title);
      } else {
        const users = await User.findAll({
          where: applyGovernorateScope({}, Number(req.user.governorateId)),
          attributes: ["id"],
        });

        for (const user of users) {
          await sendNotificationToUser(user.id, message, title);
        }

        result = { sentTo: users.length };
      }
    } else if (target_type === "role") {
      if (!target_value) {
        return res.status(400).json({ error: "role is required" });
      }

      if (!isSuperAdmin(req.user) && target_value === "super_admin") {
        return res.status(403).json({ error: "Not allowed" });
      }

      result = await sendNotificationToRole(target_value, message, title);
    } else if (target_type === "user") {
      if (!target_value) {
        return res.status(400).json({ error: "userId is required" });
      }

      const targetUser = await User.findByPk(Number(target_value), {
        attributes: ["id", "governorateId"],
      });
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }
      if (
        !isSuperAdmin(req.user) &&
        Number(targetUser.governorateId) !== Number(req.user.governorateId)
      ) {
        return res.status(403).json({ error: "Not allowed for this governorate" });
      }

      result = await sendNotificationToUser(target_value, message, title);
    } else {
      return res.status(400).json({ error: "Invalid target_type" });
    }

    res.json({ success: true, result });
  } catch (err) {
    console.error("Error sending notification:", err);
    res.status(500).json({ error: "Server error", details: err.message });
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
      return res.status(400).json({ error: "chatNotificationsEnabled is required" });
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

router.get("/notifications-log", authenticateToken, async (req, res) => {
  const { role, user_id, page = 1, limit = 20 } = req.query;

  try {
    const orConditions = [{ target_type: "all" }];

    if (role) {
      orConditions.push({ target_type: "role", target_value: role });
    }

    if (user_id) {
      orConditions.push({ target_type: "user", target_value: user_id.toString() });
    }

    const logWhere = { [Op.or]: orConditions };

    if (!isSuperAdmin(req.user)) {
      const users = await User.findAll({
        where: applyGovernorateScope({}, Number(req.user.governorateId)),
        attributes: ["id"],
      });
      logWhere.user_id = { [Op.in]: users.map((item) => item.id) };
    }

    const offset = (page - 1) * limit;

    const { count, rows: logs } = await NotificationLog.findAndCountAll({
      where: logWhere,
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    res.json({
      total: count,
      page: parseInt(page, 10),
      totalPages: Math.ceil(count / limit),
      logs,
    });
  } catch (err) {
    console.error("Error fetching notification logs:", err);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

module.exports = router;
