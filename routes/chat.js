const express = require("express");
const router = express.Router();
const chatService = require("../services/chatService");
const upload = require("../middlewares/uploads");
const { connectedUsers } = require("../services/socketService");

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
      try {
        await chatService.notifyRoomUsers({
          message,
          sender: message.user,
        });

        await chatService.notifyMentionedUsers({
          message,
          sender: message.user,
          io,
          connectedUsersMap: connectedUsers,
        });
      } catch (notificationError) {
        console.error("Error sending chat notifications:", notificationError);
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
    const messages = await chatService.getAllMessages(room, parseInt(limit, 10));

    return res.status(200).json({
      success: true,
      messages,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "خطأ في جلب الرسائل",
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
