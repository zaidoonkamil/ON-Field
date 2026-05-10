const { DataTypes, Op } = require("sequelize");
const sequelize = require("../config/db");
const { User, UserDevice } = require("../models");
const NotificationLog = require("../models/notification_log");
const axios = require("axios");

let userDeviceSchemaPromise = null;

const ensureUserDeviceSchema = async () => {
  if (!userDeviceSchemaPromise) {
    userDeviceSchemaPromise = (async () => {
      await UserDevice.sync();

      const queryInterface = sequelize.getQueryInterface();
      const tableName = UserDevice.getTableName();
      const tableDefinition = await queryInterface.describeTable(tableName);

      if (!tableDefinition.chat_notifications_enabled) {
        await queryInterface.addColumn(tableName, "chat_notifications_enabled", {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        });
      }
    })().catch((error) => {
      userDeviceSchemaPromise = null;
      throw error;
    });
  }

  return userDeviceSchemaPromise;
};

const sendNotificationToDevices = async (playerIds, message, title = "Notification") => {
  const url = 'https://onesignal.com/api/v1/notifications';
  const headers = {
    'Authorization': `Basic ${process.env.ONESIGNAL_API_KEY}`,
    'Content-Type': 'application/json',
  };
  const data = {
    app_id: process.env.ONESIGNAL_APP_ID,
    include_player_ids: playerIds,
    contents: { en: message },
    headings: { en: title },
  };

  return axios.post(url, data, { headers });
};

const sendNotificationToAll = async (message, title = "Notification") => {
  await ensureUserDeviceSchema();
  const users = await User.findAll({ attributes: ["id"] });

  for (const user of users) {
    const devices = await UserDevice.findAll({ where: { user_id: user.id } });

    const playerIds = [...new Set(devices.map(d => d.player_id).filter(Boolean))];

    const logData = {
      title,
      message,
      target_type: "user",
      target_value: user.id.toString(),
      user_id: user.id,
    };

    if (playerIds.length === 0) {
      logData.status = "failed";
      await NotificationLog.create(logData);
      continue;
    }

    try {
      await sendNotificationToDevices(playerIds, message, title);
      logData.status = "sent";
      await NotificationLog.create(logData);
    } catch (err) {
      console.error(`❌ Error sending notification to user ${user.id}:`, err.message);
      logData.status = "failed";
      await NotificationLog.create(logData);
    }
  }
};

const sendNotificationToRole = async (role, message, title = "Notification") => {
  await ensureUserDeviceSchema();
  const devices = await UserDevice.findAll({
    include: [{ model: User, as: "user", where: { role } }]
  });

  const devicesByUser = {};
  devices.forEach(d => {
    if (!devicesByUser[d.user_id]) devicesByUser[d.user_id] = [];
    devicesByUser[d.user_id].push(d.player_id);
  });

  for (const [userId, ids] of Object.entries(devicesByUser)) {
    const playerIds = [...new Set(ids.filter(Boolean))];

    const logData = {
      title,
      message,
      target_type: "user",
      target_value: userId.toString(),
      user_id: parseInt(userId),
    };

    if (playerIds.length === 0) {
      logData.status = "failed";
      await NotificationLog.create(logData);
      continue;
    }

    try {
      await sendNotificationToDevices(playerIds, message, title);
      logData.status = "sent";
      await NotificationLog.create(logData);
    } catch (err) {
      console.error(`❌ Error sending notification to user ${userId}:`, err.message);
      logData.status = "failed";
      await NotificationLog.create(logData);
    }
  }
};

const sendNotificationToUser = async (userId, message, title = "Notification") => {
  await ensureUserDeviceSchema();
  const devices = await UserDevice.findAll({
    where: { user_id: userId }
  });

  if (process.env.DEBUG_NOTIFICATION_DEVICES === "true") {
    console.log(
      "🔎 Devices for user:",
      userId,
      devices.map((d) => d.toJSON())
    );
  }

  const playerIds = [...new Set(devices.map(d => d.player_id).filter(Boolean))];

  const logData = {
    title,
    message,
    target_type: "user",
    target_value: userId.toString(),
    user_id: userId,
  };

  if (playerIds.length === 0) {
    logData.status = "failed";
    await NotificationLog.create(logData);
    return { success: false, message: `لا توجد أجهزة للمستخدم ${userId}` };
  }

  try {
    await sendNotificationToDevices(playerIds, message, title);
    logData.status = "sent";
    await NotificationLog.create(logData);
    return { success: true };
  } catch (err) {
    console.error(`❌ Error sending notification to user ${userId}:`, err.message);
    logData.status = "failed";
    await NotificationLog.create(logData);
    return { success: false, error: err.message };
  }
};

const sendChatNotificationToAllExcept = async ({
  senderUserId,
  excludedUserIds = [],
  eligibleUserIds = null,
  message,
  title = "رسالة جديدة في الدردشة",
}) => {
  await ensureUserDeviceSchema();

  const excluded = new Set(
    [senderUserId, ...excludedUserIds]
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  );

  const normalizedEligibleUserIds = Array.isArray(eligibleUserIds)
    ? eligibleUserIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    : null;

  const userIdFilters = [];

  if (excluded.size) {
    userIdFilters.push({
      [Op.notIn]: [...excluded],
    });
  }

  if (normalizedEligibleUserIds) {
    if (!normalizedEligibleUserIds.length) {
      return;
    }

    userIdFilters.push({
      [Op.in]: normalizedEligibleUserIds,
    });
  }

  const devices = await UserDevice.findAll({
    where: {
      chat_notifications_enabled: true,
      ...(userIdFilters.length
        ? {
            user_id:
              userIdFilters.length === 1
                ? userIdFilters[0]
                : { [Op.and]: userIdFilters },
          }
        : {}),
    },
  });

  const devicesByUser = {};
  devices.forEach((device) => {
    if (!devicesByUser[device.user_id]) devicesByUser[device.user_id] = [];
    devicesByUser[device.user_id].push(device.player_id);
  });

  for (const [userId, ids] of Object.entries(devicesByUser)) {
    const playerIds = [...new Set(ids.filter(Boolean))];

    const logData = {
      title,
      message,
      target_type: "user",
      target_value: userId.toString(),
      user_id: parseInt(userId, 10),
    };

    if (playerIds.length === 0) {
      logData.status = "failed";
      await NotificationLog.create(logData);
      continue;
    }

    try {
      await sendNotificationToDevices(playerIds, message, title);
      logData.status = "sent";
      await NotificationLog.create(logData);
    } catch (err) {
      console.error(`Error sending chat notification to user ${userId}:`, err.message);
      logData.status = "failed";
      await NotificationLog.create(logData);
    }
  }
};

const getUserChatNotificationSetting = async (userId) => {
  await ensureUserDeviceSchema();

  const device = await UserDevice.findOne({
    where: { user_id: userId },
    order: [["createdAt", "DESC"]],
  });

  return device ? Boolean(device.chat_notifications_enabled) : true;
};

const updateUserChatNotificationSetting = async (userId, enabled) => {
  await ensureUserDeviceSchema();

  const normalizedEnabled = Boolean(enabled);

  await UserDevice.update(
    { chat_notifications_enabled: normalizedEnabled },
    { where: { user_id: userId } }
  );

  return {
    userId: Number(userId),
    chatNotificationsEnabled: normalizedEnabled,
  };
};

module.exports = {
  ensureUserDeviceSchema,
  sendNotificationToAll,
  sendNotificationToRole,
  sendNotificationToUser,
  sendChatNotificationToAllExcept,
  getUserChatNotificationSetting,
  updateUserChatNotificationSetting,
};
