const chatService = require("./chatService");

// تخزين المستخدمين المتصلين
const connectedUsers = {};

/**
 * إعداد معالجات أحداث Socket.io
 * @param {Object} io - كائن Socket.io
 */
const setupSocketHandlers = (io) => {
  io.on("connection", (socket) => {
    console.log("🔗 مستخدم جديد متصل:", socket.id);

    // ======================== الاتصال والانضمام ========================
    socket.on("user_connected", async (userData) => {
      try {
        const { userId, name, image, position, role } = userData;

        // تخزين بيانات المستخدم
        connectedUsers[socket.id] = {
          socketId: socket.id,
          userId,
          name,
          image,
          position,
          role,
          connectedAt: new Date(),
        };

        // الانضمام إلى الغرفة
        socket.join("main_chat");

        // إرسال قائمة المستخدمين المتصلين للجميع
        const usersList = Object.values(connectedUsers);
        io.to("main_chat").emit("users_list", usersList);
        io.to("main_chat").emit("user_joined", {
          message: `${name} انضم إلى الغرفة`,
          userId,
          name,
          image,
          position,
        });

        console.log("👥 عدد المستخدمين المتصلين:", Object.keys(connectedUsers).length);
      } catch (error) {
        console.error("خطأ في الاتصال:", error);
      }
    });

    // ======================== إرسال الرسائل ========================
    socket.on("send_message", async (data) => {
      try {
        const { userId, content, room = "main_chat" } = data;

        // حفظ الرسالة في قاعدة البيانات
        const message = await chatService.saveMessage(userId, content, room);

        // الحصول على بيانات المستخدم المرسل
        const userData = await chatService.getUserData(userId);

        // توزيع الرسالة على جميع المستخدمين في الغرفة
        const messageToSend = {
          id: message.id,
          content: message.content,
          user: {
            id: userData.id,
            name: userData.name,
            image: userData.image,
            position: userData.position,
            role: userData.role,
          },
          createdAt: message.createdAt,
        };

        io.to(room).emit("receive_message", messageToSend);
        console.log("💬 رسالة جديدة من", userData.name, ":", content);
      } catch (error) {
        console.error("خطأ في إرسال الرسالة:", error);
        socket.emit("error", { message: "خطأ في إرسال الرسالة" });
      }
    });

    // ======================== حذف الرسائل ========================
    socket.on("delete_message", async (data) => {
      try {
        const { messageId } = data;
        await chatService.deleteMessage(messageId);
        io.to("main_chat").emit("message_deleted", { messageId });
        console.log("🗑️ تم حذف الرسالة:", messageId);
      } catch (error) {
        console.error("خطأ في حذف الرسالة:", error);
      }
    });

    // ======================== تحديث الرسائل ========================
    socket.on("update_message", async (data) => {
      try {
        const { messageId, content } = data;
        const message = await chatService.updateMessage(messageId, content);

        const messageToSend = {
          id: message.id,
          content: message.content,
          user: {
            id: message.user.id,
            name: message.user.name,
            image: message.user.image,
            position: message.user.position,
            role: message.user.role,
          },
          createdAt: message.createdAt,
        };

        io.to("main_chat").emit("message_updated", messageToSend);
        console.log("✏️ تم تحديث الرسالة:", messageId);
      } catch (error) {
        console.error("خطأ في تحديث الرسالة:", error);
      }
    });

    // ======================== مؤشرات الكتابة ========================
    socket.on("user_typing", (data) => {
      const { userId, name } = data;
      socket.broadcast.to("main_chat").emit("user_typing", { userId, name });
    });

    socket.on("user_stop_typing", (data) => {
      const { userId } = data;
      socket.broadcast.to("main_chat").emit("user_stop_typing", { userId });
    });

    // ======================== قطع الاتصال ========================
    socket.on("disconnect", () => {
      const userData = connectedUsers[socket.id];
      if (userData) {
        delete connectedUsers[socket.id];
        io.to("main_chat").emit("user_left", {
          message: `${userData.name} غادر الغرفة`,
          userId: userData.userId,
          name: userData.name,
        });
        io.to("main_chat").emit("users_list", Object.values(connectedUsers));
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
