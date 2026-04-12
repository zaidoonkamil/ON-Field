const express = require("express");
const router = express.Router();
const chatService = require("../services/chatService");
const upload = require("../middlewares/uploads");
const { connectedUsers } = require("../services/socketService");
const { User } = require("../models");

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
      io.to(room).emit("receive_message", message);
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
    const { q = "", limit = 20, excludeUserId } = req.query;
    const users = await chatService.searchMentionUsers(q, limit, excludeUserId);

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
    const room = req.query.room || "main_chat";
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
    const room = req.body.room || req.query.room || "main_chat";
    const userId = req.body.userId || req.query.userId;

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
