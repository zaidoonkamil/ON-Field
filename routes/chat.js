const express = require("express");
const router = express.Router();
const chatService = require("../services/chatService");
const upload = require("../middlewares/uploads");
const { connectedUsers } = require("../services/socketService");

// رفع ملف دردشة (صورة / فيديو / صوت)
router.post("/api/chat/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "يرجى اختيار ملف صالح",
      });
    }

    const mediaUrl = `/uploads/${req.file.filename}`;

    res.status(201).json({
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
    res.status(500).json({
      success: false,
      message: "خطأ في رفع ملف الدردشة",
      error: error.message,
    });
  }
});

// إرسال رسالة عبر REST مع دعم النص والوسائط والمنشن
router.post("/api/chat/messages", upload.single("file"), async (req, res) => {
  try {
    const { userId, content = "", room = "main_chat", mentions, mediaUrl: bodyMediaUrl, mediaType } = req.body;
    const uploadedMediaUrl = req.file ? `/uploads/${req.file.filename}` : (bodyMediaUrl || null);

    const message = await chatService.saveMessage({
      userId,
      content,
      room,
      mediaUrl: uploadedMediaUrl,
      mediaType: mediaType || req.file?.mimetype,
      mentions,
    });

    const io = req.app.get("io");
    if (io) {
      io.to(room).emit("receive_message", message);
    }

    await chatService.notifyMentionedUsers({
      message,
      sender: message.user,
      io,
      connectedUsersMap: connectedUsers,
    });

    res.status(201).json({
      success: true,
      message: "تم إرسال الرسالة بنجاح",
      data: message,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "خطأ في إرسال الرسالة",
      error: error.message,
    });
  }
});

// الحصول على جميع الرسائل
router.get("/api/chat/messages", async (req, res) => {
  try {
    const room = req.query.room || "main_chat";
    const limit = req.query.limit || 50;
    const messages = await chatService.getAllMessages(room, parseInt(limit, 10));
    res.status(200).json({
      success: true,
      messages,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "خطأ في جلب الرسائل",
      error: error.message,
    });
  }
});

// حذف رسالة (للمسؤولين فقط)
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
      io.to(deletedMessage.room || "main_chat").emit("message_deleted", { messageId: Number(messageId) });
    }

    res.status(200).json({
      success: true,
      message: "تم حذف الرسالة بنجاح",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "خطأ في حذف الرسالة",
      error: error.message,
    });
  }
});

// تحديث رسالة
router.put("/api/chat/messages/:messageId", async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content, mentions } = req.body;
    const message = await chatService.updateMessage(messageId, content, mentions);

    const io = req.app.get("io");
    if (io) {
      io.to(message.room || "main_chat").emit("message_updated", message);
    }

    res.status(200).json({
      success: true,
      message: "تم تحديث الرسالة بنجاح",
      data: message,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "خطأ في تحديث الرسالة",
      error: error.message,
    });
  }
});

module.exports = router;
