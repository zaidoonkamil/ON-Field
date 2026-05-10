const cron = require("node-cron");
const sequelize = require("../config/db");
const { GameSlot } = require("../models");
const { sendNotificationToUser } = require("./notifications");

function parseMysqlDateTime(rawValue) {
  const text = String(rawValue || "").trim();
  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );

  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || "0"),
  };
}

function formatHourArabic(rawValue) {
  const parsed = parseMysqlDateTime(rawValue);
  if (!parsed) {
    return String(rawValue || "");
  }

  const hours = parsed.hour;
  const minutes = parsed.minute;
  const isPM = hours >= 12;
  const hour12 = hours % 12 || 12;
  const period = isPM ? "م" : "ص";
  const paddedMinutes = String(minutes).padStart(2, "0");
  return `${hour12}:${paddedMinutes} ${period}`;
}

async function sendGameReminders() {
  const [games] = await sequelize.query(`
    SELECT id, stadiumName, DATE_FORMAT(startsAt, '%Y-%m-%d %H:%i:%s') AS startsAt
    FROM Games
    WHERE status = 'open'
      AND startsAt BETWEEN
        DATE_ADD(DATE_ADD(NOW(), INTERVAL 11 HOUR), INTERVAL 55 MINUTE)
        AND DATE_ADD(NOW(), INTERVAL 12 HOUR)
  `);

  for (const game of games) {
    const bookedSlots = await GameSlot.findAll({
      where: { gameId: game.id },
      attributes: ["userId"],
      raw: true,
    });

    const userIds = [
      ...new Set(
        bookedSlots
          .map((slot) => slot.userId)
          .filter((userId) => userId !== null && userId !== undefined)
      ),
    ];

    if (!userIds.length) continue;

    const timeStr = formatHourArabic(game.startsAt);
    const title = "تذكير بمباراة 🔔";
    const message = `اليوم مباراتكم على "${game.stadiumName}" بتوقيت الساعة ${timeStr}`;

    await Promise.allSettled(
      userIds.map((userId) => sendNotificationToUser(userId, message, title))
    );

    console.log(`✅ تم إرسال تذكير مباراة ${game.id} لـ ${userIds.length} لاعب`);
  }
}

function startGameReminderJob() {
  cron.schedule(
    "*/5 * * * *",
    () => {
      sendGameReminders().catch((err) =>
        console.error("❌ خطأ في إرسال تذكير المباريات:", err)
      );
    },
    {
      timezone: "Asia/Baghdad",
    }
  );
}

module.exports = { startGameReminderJob, sendGameReminders };
