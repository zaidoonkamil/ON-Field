const express = require("express");
const router = express.Router();
const chatService = require("../services/chatService");
const upload = require("../middlewares/uploads");
const { connectedUsers } = require("../services/socketService");
const { Op } = require("sequelize");
const { User, Message, ChatPoll, ChatPollOption, ChatPollVote } = require("../models");
const sequelize = require("../config/db");
const { authenticateToken } = require("../middlewares/auth");

async function ensureAdminPermission(userId) {
  const user = await User.findByPk(Number(userId), {
    attributes: ["id", "role"],
  });

  if (!user) {
    throw { status: 404, message: "User not found" };
  }

  if (!["admin", "super_admin"].includes(user.role)) {
    throw { status: 403, message: "Only admins can pin messages" };
  }

  return user;
}

async function resolveAuthenticatedChatUser(req, userId, requestedRoom) {
  const numericUserId = Number(userId);
  if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
    throw { status: 400, message: "Invalid userId" };
  }
  if (Number(req.user?.id) !== numericUserId) {
    throw { status: 403, message: "Not allowed" };
  }

  const user = await User.findByPk(numericUserId, {
    attributes: ["id", "chatLastReadAt"],
  });
  if (!user) throw { status: 404, message: "User not found" };

  const room = await chatService.resolveRoomForUser(
    numericUserId,
    requestedRoom || chatService.getDefaultRoom()
  );
  return { user, room };
}

router.get("/api/chat/unread-count", authenticateToken, async (req, res) => {
  try {
    const { user, room } = await resolveAuthenticatedChatUser(
      req,
      req.query.userId,
      req.query.room
    );
    const unreadCount = await Message.count({
      where: {
        room,
        userId: { [Op.ne]: user.id },
        createdAt: { [Op.gt]: user.chatLastReadAt || new Date() },
      },
    });

    return res.json({ success: true, unreadCount });
  } catch (error) {
    return res.status(error?.status || 500).json({
      success: false,
      message: error?.message || "Unable to load unread count",
    });
  }
});

router.post("/api/chat/read", authenticateToken, async (req, res) => {
  try {
    const { user, room } = await resolveAuthenticatedChatUser(
      req,
      req.body?.userId || req.user?.id,
      req.body?.room
    );
    await user.update({ chatLastReadAt: new Date() });

    return res.json({ success: true, room });
  } catch (error) {
    return res.status(error?.status || 500).json({
      success: false,
      message: error?.message || "Unable to mark chat as read",
    });
  }
});

router.post("/api/chat/polls", authenticateToken, async (req, res) => {
  try {
    const admin = await ensureAdminPermission(req.user.id);
    const question = String(req.body?.question || "").trim();
    const options = Array.isArray(req.body?.options)
      ? req.body.options.map((option) => String(option || "").trim()).filter(Boolean)
      : [];
    if (!question || options.length < 2 || options.length > 6) {
      return res.status(400).json({ success: false, message: "Poll needs a question and 2 to 6 options" });
    }

    const room = await chatService.resolveRoomForUser(
      admin.id,
      req.body?.room || chatService.getDefaultRoom()
    );
    const message = await sequelize.transaction(async (transaction) => {
      const createdMessage = await Message.create({
        userId: admin.id,
        content: question,
        room,
        mediaType: "poll",
      }, { transaction });
      const poll = await ChatPoll.create({
        messageId: createdMessage.id,
        question,
        createdByUserId: admin.id,
      }, { transaction });
      await ChatPollOption.bulkCreate(
        options.map((text, index) => ({ pollId: poll.id, text, sortOrder: index })),
        { transaction }
      );
      return createdMessage;
    });

    const fullMessage = await Message.findByPk(message.id, { include: chatService.getMessageIncludes() });
    const payload = chatService.formatMessage(fullMessage);
    req.app.get("io")?.to(room).emit("receive_message", payload);
    return res.status(201).json({ success: true, data: payload });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error.message || "Unable to create poll" });
  }
});

router.post("/api/chat/polls/:pollId/vote", authenticateToken, async (req, res) => {
  try {
    const pollId = Number(req.params.pollId);
    const optionId = Number(req.body?.optionId);
    if (!Number.isInteger(pollId) || !Number.isInteger(optionId)) {
      return res.status(400).json({ success: false, message: "Invalid poll vote" });
    }
    const poll = await ChatPoll.findByPk(pollId, { include: [{ model: Message, as: "message" }] });
    if (!poll || !poll.message) return res.status(404).json({ success: false, message: "Poll not found" });
    if (poll.isClosed) return res.status(403).json({ success: false, message: "This poll is closed" });
    const room = await chatService.resolveRoomForUser(req.user.id, poll.message.room);
    if (room !== poll.message.room) return res.status(403).json({ success: false, message: "Not allowed" });
    const option = await ChatPollOption.findOne({ where: { id: optionId, pollId } });
    if (!option) return res.status(404).json({ success: false, message: "Poll option not found" });

    await ChatPollVote.upsert({ pollId, optionId, userId: req.user.id });
    const fullMessage = await Message.findByPk(poll.messageId, { include: chatService.getMessageIncludes() });
    const payload = chatService.formatMessage(fullMessage);
    req.app.get("io")?.to(room).emit("poll_updated", { messageId: poll.messageId, poll: payload.poll });
    return res.json({ success: true, data: { poll: payload.poll } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to save vote" });
  }
});

router.post("/api/chat/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "يرجى اختيار ملف صالح",
      });
    }

    const mediaUrl = `/uploads/${req.file.filename}`;

    return res.status(201).json({
      success: true,
      message: "تم رفع الملف بنجاح",
      data: {
        mediaUrl,
        mediaType: chatService.resolveMediaType(req.file.mimetype, mediaUrl),
        mimeType: req.file.mimetype,
        originalName: req.file.originalname,
        size: req.file.size,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "خطأ في رفع ملف الدردشة",
      error: error.message,
    });
  }
});

router.post("/api/chat/messages", upload.single("file"), async (req, res) => {
  try {
    const {
      userId,
      content = "",
      room = "main_chat",
      mentions,
      mediaUrl: bodyMediaUrl,
      mediaType,
      replyToMessageId,
    } = req.body;

    const uploadedMediaUrl = req.file ? `/uploads/${req.file.filename}` : (bodyMediaUrl || null);

    const message = await chatService.saveMessage({
      userId,
      content,
      room,
      mediaUrl: uploadedMediaUrl,
      mediaType: mediaType || req.file?.mimetype,
      mentions,
      replyToMessageId,
    });

    const io = req.app.get("io");
    if (io) {
      io.to(message.room || chatService.getDefaultRoom()).emit("receive_message", message);
    }

    res.status(201).json({
      success: true,
      message: "تم إرسال الرسالة بنجاح",
      data: message,
    });

    setImmediate(async () => {
      const [roomNotificationResult, mentionNotificationResult] =
        await Promise.allSettled([
          chatService.notifyRoomUsers({
            message,
            sender: message.user,
          }),
          chatService.notifyMentionedUsers({
            message,
            sender: message.user,
            io,
            connectedUsersMap: connectedUsers,
          }),
        ]);

      if (roomNotificationResult.status === "rejected") {
        console.error(
          "Error sending room chat notifications:",
          roomNotificationResult.reason
        );
      }

      if (mentionNotificationResult.status === "rejected") {
        console.error(
          "Error sending mention notifications:",
          mentionNotificationResult.reason
        );
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "خطأ في إرسال الرسالة",
      error: error.message,
    });
  }
});

router.get("/api/chat/mentions", async (req, res) => {
  try {
    const { q = "", limit = 20, excludeUserId, room = "main_chat" } = req.query;
    const users = await chatService.searchMentionUsers(
      q,
      limit,
      excludeUserId,
      room
    );

    return res.status(200).json({
      success: true,
      users,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "خطأ في جلب اقتراحات المنشن",
      error: error.message,
    });
  }
});

router.get("/api/chat/messages", async (req, res) => {
  try {
    const requestedRoom = req.query.room || chatService.getDefaultRoom();
    const room =
      req.query.userId && chatService.isScopedRoom(requestedRoom)
        ? await chatService.resolveRoomForUser(req.query.userId, requestedRoom)
        : requestedRoom;
    const limit = req.query.limit || 50;
    const [messages, pinnedMessage] = await Promise.all([
      chatService.getAllMessages(room, parseInt(limit, 10)),
      chatService.getPinnedMessage(room),
    ]);

    return res.status(200).json({
      success: true,
      messages,
      pinnedMessage,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "خطأ في جلب الرسائل",
      error: error.message,
    });
  }
});

router.patch("/api/chat/messages/:messageId/pin", async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId } = req.body;

    await ensureAdminPermission(userId);
    const pinnedMessage = await chatService.pinMessage({
      messageId: Number(messageId),
      pinnedByUserId: Number(userId),
    });

    const io = req.app.get("io");
    if (io) {
      io.to(pinnedMessage.room || "main_chat").emit(
        "pinned_message_updated",
        pinnedMessage
      );
    }

    return res.status(200).json({
      success: true,
      message: "Message pinned successfully",
      data: pinnedMessage,
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error while pinning message",
      error: error.message,
    });
  }
});

router.delete("/api/chat/pin", async (req, res) => {
  try {
    const userId = req.body.userId || req.query.userId;
    const requestedRoom =
      req.body.room || req.query.room || chatService.getDefaultRoom();
    const room =
      userId && chatService.isScopedRoom(requestedRoom)
        ? await chatService.resolveRoomForUser(userId, requestedRoom)
        : requestedRoom;

    await ensureAdminPermission(userId);
    const unpinnedMessage = await chatService.unpinMessage({ room });

    const io = req.app.get("io");
    if (io) {
      io.to(room).emit("pinned_message_updated", null);
    }

    return res.status(200).json({
      success: true,
      message: "Pinned message cleared successfully",
      data: unpinnedMessage,
    });
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Error while clearing pinned message",
      error: error.message,
    });
  }
});

router.delete("/api/chat/messages/:messageId", async (req, res) => {
  try {
    const { messageId } = req.params;
    const deletedMessage = await chatService.deleteMessage(messageId);

    if (!deletedMessage) {
      return res.status(404).json({
        success: false,
        message: "الرسالة غير موجودة",
      });
    }

    const io = req.app.get("io");
    if (io) {
      io.to(deletedMessage.room || "main_chat").emit("message_deleted", {
        messageId: Number(messageId),
      });
      if (deletedMessage.isPinned) {
        io.to(deletedMessage.room || "main_chat").emit("pinned_message_updated", null);
      }
    }

    return res.status(200).json({
      success: true,
      message: "تم حذف الرسالة بنجاح",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "خطأ في حذف الرسالة",
      error: error.message,
    });
  }
});

router.put("/api/chat/messages/:messageId", async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content, mentions } = req.body;
    const message = await chatService.updateMessage(messageId, content, mentions);

    const io = req.app.get("io");
    if (io) {
      io.to(message.room || "main_chat").emit("message_updated", message);
    }

    return res.status(200).json({
      success: true,
      message: "تم تحديث الرسالة بنجاح",
      data: message,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "خطأ في تحديث الرسالة",
      error: error.message,
    });
  }
});

module.exports = router;
