const { Message, User } = require("../models");

class ChatService {
  // حفظ الرسالة في قاعدة البيانات
  async saveMessage(userId, content, room = "main_chat") {
    try {
      const message = await Message.create({
        userId,
        content,
        room,
      });
      return message;
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
      const messages = await Message.findAll({
        where: { room },
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "name", "image", "position", "role"],
          },
        ],
        order: [["createdAt", "ASC"]],
        limit,
      });
      return messages;
    } catch (error) {
      console.error("Error fetching messages:", error);
      throw error;
    }
  }

  // حذف رسالة
  async deleteMessage(messageId) {
    try {
      await Message.destroy({
        where: { id: messageId },
      });
      return true;
    } catch (error) {
      console.error("Error deleting message:", error);
      throw error;
    }
  }

  // تحديث رسالة
  async updateMessage(messageId, content) {
    try {
      await Message.update(
        { content },
        { where: { id: messageId } }
      );
      const message = await Message.findByPk(messageId, {
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "name", "image", "position", "role"],
          },
        ],
      });
      return message;
    } catch (error) {
      console.error("Error updating message:", error);
      throw error;
    }
  }
}

module.exports = new ChatService();
