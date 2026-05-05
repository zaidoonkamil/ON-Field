const express = require("express");
const sequelize = require("./config/db");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const usersRouter = require("./routes/user");
const postRouter = require("./routes/Post");
const { startCleanupJob } = require("./services/cleanupPosts.js");
const { startGameReminderJob } = require("./services/gameReminders.js");
const liveRouter = require("./routes/live");
const gamesRouter = require("./routes/games");
const resultsRouter = require("./routes/results.js");
const notificationsRouter = require("./routes/notifications.js");
const statsRouter = require("./routes/stats.js");
const monthlySquadsRouter = require("./routes/monthly_squads.js");
const chatRouter = require("./routes/chat.js");
const whatsappRouter = require("./routes/whatsapp.js");
const superAdminRouter = require("./routes/super_admin.js");
const chatService = require("./services/chatService.js");
const { ensureUserDeviceSchema } = require("./services/notifications.js");
const { ensureCoreSchema } = require("./services/coreSchema.js");
const { setupSocketHandlers } = require("./services/socketService.js");
const { startWhatsAppAutoInit } = require("./services/waSender.js");
const { startPostVideoMigration } = require("./services/migratePostVideos.js");
const playerOfMonthRoutes = require("./routes/playerOfMonth");

const app = express();
const server = http.createServer(app);
const uploadRequestTimeoutMs =
  Number.parseInt(process.env.UPLOAD_REQUEST_TIMEOUT_MS || "", 10) ||
  30 * 60 * 1000;
const uploadHeadersTimeoutMs =
  Number.parseInt(process.env.UPLOAD_HEADERS_TIMEOUT_MS || "", 10) ||
  31 * 60 * 1000;
const uploadKeepAliveTimeoutMs =
  Number.parseInt(process.env.UPLOAD_KEEP_ALIVE_TIMEOUT_MS || "", 10) ||
  75 * 1000;
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.set("io", io);

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use("/uploads", express.static("./uploads"));
app.use(express.static("./public")); 

app.use("/", usersRouter);
app.use("/", postRouter);
app.use("/", liveRouter);
app.use("/", gamesRouter);
app.use("/", resultsRouter);
app.use("/", notificationsRouter);
app.use("/", statsRouter);
app.use("/", monthlySquadsRouter);
app.use("/", chatRouter);
app.use("/", whatsappRouter);
app.use("/", superAdminRouter);
app.use("/", playerOfMonthRoutes);

server.requestTimeout = uploadRequestTimeoutMs;
server.headersTimeout = Math.max(
  uploadHeadersTimeoutMs,
  uploadRequestTimeoutMs + 1000
);
server.keepAliveTimeout = uploadKeepAliveTimeoutMs;

setupSocketHandlers(io);

sequelize.sync({ force: false })
  .then(async () => {
    console.log("✅ Database & tables synced!");
    await ensureCoreSchema();
    await ensureUserDeviceSchema();
    await chatService.enforceMessageLimitForAllRooms();
    startCleanupJob();
    startGameReminderJob();
    startWhatsAppAutoInit();
    startPostVideoMigration();
  }).catch((err) => console.error("❌ Error syncing database:", err));


server.listen(1001, () => {
  console.log("🚀 Server running on http://localhost:1001");
  console.log("💬 Chat room activated - Port 1001");
});
