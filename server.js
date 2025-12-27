const express = require("express");
const sequelize = require("./config/db");

const usersRouter = require("./routes/user");
const postRouter = require("./routes/Post");
const { startCleanupJob } = require("./services/cleanupPosts.js");
const liveRouter = require("./routes/live");
const gamesRouter = require("./routes/games");
const resultsRouter = require("./routes/results.js");
const notificationsRouter = require("./routes/notifications.js");

const app = express();

app.use(express.json());
app.use("/uploads", express.static("./uploads"));

app.use("/", usersRouter);
app.use("/", postRouter);
app.use("/", liveRouter);
app.use("/", gamesRouter);
app.use("/", resultsRouter);
app.use("/", notificationsRouter);


sequelize.sync({ alter: true })
  .then(() => {
    console.log("✅ Database & tables synced!");
    startCleanupJob();
  }).catch((err) => console.error("❌ Error syncing database:", err));


app.listen(1001, () => {
  console.log("🚀 Server running on http://localhost:1001");
});
