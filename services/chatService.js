const fs = require("fs");
const path = require("path");
const { DataTypes, Op } = require("sequelize");
const sequelize = require("../config/db");
const { Message, User, Governorate, ChatPoll, ChatPollOption, ChatPollVote } = require("../models");
const { sendNotificationToUser, sendChatNotificationToAllExcept } = require("./notifications");

const MAX_MESSAGES_PER_ROOM = 100;
const uploadsDirectory = path.resolve(__dirname, "..", "uploads");

class ChatService {
  constructor() {
    this.schemaPromise = null;
  }

  getDefaultRoom() {
    return "main_chat";
  }

  isScopedRoom(room) {
    return typeof room === "string" && /^governorate_\d+$/.test(room);
  }

  isAnnouncementRoom(room) {
    return typeof room === "string" && /^announcements_(\d+|main)$/.test(room);
  }

  isSupportRoom(room) {
    return typeof room === "string" && /^support_\d+$/.test(room);
  }

  getAnnouncementsRoomForGovernorateId(governorateId) {
    const normalizedGovernorateId = Number(governorateId);
    return Number.isInteger(normalizedGovernorateId) && normalizedGovernorateId > 0
      ? `announcements_${normalizedGovernorateId}`
      : "announcements_main";
  }

  getSupportRoomForUserId(userId) {
    const normalizedUserId = Number(userId);
    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
      throw new Error("Invalid support user");
    }
    return `support_${normalizedUserId}`;
  }

  getSupportUserId(room) {
    if (!this.isSupportRoom(room)) return null;
    const userId = Number(room.split("_")[1]);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
  }

  isAdminRole(role) {
    return ["admin", "super_admin"].includes(role);
  }

  getRoomForGovernorateId(governorateId) {
    const normalizedGovernorateId = Number(governorateId);
    if (Number.isInteger(normalizedGovernorateId) && normalizedGovernorateId > 0) {
      return `governorate_${normalizedGovernorateId}`;
    }

    return this.getDefaultRoom();
  }

  async resolveCanonicalRoomForGovernorateId(governorateId) {
    const normalizedGovernorateId = Number(governorateId);
    if (!Number.isInteger(normalizedGovernorateId) || normalizedGovernorateId <= 0) {
      return this.getDefaultRoom();
    }

    const governorate = await Governorate.findByPk(normalizedGovernorateId, {
      attributes: ["id", "name"],
    });

    const governorateName = governorate?.name?.toString().trim().toLowerCase() ?? "";
    if (governorateName == "بغداد" || governorateName == "baghdad") {
      return this.getDefaultRoom();
    }

    return this.getRoomForGovernorateId(normalizedGovernorateId);
  }

  async getRoomForUserId(userId) {
    const normalizedUserId = Number(userId);
    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
      throw new Error("userId is required");
    }

    const user = await User.findByPk(normalizedUserId, {
      attributes: ["id", "governorateId"],
    });

    if (!user) {
      throw new Error("User not found");
    }

    return this.resolveCanonicalRoomForGovernorateId(user.governorateId);
  }

  async resolveRoomForUser(userId, requestedRoom) {
    const defaultRoom = this.getDefaultRoom();
    const normalizedRequestedRoom =
      typeof requestedRoom === "string" && requestedRoom.trim() !== ""
        ? requestedRoom.trim()
        : defaultRoom;

    const user = await User.findByPk(Number(userId), {
      attributes: ["id", "governorateId", "role"],
    });

    if (!user) {
      throw new Error("User not found");
    }

    if (this.isAnnouncementRoom(normalizedRequestedRoom)) {
      const announcementRoom = this.getAnnouncementsRoomForGovernorateId(
        user.governorateId
      );
      if (normalizedRequestedRoom !== announcementRoom) {
        throw new Error("Not allowed for this room");
      }
      return announcementRoom;
    }

    if (this.isSupportRoom(normalizedRequestedRoom)) {
      const supportUserId = this.getSupportUserId(normalizedRequestedRoom);
      const supportUser = await User.findByPk(supportUserId, {
        attributes: ["id", "governorateId"],
      });
      if (!supportUser) throw new Error("Support user not found");

      const canAccessSupport =
        Number(user.id) === Number(supportUserId) ||
        user.role === "super_admin" ||
        (user.role === "admin" &&
          Number(user.governorateId) === Number(supportUser.governorateId));
      if (!canAccessSupport) throw new Error("Not allowed for this room");
      return normalizedRequestedRoom;
    }

    if (!this.isScopedRoom(normalizedRequestedRoom)) {
      return defaultRoom;
    }

    const allowedRoom = await this.resolveCanonicalRoomForGovernorateId(user.governorateId);
    const scopedGovernorateRoom = this.getRoomForGovernorateId(user.governorateId);

    if (
      normalizedRequestedRoom !== allowedRoom &&
      normalizedRequestedRoom !== scopedGovernorateRoom
    ) {
      throw new Error("Not allowed for this room");
    }

    return allowedRoom;
  }

  async canUserSendToRoom(userId, room) {
    const user = await User.findByPk(Number(userId), {
      attributes: ["id", "role"],
    });
    if (!user) throw new Error("User not found");

    if (this.isAnnouncementRoom(room) && !this.isAdminRole(user.role)) {
      return false;
    }

    return true;
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

    if (!tableDefinition.replyToMessageId) {
      await queryInterface.addColumn(tableName, "replyToMessageId", {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "Messages",
          key: "id",
        },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      });
    }

    if (!tableDefinition.isPinned) {
      await queryInterface.addColumn(tableName, "isPinned", {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }

    if (!tableDefinition.pinnedAt) {
      await queryInterface.addColumn(tableName, "pinnedAt", {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      });
    }

    if (!tableDefinition.pinnedByUserId) {
      await queryInterface.addColumn(tableName, "pinnedByUserId", {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "Users",
          key: "id",
        },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      });
    }

    await this.migrateBaghdadScopedRoomToLegacy();
  }

  async migrateBaghdadScopedRoomToLegacy() {
    const baghdad = await Governorate.findOne({
      where: {
        name: {
          [Op.in]: ["بغداد", "Baghdad"],
        },
      },
      attributes: ["id", "name"],
    });

    if (!baghdad) {
      return;
    }

    await Message.update(
      { room: this.getDefaultRoom() },
      {
        where: {
          room: this.getRoomForGovernorateId(baghdad.id),
        },
      }
    );
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

  getMessageIncludes() {
    return [
      {
        model: User,
        as: "user",
        attributes: ["id", "name", "image", "position", "role"],
      },
      {
        model: ChatPoll,
        as: "poll",
        include: [
          {
            model: ChatPollOption,
            as: "options",
            include: [{ model: ChatPollVote, as: "votes", attributes: ["id", "optionId"] }],
          },
        ],
      },
      {
        model: Message,
        as: "replyTo",
        attributes: ["id", "content", "mediaUrl", "mediaType", "createdAt"],
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "name", "image", "position", "role"],
          },
        ],
      },
      {
        model: User,
        as: "pinnedBy",
        attributes: ["id", "name", "image", "position", "role"],
      },
    ];
  }

  formatMessage(message) {
    const plainMessage = typeof message.toJSON === "function" ? message.toJSON() : message;
    const mentions = Array.isArray(plainMessage.mentions)
      ? plainMessage.mentions
      : this.parseMentions(plainMessage.mentions);
    const replyTo = plainMessage.replyTo
      ? {
          id: Number(plainMessage.replyTo.id) || 0,
          content: plainMessage.replyTo.content || "",
          mediaUrl: plainMessage.replyTo.mediaUrl || null,
          mediaType: plainMessage.replyTo.mediaType || (plainMessage.replyTo.mediaUrl ? this.resolveMediaType("", plainMessage.replyTo.mediaUrl) : "text"),
          createdAt: plainMessage.replyTo.createdAt || null,
          user: plainMessage.replyTo.user
            ? {
                id: Number(plainMessage.replyTo.user.id) || 0,
                name: plainMessage.replyTo.user.name || "",
                image: plainMessage.replyTo.user.image || "",
                position: plainMessage.replyTo.user.position || "",
                role: plainMessage.replyTo.user.role || "user",
              }
            : null,
        }
      : null;
    const pinnedBy = plainMessage.pinnedBy
      ? {
          id: Number(plainMessage.pinnedBy.id) || 0,
          name: plainMessage.pinnedBy.name || "",
          image: plainMessage.pinnedBy.image || "",
          position: plainMessage.pinnedBy.position || "",
          role: plainMessage.pinnedBy.role || "user",
        }
      : null;

    const poll = plainMessage.poll
      ? {
          id: Number(plainMessage.poll.id),
          question: plainMessage.poll.question || plainMessage.content || "",
          isClosed: plainMessage.poll.isClosed === true,
          totalVotes: (plainMessage.poll.options || []).reduce(
            (total, option) => total + (option.votes || []).length,
            0
          ),
          options: (plainMessage.poll.options || [])
            .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
            .map((option) => ({
              id: Number(option.id),
              text: option.text || "",
              votes: (option.votes || []).length,
            })),
        }
      : null;

    return {
      ...plainMessage,
      content: plainMessage.content || "",
      mediaUrl: plainMessage.mediaUrl || null,
      mediaType: plainMessage.mediaType || (plainMessage.mediaUrl ? this.resolveMediaType("", plainMessage.mediaUrl) : "text"),
      mentions,
      replyTo,
      isPinned: plainMessage.isPinned === true,
      pinnedAt: plainMessage.pinnedAt || null,
      pinnedBy,
      poll,
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
      const targetRoom = await this.resolveRoomForUser(userId, payload.room);
      if (!(await this.canUserSendToRoom(userId, targetRoom))) {
        throw new Error("Only admins can publish announcements");
      }
      const mediaUrl = payload.mediaUrl || null;
      const resolvedMediaType = mediaUrl
        ? this.resolveMediaType(payload.mediaType, mediaUrl)
        : "text";
      const mentions = this.normalizeMentions(payload.mentions, messageContent);
      const rawReplyToMessageId = payload.replyToMessageId;
      const replyToMessageId =
        rawReplyToMessageId === undefined ||
        rawReplyToMessageId === null ||
        `${rawReplyToMessageId}`.trim() === ""
          ? null
          : Number(rawReplyToMessageId);

      if (!userId) {
        throw new Error("userId مطلوب لإرسال الرسالة");
      }

      if (!messageContent && !mediaUrl) {
        throw new Error("لا يمكن إرسال رسالة فارغة");
      }

      if (replyToMessageId !== null) {
        if (!Number.isInteger(replyToMessageId) || replyToMessageId <= 0) {
          throw new Error("replyToMessageId is invalid");
        }

        const repliedMessage = await Message.findByPk(replyToMessageId);
        if (!repliedMessage) {
          throw new Error("Reply target message was not found");
        }

        if ((repliedMessage.room || "main_chat") !== targetRoom) {
          throw new Error("Reply target belongs to a different room");
        }
      }

      const message = await Message.create({
        userId,
        content: messageContent,
        room: targetRoom,
        mediaUrl,
        mediaType: resolvedMediaType,
        mentions,
        replyToMessageId,
      });

      await this.trimRoomMessages(targetRoom, MAX_MESSAGES_PER_ROOM);

      const savedMessage = await Message.findByPk(message.id, {
        include: this.getMessageIncludes(),
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
        include: this.getMessageIncludes(),
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

  async searchMentionUsers(query = "", limit = 20, excludeUserId = null, room = "main_chat") {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const trimmedQuery = String(query || "").trim();

    const where = {};
    let governorateId = null;

    if (excludeUserId !== undefined && excludeUserId !== null && `${excludeUserId}`.trim() !== "") {
      const normalizedExcludeId = Number(excludeUserId);
      if (Number.isInteger(normalizedExcludeId) && normalizedExcludeId > 0) {
        const excludedUser = await User.findByPk(normalizedExcludeId, {
          attributes: ["id", "governorateId"],
        });
        governorateId = excludedUser?.governorateId ?? null;
        where.id = {
          [Op.ne]: normalizedExcludeId,
        };
      }
    }

    if (
      governorateId !== null &&
      governorateId !== undefined &&
      this.isScopedRoom(room)
    ) {
      where.governorateId = governorateId;
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
      const shouldScopeMentions = this.isScopedRoom(message.room);
      const senderUser = senderId
        ? await User.findByPk(senderId, { attributes: ["governorateId"] })
        : null;

      const mentionedUsers = await User.findAll({
        where: {
          ...(shouldScopeMentions && senderUser?.governorateId
            ? { governorateId: senderUser.governorateId }
            : {}),
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
  async getMentionedUserIds({ message, sender }) {
    const mentions = this.normalizeMentions(message.mentions, message.content);
    const senderId = Number(sender?.id ?? message?.userId);

    const directMentionIds = mentions
      .map((item) => Number(item.userId))
      .filter((id) => Number.isInteger(id) && id > 0 && id !== senderId);

    const mentionNames = mentions
      .filter((item) => !item.userId && item.name)
      .map((item) => String(item.name).trim())
      .filter(Boolean);

    let resolvedMentionIds = [];
    if (mentionNames.length) {
      const shouldScopeMentions = this.isScopedRoom(message.room);
      const senderUser = senderId
        ? await User.findByPk(senderId, { attributes: ["governorateId"] })
        : null;

      const mentionedUsers = await User.findAll({
        where: {
          ...(shouldScopeMentions && senderUser?.governorateId
            ? { governorateId: senderUser.governorateId }
            : {}),
          name: {
            [Op.in]: mentionNames,
          },
        },
        attributes: ["id"],
      });

      resolvedMentionIds = mentionedUsers
        .map((user) => Number(user.id))
        .filter((id) => Number.isInteger(id) && id > 0 && id !== senderId);
    }

    return [...new Set([...directMentionIds, ...resolvedMentionIds])];
  }

  async getPinnedMessage(room = "main_chat") {
    await this.ensureMessageSchema();

    const pinnedMessage = await Message.findOne({
      where: { room, isPinned: true },
      include: this.getMessageIncludes(),
      order: [["pinnedAt", "DESC"], ["updatedAt", "DESC"]],
    });

    return pinnedMessage ? this.formatMessage(pinnedMessage) : null;
  }

  async notifyRoomUsers({ message, sender }) {
    const senderId = Number(sender?.id ?? message?.userId);
    if (!Number.isInteger(senderId) || senderId <= 0) {
      return;
    }

    const payload = this.formatMessage(message);
    const preview = this.getMessagePreview(payload);
    const mentionedUserIds = await this.getMentionedUserIds({ message: payload, sender });
    const senderName = sender?.name || "User";
    let eligibleUserIds = null;

    if (this.isScopedRoom(payload.room) || this.isAnnouncementRoom(payload.room)) {
      const senderUser = await User.findByPk(senderId, {
        attributes: ["governorateId"],
      });
      eligibleUserIds = senderUser?.governorateId
        ? (
            await User.findAll({
              where: { governorateId: senderUser.governorateId },
              attributes: ["id"],
            })
          )
            .map((user) => Number(user.id))
            .filter((id) => Number.isInteger(id) && id > 0)
        : [];
    }

    if (this.isSupportRoom(payload.room)) {
      const supportUserId = this.getSupportUserId(payload.room);
      if (supportUserId && Number(senderId) !== Number(supportUserId)) {
        eligibleUserIds = [supportUserId];
      } else {
        const supportUser = await User.findByPk(supportUserId, {
          attributes: ["governorateId"],
        });
        eligibleUserIds = supportUser?.governorateId
          ? (
              await User.findAll({
                where: {
                  governorateId: supportUser.governorateId,
                  role: { [Op.in]: ["admin", "super_admin"] },
                },
                attributes: ["id"],
              })
            ).map((user) => Number(user.id))
          : [];
      }
    }

    await sendChatNotificationToAllExcept({
      senderUserId: senderId,
      excludedUserIds: mentionedUserIds,
      eligibleUserIds,
      title: "رسالة جديدة في الدردشة",
      message: `${senderName}: ${preview}`,
    });
  }

  async deleteMessage(messageId) {
    try {
      await this.ensureMessageSchema();

      const message = await Message.findByPk(messageId, {
        include: this.getMessageIncludes(),
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
        include: this.getMessageIncludes(),
      });

      return this.formatMessage(updatedMessage);
    } catch (error) {
      console.error("Error updating message:", error);
      throw error;
    }
  }

  async pinMessage({ messageId, pinnedByUserId }) {
    await this.ensureMessageSchema();

    const message = await Message.findByPk(messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    await Message.update(
      { isPinned: false, pinnedAt: null, pinnedByUserId: null },
      { where: { room: message.room, isPinned: true } }
    );

    message.isPinned = true;
    message.pinnedAt = new Date();
    message.pinnedByUserId = pinnedByUserId || null;
    await message.save();

    const pinnedMessage = await Message.findByPk(message.id, {
      include: this.getMessageIncludes(),
    });

    return this.formatMessage(pinnedMessage);
  }

  async unpinMessage({ room = "main_chat" }) {
    await this.ensureMessageSchema();

    const pinnedMessage = await Message.findOne({
      where: { room, isPinned: true },
      include: this.getMessageIncludes(),
    });

    if (!pinnedMessage) {
      return null;
    }

    pinnedMessage.isPinned = false;
    pinnedMessage.pinnedAt = null;
    pinnedMessage.pinnedByUserId = null;
    await pinnedMessage.save();

    return this.formatMessage(pinnedMessage);
  }
}

module.exports = new ChatService();
