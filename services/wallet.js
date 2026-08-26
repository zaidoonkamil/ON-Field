const sequelize = require("../config/db");
const { AppSetting, User, WalletTransaction } = require("../models");

const GOAL_REWARD_KEY = "wallet_goal_reward";
const PLAYER_OF_MONTH_REWARD_KEY = "wallet_player_of_month_reward";
const DEFAULT_GOAL_REWARD = 2000;
const DEFAULT_PLAYER_OF_MONTH_REWARD = 15000;

function asReward(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

async function getWalletRewardSettings() {
  const rows = await AppSetting.findAll({
    where: { key: [GOAL_REWARD_KEY, PLAYER_OF_MONTH_REWARD_KEY] },
  });
  const values = new Map(rows.map((row) => [row.key, row.value]));
  return {
    goalReward: asReward(values.get(GOAL_REWARD_KEY), DEFAULT_GOAL_REWARD),
    playerOfMonthReward: asReward(
      values.get(PLAYER_OF_MONTH_REWARD_KEY),
      DEFAULT_PLAYER_OF_MONTH_REWARD
    ),
  };
}

async function setWalletRewardSettings({ goalReward, playerOfMonthReward }) {
  const nextGoalReward = asReward(goalReward, -1);
  const nextPlayerOfMonthReward = asReward(playerOfMonthReward, -1);
  if (nextGoalReward < 0 || nextPlayerOfMonthReward < 0) {
    throw new Error("Reward values must be whole numbers greater than or equal to zero");
  }
  if (nextGoalReward > 10000000 || nextPlayerOfMonthReward > 10000000) {
    throw new Error("Reward value is too large");
  }

  await Promise.all([
    AppSetting.upsert({ key: GOAL_REWARD_KEY, value: String(nextGoalReward) }),
    AppSetting.upsert({
      key: PLAYER_OF_MONTH_REWARD_KEY,
      value: String(nextPlayerOfMonthReward),
    }),
  ]);
  return { goalReward: nextGoalReward, playerOfMonthReward: nextPlayerOfMonthReward };
}

async function recordWalletTransaction({
  userId,
  amount,
  type,
  referenceKey,
  description,
  metadata = null,
  transaction,
}) {
  const execute = async (t) => {
    const existing = await WalletTransaction.findOne({
      where: { referenceKey },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (existing) return { entry: existing, duplicate: true };

    const user = await User.findByPk(userId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!user) throw new Error("Wallet owner was not found");

    const nextBalance = Number(user.walletBalance || 0) + Number(amount);
    if (nextBalance < 0) throw new Error("Insufficient wallet balance");

    await user.update({ walletBalance: nextBalance }, { transaction: t });
    const entry = await WalletTransaction.create({
      userId,
      amount: Number(amount),
      balanceAfter: nextBalance,
      type,
      referenceKey,
      description,
      metadata,
    }, { transaction: t });
    return { entry, duplicate: false };
  };

  return transaction ? execute(transaction) : sequelize.transaction(execute);
}

async function rewardGoalForMatch({ gameId, userId, goals, transaction }) {
  if (Number(goals) <= 0) return null;
  const { goalReward } = await getWalletRewardSettings();
  if (goalReward === 0) return null;
  return recordWalletTransaction({
    userId,
    amount: goalReward,
    type: "goal_reward",
    referenceKey: `goal_reward:${gameId}:${userId}`,
    description: "مكافأة تسجيل هدف في مباراة",
    metadata: { gameId, goals },
    transaction,
  });
}

async function rewardPlayerOfMonth({ playerOfMonthId, userId, month, transaction }) {
  const { playerOfMonthReward } = await getWalletRewardSettings();
  if (playerOfMonthReward === 0) return null;
  return recordWalletTransaction({
    userId,
    amount: playerOfMonthReward,
    type: "player_of_month_reward",
    referenceKey: `player_of_month_reward:${playerOfMonthId}`,
    description: `مكافأة لاعب الشهر ${month}`,
    metadata: { playerOfMonthId, month },
    transaction,
  });
}

async function getWalletSummary(userId) {
  const user = await User.findByPk(userId, { attributes: ["id", "walletBalance"] });
  if (!user) return null;
  const transactions = await WalletTransaction.findAll({
    where: { userId },
    order: [["createdAt", "DESC"], ["id", "DESC"]],
    limit: 40,
  });
  return { balance: Number(user.walletBalance || 0), transactions };
}

module.exports = {
  GOAL_REWARD_KEY,
  PLAYER_OF_MONTH_REWARD_KEY,
  DEFAULT_GOAL_REWARD,
  DEFAULT_PLAYER_OF_MONTH_REWARD,
  getWalletRewardSettings,
  setWalletRewardSettings,
  recordWalletTransaction,
  rewardGoalForMatch,
  rewardPlayerOfMonth,
  getWalletSummary,
};
