const cron = require("node-cron");
const { Op } = require("sequelize");
const { Game, GameSlot } = require("../models");
const { sendNotificationToUser } = require("./notifications");

function formatHourArabic(date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const isPM = hours >= 12;
  const hour12 = hours % 12 || 12;
  const period = isPM ? "م" : "ص";
  const paddedMinutes = String(minutes).padStart(2, "0");
  return `${hour12}:${paddedMinutes} ${period}`;
}

async function sendGameReminders() {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 11 * 60 * 60 * 1000 + 55 * 60 * 1000);
  const windowEnd   = new Date(now.getTime() + 12 * 60 * 60 * 1000);

  const games = await Game.findAll({
    where: {
      startsAt: {
        [Op.between]: [windowStart, windowEnd],
      },
      status: "open",
    },
    include: [
      {
        model: GameSlot,
        as: "slots",
        where: { userId: { [Op.not]: null } },
        required: false,
      },
    ],
  });

  for (const game of games) {
    const bookedSlots = game.slots || [];
    if (!bookedSlots.length) continue;

    const timeStr   = formatHourArabic(new Date(game.startsAt));
    const title     = "تذكير بمباراة 🔔";
    const message   = `اليوم مباراتكم على "${game.stadiumName}" بتوقيت الساعة ${timeStr}`;

    const userIds = [...new Set(bookedSlots.map((slot) => slot.userId))];

    await Promise.allSettled(
      userIds.map((userId) => sendNotificationToUser(userId, message, title))
    );

    console.log(`✅ تم إرسال تذكير مباراة ${game.id} لـ ${userIds.length} لاعب`);
  }
}

function startGameReminderJob() {
  cron.schedule("*/5 * * * *", () => {
    sendGameReminders().catch((err) =>
      console.error("❌ خطأ في إرسال تذكير المباريات:", err)
    );
  });
}

module.exports = { startGameReminderJob, sendGameReminders };
