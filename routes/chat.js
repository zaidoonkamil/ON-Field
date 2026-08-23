const express = require("express");
const router = express.Router();
const chatService = require("../services/chatService");
const upload = require("../middlewares/uploads");
const { connectedUsers } = require("../services/socketService");
const { Op } = require("sequelize");
const { User, Message } = require("../models");
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
        createdAt: { [Op.gt]: user.chatLastReadAt },
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
