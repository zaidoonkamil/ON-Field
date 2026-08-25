const { Op, fn, col } = require("sequelize");
const { AppSetting, PlayerMatchStats, User } = require("../models");

const PLAYER_VERIFICATION_THRESHOLD_KEY = "player_verification_threshold";
const DEFAULT_PLAYER_VERIFICATION_THRESHOLD = 50;

const normalizeThreshold = (value) => {
  const threshold = Number.parseInt(value, 10);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100000) {
    return null;
  }
  return threshold;
};

async function getPlayerVerificationThreshold() {
  const setting = await AppSetting.findByPk(PLAYER_VERIFICATION_THRESHOLD_KEY);
  return normalizeThreshold(setting?.value) || DEFAULT_PLAYER_VERIFICATION_THRESHOLD;
}

async function setPlayerVerificationThreshold(value) {
  const threshold = normalizeThreshold(value);
  if (threshold === null) {
    throw new Error("verificationThreshold must be an integer between 1 and 100000");
  }

  await AppSetting.upsert({
    key: PLAYER_VERIFICATION_THRESHOLD_KEY,
    value: String(threshold),
  });
  return threshold;
}

async function awardVerificationIfEligible(userId, thresholdOverride) {
  const user = await User.findByPk(userId, {
    attributes: ["id", "role", "isVerified", "verifiedAt"],
  });
  if (!user || ["admin", "super_admin", "photographer"].includes(user.role)) {
    return false;
  }

  const threshold = thresholdOverride ?? await getPlayerVerificationThreshold();
  const totals = await PlayerMatchStats.findOne({
    where: { userId },
    attributes: [
      [fn("COALESCE", fn("SUM", col("goals")), 0), "goals"],
      [fn("COALESCE", fn("SUM", col("assists")), 0), "assists"],
    ],
    raw: true,
  });
  const contributions =
    (Number(totals?.goals) || 0) + (Number(totals?.assists) || 0);

  const shouldBeVerified = contributions >= threshold;
  if (Boolean(user.isVerified) === shouldBeVerified) return shouldBeVerified;

  await user.update({
    isVerified: shouldBeVerified,
    verifiedAt: shouldBeVerified ? user.verifiedAt || new Date() : null,
  });
  return shouldBeVerified;
}

async function awardEligiblePlayers(thresholdOverride) {
  const threshold = thresholdOverride ?? await getPlayerVerificationThreshold();
  const rows = await PlayerMatchStats.findAll({
    attributes: [
      "userId",
      [fn("SUM", col("goals")), "goals"],
      [fn("SUM", col("assists")), "assists"],
    ],
    group: ["userId"],
    raw: true,
  });

  const ids = rows
    .filter((row) => (Number(row.goals) || 0) + (Number(row.assists) || 0) >= threshold)
    .map((row) => Number(row.userId))
    .filter(Number.isInteger);

  const playerRoleWhere = {
    role: { [Op.notIn]: ["admin", "super_admin", "photographer"] },
  };
  const revokeWhere = {
    ...playerRoleWhere,
    isVerified: true,
  };
  if (ids.length) {
    revokeWhere.id = { [Op.notIn]: ids };
  }

  await User.update(
    { isVerified: false, verifiedAt: null },
    { where: revokeWhere }
  );

  if (!ids.length) return 0;

  const [updated] = await User.update(
    { isVerified: true, verifiedAt: new Date() },
    {
      where: {
        id: { [Op.in]: ids },
        isVerified: false,
        ...playerRoleWhere,
      },
    }
  );
  return updated;
}

module.exports = {
  DEFAULT_PLAYER_VERIFICATION_THRESHOLD,
  PLAYER_VERIFICATION_THRESHOLD_KEY,
  getPlayerVerificationThreshold,
  setPlayerVerificationThreshold,
  awardVerificationIfEligible,
  awardEligiblePlayers,
};
