const express = require("express");
const sequelize = require("./config/db");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const usersRouter = require("./routes/user");
const postRouter = require("./routes/Post");
const { startCleanupJob } = require("./services/cleanupPosts.js");
const liveRouter = require("./routes/live");
const gamesRouter = require("./routes/games");
const resultsRouter = require("./routes/results.js");
const notificationsRouter = require("./routes/notifications.js");
const statsRouter = require("./routes/stats.js");
const monthlySquadsRouter = require("./routes/monthly_squads.js");
const chatRouter = require("./routes/chat.js");
const { setupSocketHandlers } = require("./services/socketService.js");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

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

setupSocketHandlers(io);

sequelize.sync({ force: false })
  .then(() => {
    console.log("✅ Database & tables synced!");
    startCleanupJob();
  }).catch((err) => console.error("❌ Error syncing database:", err));


server.listen(1001, () => {
  console.log("🚀 Server running on http://localhost:1001");
  console.log("💬 Chat room activated - Port 1001");
});
