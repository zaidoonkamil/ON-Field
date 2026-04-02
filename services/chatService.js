const fs = require("fs");
const path = require("path");
const { DataTypes, Op } = require("sequelize");
const sequelize = require("../config/db");
const { Message, User } = require("../models");
const { sendNotificationToUser } = require("./notifications");

const MAX_MESSAGES_PER_ROOM = 100;
const uploadsDirectory = path.resolve(__dirname, "..", "uploads");

class ChatService {
  constructor() {
    this.schemaPromise = null;
  }

  async ensureMessageSchema() {
    if (!this.schemaPromise) {
      this.schemaPromise = this._ensureMessageSchema().catch((error) => {
        this.schemaPromise = null;
        throw error;
      });
    }

    return this.schemaPromise;
  }

  async _ensureMessageSchema() {
    await Message.sync();

    const queryInterface = sequelize.getQueryInterface();
    const tableName = Message.getTableName();
    const tableDefinition = await queryInterface.describeTable(tableName);

    if (!tableDefinition.mediaUrl) {
      await queryInterface.addColumn(tableName, "mediaUrl", {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
      });
    }

    if (!tableDefinition.mediaType) {
      await queryInterface.addColumn(tableName, "mediaType", {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "text",
      });
    }

    if (!tableDefinition.mentions) {
      await queryInterface.addColumn(tableName, "mentions", {
        type: DataTypes.TEXT("long"),
        allowNull: true,
      });
    }
  }

  parseMentions(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;

    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (error) {
        return value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      }
    }

    return [];
  }

  detectMentionIdsFromContent(content = "") {
    const ids = new Set();
    const mentionMatches = content.match(/@(\d+)/g) || [];

    for (const mention of mentionMatches) {
      const userId = Number(mention.replace("@", ""));
      if (Number.isInteger(userId) && userId > 0) {
        ids.add(userId);
      }
    }

    return [...ids];
  }

  normalizeMentions(mentions = [], content = "") {
    const parsedMentions = this.parseMentions(mentions);
    const normalized = [];
    const seen = new Set();

    const pushMention = (candidate) => {
      if (candidate === undefined || candidate === null) {
        return;
      }

      let userId = null;
      let name = null;

      if (typeof candidate === "number") {
        userId = candidate;
      } else if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (/^\d+$/.test(trimmed)) {
          userId = Number(trimmed);
        } else {
          name = trimmed;
        }
      } else if (typeof candidate === "object") {
        const rawId = candidate.userId ?? candidate.id ?? candidate.value;
        if (rawId !== undefined && rawId !== null && `${rawId}`.trim() !== "") {
          const numericId = Number(rawId);
          userId = Number.isNaN(numericId) ? null : numericId;
        }
        name = candidate.name ?? candidate.username ?? candidate.label ?? null;
      }

      const key = userId ? `id:${userId}` : name ? `name:${String(name).toLowerCase()}` : null;
      if (!key || seen.has(key)) {
        return;
      }

      seen.add(key);
      normalized.push({ userId, name: name || null });
    };

    parsedMentions.forEach(pushMention);
    this.detectMentionIdsFromContent(content).forEach((userId) => pushMention({ userId }));

    return normalized.filter((item) => item.userId || item.name);
  }

  resolveMediaType(mediaType = "", mediaUrl = "") {
    const value = `${mediaType || mediaUrl || ""}`.toLowerCase();

    if (value.includes("image")) return "image";
    if (value.includes("video")) return "video";
    if (value.includes("audio")) return "audio";

    const extension = path.extname(value).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(extension)) return "image";
    if ([".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(extension)) return "video";
    if ([".mp3", ".wav", ".ogg", ".m4a", ".aac"].includes(extension)) return "audio";

    return "text";
  }

  getMessagePreview(message = {}) {
    if (message.content && message.content.trim()) {
      return message.content.trim().slice(0, 80);
    }

    if (message.mediaType === "image") return "صورة";
    if (message.mediaType === "video") return "فيديو";
    if (message.mediaType === "audio") return "مقطع صوتي";

    return "رسالة جديدة";
  }

  formatMessage(message) {
    const plainMessage = typeof message.toJSON === "function" ? message.toJSON() : message;
    const mentions = Array.isArray(plainMessage.mentions)
      ? plainMessage.mentions
      : this.parseMentions(plainMessage.mentions);

    return {
      ...plainMessage,
      content: plainMessage.content || "",
      mediaUrl: plainMessage.mediaUrl || null,
      mediaType: plainMessage.mediaType || (plainMessage.mediaUrl ? this.resolveMediaType("", plainMessage.mediaUrl) : "text"),
      mentions,
    };
  }

  getLocalMediaPath(mediaUrl) {
    if (!mediaUrl) return null;

    let relativePath = mediaUrl;

    try {
      if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
        relativePath = new URL(mediaUrl).pathname;
      }
    } catch (error) {
      relativePath = mediaUrl;
    }

    relativePath = relativePath.split("?")[0].replace(/\\/g, "/");

    if (relativePath.includes("/uploads/")) {
      relativePath = relativePath.split("/uploads/").pop();
    } else {
      relativePath = relativePath.replace(/^\/?uploads\/?/i, "");
    }

    const safeFileName = path.basename(relativePath);
    return safeFileName ? path.join(uploadsDirectory, safeFileName) : null;
  }

  async deleteMessageMedia(mediaUrl) {
    try {
      const filePath = this.getLocalMediaPath(mediaUrl);
      if (!filePath || !fs.existsSync(filePath)) {
        return;
      }

      await fs.promises.unlink(filePath);
    } catch (error) {
      console.error("Error deleting chat media file:", error.message);
    }
  }

  // حفظ الرسالة في قاعدة البيانات
  async saveMessage(userIdOrPayload, content, room = "main_chat") {
    try {
      await this.ensureMessageSchema();

      const payload = typeof userIdOrPayload === "object"
        ? userIdOrPayload
        : { userId: userIdOrPayload, content, room };

      const userId = Number(payload.userId);
      const messageContent = typeof payload.content === "string" ? payload.content.trim() : "";
      const targetRoom = payload.room || "main_chat";
      const mediaUrl = payload.mediaUrl || null;
      const resolvedMediaType = mediaUrl
        ? this.resolveMediaType(payload.mediaType, mediaUrl)
        : "text";
      const mentions = this.normalizeMentions(payload.mentions, messageContent);

      if (!userId) {
        throw new Error("userId مطلوب لإرسال الرسالة");
      }

      if (!messageContent && !mediaUrl) {
        throw new Error("لا يمكن إرسال رسالة فارغة");
      }

      const message = await Message.create({
        userId,
        content: messageContent,
        room: targetRoom,
        mediaUrl,
        mediaType: resolvedMediaType,
        mentions,
      });

      await this.trimRoomMessages(targetRoom, MAX_MESSAGES_PER_ROOM);

      const savedMessage = await Message.findByPk(message.id, {
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "name", "image", "position", "role"],
          },
        ],
      });

      return this.formatMessage(savedMessage);
    } catch (error) {
      console.error("Error saving message:", error);
      throw error;
    }
  }

  // الحصول على بيانات المستخدم المرسل للرسالة
  async getUserData(userId) {
    try {
      const user = await User.findByPk(userId, {
        attributes: ["id", "name", "image", "position", "role"],
      });
      return user;
    } catch (error) {
      console.error("Error fetching user data:", error);
      throw error;
    }
  }

  // الحصول على جميع الرسائل
  async getAllMessages(room = "main_chat", limit = 50) {
    try {
      await this.ensureMessageSchema();

      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), MAX_MESSAGES_PER_ROOM);
      const messages = await Message.findAll({
        where: { room },
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "name", "image", "position", "role"],
          },
        ],
        order: [["createdAt", "DESC"]],
        limit: safeLimit,
      });

      return messages.reverse().map((message) => this.formatMessage(message));
    } catch (error) {
      console.error("Error fetching messages:", error);
      throw error;
    }
  }

  async trimRoomMessages(room = "main_chat", maxMessages = MAX_MESSAGES_PER_ROOM) {
    await this.ensureMessageSchema();

    const totalMessages = await Message.count({ where: { room } });
    if (totalMessages <= maxMessages) {
      return [];
    }

    const messagesToDelete = await Message.findAll({
      where: { room },
      order: [["createdAt", "DESC"]],
      offset: maxMessages,
    });

    for (const message of messagesToDelete) {
      await this.deleteMessageMedia(message.mediaUrl);
    }

    await Message.destroy({
      where: {
        id: {
          [Op.in]: messagesToDelete.map((message) => message.id),
        },
      },
    });

    return messagesToDelete.map((message) => message.id);
  }

  async enforceMessageLimitForAllRooms(maxMessages = MAX_MESSAGES_PER_ROOM) {
    await this.ensureMessageSchema();

    const rooms = await Message.findAll({
      attributes: ["room"],
      group: ["room"],
      raw: true,
    });

    for (const entry of rooms) {
      await this.trimRoomMessages(entry.room || "main_chat", maxMessages);
    }
  }

  async searchMentionUsers(query = "", limit = 20, excludeUserId = null) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const trimmedQuery = String(query || "").trim();

    const where = {};

    if (excludeUserId !== undefined && excludeUserId !== null && `${excludeUserId}`.trim() !== "") {
      const normalizedExcludeId = Number(excludeUserId);
      if (Number.isInteger(normalizedExcludeId) && normalizedExcludeId > 0) {
        where.id = {
          [Op.ne]: normalizedExcludeId,
        };
      }
    }

    if (trimmedQuery) {
      where.name = {
        [Op.like]: `%${trimmedQuery}%`,
      };
    }

    const users = await User.findAll({
      where,
      attributes: ["id", "name", "image", "position", "role"],
      order: [["name", "ASC"]],
      limit: safeLimit,
    });

    return users.map((user) => ({
      id: user.id,
      name: user.name,
      image: user.image,
      position: user.position,
      role: user.role,
    }));
  }

  async notifyMentionedUsers({ message, sender, io = null, connectedUsersMap = {} }) {
    const mentions = this.normalizeMentions(message.mentions, message.content);
    const senderId = Number(sender?.id ?? message?.userId);
    const senderName = sender?.name || "أحد المستخدمين";

    const directMentionIds = mentions
      .map((item) => Number(item.userId))
      .filter((id) => Number.isInteger(id) && id > 0 && id !== senderId);

    const mentionNames = mentions
      .filter((item) => !item.userId && item.name)
      .map((item) => String(item.name).trim())
      .filter(Boolean);

    let resolvedMentionIds = [];
    if (mentionNames.length) {
      const mentionedUsers = await User.findAll({
        where: {
          name: {
            [Op.in]: mentionNames,
          },
        },
        attributes: ["id", "name"],
      });

      resolvedMentionIds = mentionedUsers
        .map((user) => Number(user.id))
        .filter((id) => Number.isInteger(id) && id > 0 && id !== senderId);
    }

    const uniqueUserIds = [...new Set([...directMentionIds, ...resolvedMentionIds])];

    if (!uniqueUserIds.length) {
      return { notifiedUsers: [] };
    }

    const payload = this.formatMessage(message);
    const preview = this.getMessagePreview(payload);
    const notificationMessage = `${senderName} قام بعمل منشن لك في الدردشة: ${preview}`;

    const results = await Promise.allSettled(
      uniqueUserIds.map(async (mentionedUserId) => {
        await sendNotificationToUser(mentionedUserId, notificationMessage, "منشن جديد في الدردشة");

        if (io) {
          const sockets = Object.values(connectedUsersMap).filter(
            (user) => Number(user.userId) === mentionedUserId
          );

          sockets.forEach((user) => {
            io.to(user.socketId).emit("mentioned_in_message", {
              mentionedUserId,
              sender,
              message: payload,
            });
          });
        }

        return mentionedUserId;
      })
    );

    return {
      notifiedUsers: uniqueUserIds.filter((userId, index) => results[index].status === "fulfilled"),
    };
  }

  // حذف رسالة
  async deleteMessage(messageId) {
    try {
      await this.ensureMessageSchema();

      const message = await Message.findByPk(messageId, {
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "name", "image", "position", "role"],
          },
        ],
      });

      if (!message) {
        return null;
      }

      const formattedMessage = this.formatMessage(message);
      await this.deleteMessageMedia(message.mediaUrl);
      await message.destroy();

      return formattedMessage;
    } catch (error) {
      console.error("Error deleting message:", error);
      throw error;
    }
  }

  // تحديث رسالة
  async updateMessage(messageId, content, mentions) {
    try {
      await this.ensureMessageSchema();

      const message = await Message.findByPk(messageId);
      if (!message) {
        throw new Error("الرسالة غير موجودة");
      }

      const nextContent = typeof content === "string" ? content.trim() : message.content;
      if (!nextContent && !message.mediaUrl) {
        throw new Error("لا يمكن ترك الرسالة فارغة");
      }

      message.content = nextContent;

      if (mentions !== undefined) {
        message.mentions = this.normalizeMentions(mentions, nextContent);
      }

      await message.save();

      const updatedMessage = await Message.findByPk(messageId, {
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "name", "image", "position", "role"],
          },
        ],
      });

      return this.formatMessage(updatedMessage);
    } catch (error) {
      console.error("Error updating message:", error);
      throw error;
    }
  }
}

module.exports = new ChatService();
