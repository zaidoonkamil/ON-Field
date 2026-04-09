const chatService = require("./chatService");
const { User } = require("../models");

// تخزين المستخدمين المتصلين
const connectedUsers = {};

const getUsersListByRoom = (room = "main_chat") => {
  return Object.values(connectedUsers).filter((user) => (user.room || "main_chat") === room);
};

const ensureAdminPermission = async (userId) => {
  const user = await User.findByPk(Number(userId), {
    attributes: ["id", "role"],
  });

  if (!user) {
    throw new Error("User not found");
  }

  if (!["admin", "super_admin"].includes(user.role)) {
    throw new Error("Only admins can pin messages");
  }

  return user;
};

/**
 * إعداد معالجات أحداث Socket.io
 * @param {Object} io - كائن Socket.io
 */
const setupSocketHandlers = (io) => {
  io.on("connection", (socket) => {
    console.log("🔗 مستخدم جديد متصل:", socket.id);

    socket.on("join_room", (data = {}) => {
      const room = data.room || "main_chat";
      socket.join(room);
    });

    // ======================== الاتصال والانضمام ========================
    socket.on("user_connected", async (userData = {}) => {
      try {
        const { userId, name, image, position, role, room = "main_chat" } = userData;

        // تخزين بيانات المستخدم
        connectedUsers[socket.id] = {
          socketId: socket.id,
          userId,
          name,
          image,
          position,
          role,
          room,
          connectedAt: new Date(),
        };

        // الانضمام إلى الغرفة
        socket.join(room);

        // إرسال قائمة المستخدمين المتصلين للجميع
        const usersList = getUsersListByRoom(room);
        io.to(room).emit("users_list", usersList);
        io.to(room).emit("user_joined", {
          message: `${name} انضم إلى الغرفة`,
          userId,
          name,
          image,
          position,
          room,
        });

        console.log("👥 عدد المستخدمين المتصلين:", Object.keys(connectedUsers).length);
      } catch (error) {
        console.error("خطأ في الاتصال:", error);
      }
    });

    // ======================== إرسال الرسائل ========================
    socket.on("send_message", async (data = {}) => {
      try {
        const {
          userId,
          content = "",
          room = "main_chat",
          mediaUrl = null,
          mediaType = null,
          mentions = [],
          replyToMessageId = null,
        } = data;

        socket.join(room);

        const savedMessage = await chatService.saveMessage({
          userId,
          content,
          room,
          mediaUrl,
          mediaType,
          mentions,
          replyToMessageId,
        });

        io.to(room).emit("receive_message", savedMessage);

        await chatService.notifyRoomUsers({
          message: savedMessage,
          sender: savedMessage.user,
        });

        await chatService.notifyMentionedUsers({
          message: savedMessage,
          sender: savedMessage.user,
          io,
          connectedUsersMap: connectedUsers,
        });

        console.log("💬 رسالة جديدة من", savedMessage.user?.name || userId, ":", savedMessage.content || savedMessage.mediaType);
      } catch (error) {
        console.error("خطأ في إرسال الرسالة:", error);
        socket.emit("error", { message: error.message || "خطأ في إرسال الرسالة" });
      }
    });

    // ======================== حذف الرسائل ========================
    socket.on("delete_message", async (data = {}) => {
      try {
        const { messageId, room = "main_chat" } = data;
        const deletedMessage = await chatService.deleteMessage(messageId);

        if (deletedMessage) {
          io.to(deletedMessage.room || room).emit("message_deleted", { messageId });
          console.log("🗑️ تم حذف الرسالة:", messageId);
        }
      } catch (error) {
        console.error("خطأ في حذف الرسالة:", error);
      }
    });

    // ======================== تحديث الرسائل ========================
    socket.on("update_message", async (data = {}) => {
      try {
        const { messageId, content, mentions } = data;
        const message = await chatService.updateMessage(messageId, content, mentions);

        io.to(message.room || "main_chat").emit("message_updated", message);
        console.log("✏️ تم تحديث الرسالة:", messageId);
      } catch (error) {
        console.error("خطأ في تحديث الرسالة:", error);
      }
    });

    socket.on("pin_message", async (data = {}) => {
      try {
        const { messageId, userId } = data;
        await ensureAdminPermission(userId);
        const pinnedMessage = await chatService.pinMessage({
          messageId: Number(messageId),
          pinnedByUserId: Number(userId),
        });

        io.to(pinnedMessage.room || "main_chat").emit(
          "pinned_message_updated",
          pinnedMessage
        );
      } catch (error) {
        console.error("Ø®Ø·Ø£ ÙÙŠ ØªØ«Ø¨ÙŠØª Ø§Ù„Ø±Ø³Ø§Ù„Ø©:", error);
        socket.emit("error", {
          message: error.message || "Ø®Ø·Ø£ ÙÙŠ ØªØ«Ø¨ÙŠØª Ø§Ù„Ø±Ø³Ø§Ù„Ø©",
        });
      }
    });

    socket.on("unpin_message", async (data = {}) => {
      try {
        const { userId, room = "main_chat" } = data;
        await ensureAdminPermission(userId);
        await chatService.unpinMessage({ room });

        io.to(room).emit("pinned_message_updated", null);
      } catch (error) {
        console.error("Ø®Ø·Ø£ ÙÙŠ Ø¥Ù„ØºØ§Ø¡ ØªØ«Ø¨ÙŠØª Ø§Ù„Ø±Ø³Ø§Ù„Ø©:", error);
        socket.emit("error", {
          message: error.message || "Ø®Ø·Ø£ ÙÙŠ Ø¥Ù„ØºØ§Ø¡ ØªØ«Ø¨ÙŠØª Ø§Ù„Ø±Ø³Ø§Ù„Ø©",
        });
      }
    });

    // ======================== مؤشرات الكتابة ========================
    socket.on("user_typing", (data = {}) => {
      const { userId, name, room = "main_chat" } = data;
      socket.broadcast.to(room).emit("user_typing", { userId, name, room });
    });

    socket.on("user_stop_typing", (data = {}) => {
      const { userId, room = "main_chat" } = data;
      socket.broadcast.to(room).emit("user_stop_typing", { userId, room });
    });

    // ======================== قطع الاتصال ========================
    socket.on("disconnect", () => {
      const userData = connectedUsers[socket.id];
      if (userData) {
        const room = userData.room || "main_chat";
        delete connectedUsers[socket.id];
        io.to(room).emit("user_left", {
          message: `${userData.name} غادر الغرفة`,
          userId: userData.userId,
          name: userData.name,
          room,
        });
        io.to(room).emit("users_list", getUsersListByRoom(room));
        console.log("❌ المستخدم انقطع:", userData.name);
      }
    });

    // ======================== معالجة الأخطاء ========================
    socket.on("error", (error) => {
      console.error("خطأ في Socket:", error);
    });
  });
};

module.exports = { setupSocketHandlers, connectedUsers };
