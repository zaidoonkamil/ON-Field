const express = require("express");
const router = express.Router();
const chatService = require("../services/chatService");

// الحصول على جميع الرسائل
router.get("/api/chat/messages", async (req, res) => {
  try {
    const room = req.query.room || "main_chat";
    const limit = req.query.limit || 50;
    const messages = await chatService.getAllMessages(room, parseInt(limit));
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
    await chatService.deleteMessage(messageId);
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
    const { content } = req.body;
    const message = await chatService.updateMessage(messageId, content);
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
