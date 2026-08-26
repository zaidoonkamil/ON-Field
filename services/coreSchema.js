const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const {
  Governorate,
  User,
  Game,
  GameSlot,
  Post,
  LiveStream,
  MonthlySquad,
  PlayerOfMonth,
  PlayerMatchStats,
  BookingAd,
  AppSetting,
  WalletTransaction,
} = require("../models");
const { BAGHDAD_NAME } = require("./governorates");
const {
  DEFAULT_PLAYER_VERIFICATION_THRESHOLD,
  PLAYER_VERIFICATION_THRESHOLD_KEY,
  awardEligiblePlayers,
} = require("./playerVerification");
const {
  GOAL_REWARD_KEY,
  PLAYER_OF_MONTH_REWARD_KEY,
  DEFAULT_GOAL_REWARD,
  DEFAULT_PLAYER_OF_MONTH_REWARD,
} = require("./wallet");

let coreSchemaPromise = null;
const LEGACY_GAMES_SHIFT_MARKER = "legacy_games_plus_2h_v1";

async function ensureColumn(queryInterface, tableName, columnName, definition) {
  const table = await queryInterface.describeTable(tableName);
  if (!table[columnName]) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
}

async function ensureUserRoleEnum(queryInterface, tableName) {
  const table = await queryInterface.describeTable(tableName);
  const roleColumn = table.role;
  const typeText = String(roleColumn?.type || "").toLowerCase();

  if (!typeText.includes("super_admin")) {
    await queryInterface.changeColumn(tableName, "role", {
      type: DataTypes.ENUM("user", "admin", "super_admin", "photographer"),
      allowNull: false,
      defaultValue: "user",
    });
    return;
  }

  if (!typeText.includes("photographer")) {
    await queryInterface.changeColumn(tableName, "role", {
      type: DataTypes.ENUM("user", "admin", "super_admin", "photographer"),
      allowNull: false,
      defaultValue: "user",
    });
  }
}

async function ensureFormationSizeEnum(queryInterface, model) {
  const tableName = model.getTableName();
  const table = await queryInterface.describeTable(tableName);
  const typeText = String(table.formationSize?.type || "").toLowerCase();

  if (typeText.includes("'9'")) return;

  await queryInterface.changeColumn(tableName, "formationSize", {
    type: DataTypes.ENUM("5", "7", "9", "11"),
    allowNull: false,
  });
}

async function backfillGovernorateId(model, baghdadId) {
  const tableName = model.getTableName();
  const queryInterface = sequelize.getQueryInterface();
  const table = await queryInterface.describeTable(tableName);

  if (!table.governorateId) return;

  await model.update(
    { governorateId: baghdadId },
    {
      where: {
        governorateId: null,
      },
    }
  );
}

async function backfillMonthlySquadGovernorateId(baghdadId) {
  const rows = await MonthlySquad.findAll({
    where: { governorateId: null },
    attributes: ["id", "createdBy"],
  });

  for (const row of rows) {
    let governorateId = baghdadId;

    if (row.createdBy) {
      const creator = await User.findByPk(row.createdBy, {
        attributes: ["governorateId"],
      });
      if (creator?.governorateId) {
        governorateId = creator.governorateId;
      }
    }

    await row.update({ governorateId });
  }
}

async function backfillPlayerOfMonthGovernorateId(baghdadId) {
  const rows = await PlayerOfMonth.findAll({
    where: { governorateId: null },
    attributes: ["id", "userId"],
  });

  for (const row of rows) {
    let governorateId = baghdadId;

    if (row.userId) {
      const user = await User.findByPk(row.userId, {
        attributes: ["governorateId"],
      });
      if (user?.governorateId) {
        governorateId = user.governorateId;
      }
    }

    await row.update({ governorateId });
  }
}

async function ensurePlayerOfMonthIndexes(queryInterface) {
  const tableName = PlayerOfMonth.getTableName();
  const indexes = await queryInterface.showIndex(tableName);

  for (const index of indexes) {
    const fields = Array.isArray(index.fields)
      ? index.fields.map((field) => field.attribute || field.name)
      : [];

    const isLegacyMonthUnique =
      index.unique === true &&
      fields.length === 1 &&
      fields[0] === "month";

    if (isLegacyMonthUnique) {
      await queryInterface.removeIndex(tableName, index.name);
    }
  }

  const refreshedIndexes = await queryInterface.showIndex(tableName);
  const hasScopedUniqueIndex = refreshedIndexes.some((index) => {
    const fields = Array.isArray(index.fields)
      ? index.fields.map((field) => field.attribute || field.name)
      : [];

    return (
      index.unique === true &&
      fields.length === 2 &&
      fields[0] === "month" &&
      fields[1] === "governorateId"
    );
  });

  if (!hasScopedUniqueIndex) {
    await queryInterface.addIndex(tableName, ["month", "governorateId"], {
      unique: true,
      name: "player_of_month_month_governorate_unique",
    });
  }
}

async function ensureAppMetaTable(queryInterface) {
  await queryInterface.sequelize.query(`
    CREATE TABLE IF NOT EXISTS app_meta (
      meta_key VARCHAR(191) PRIMARY KEY,
      meta_value TEXT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function hasMetaFlag(key) {
  const [rows] = await sequelize.query(
    `SELECT meta_key FROM app_meta WHERE meta_key = ? LIMIT 1`,
    { replacements: [key] }
  );
  return rows.length > 0;
}

async function setMetaFlag(key, value = "1") {
  await sequelize.query(
    `
      INSERT INTO app_meta (meta_key, meta_value)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE
        meta_value = VALUES(meta_value),
        updatedAt = CURRENT_TIMESTAMP
    `,
    { replacements: [key, value] }
  );
}

async function shiftLegacyGamesByTwoHours(queryInterface) {
  await ensureAppMetaTable(queryInterface);

  const alreadyShifted = await hasMetaFlag(LEGACY_GAMES_SHIFT_MARKER);
  if (alreadyShifted) return;

  await sequelize.query(`
    UPDATE Games
    SET startsAt = DATE_ADD(startsAt, INTERVAL 2 HOUR)
  `);

  await setMetaFlag(LEGACY_GAMES_SHIFT_MARKER, "done");
}

async function ensureCoreSchema() {
  if (!coreSchemaPromise) {
    coreSchemaPromise = (async () => {
      const queryInterface = sequelize.getQueryInterface();

      await Governorate.sync();

      const usersTable = User.getTableName();
      await ensureUserRoleEnum(queryInterface, usersTable);
      await ensureColumn(queryInterface, usersTable, "isActive", {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      });
      await ensureColumn(queryInterface, usersTable, "isVerified", {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
      await ensureColumn(queryInterface, usersTable, "verifiedAt", {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      });
      await ensureColumn(queryInterface, usersTable, "governorateId", {
        type: DataTypes.INTEGER,
        allowNull: true,
      });
      await ensureColumn(queryInterface, usersTable, "chatLastReadAt", {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW,
      });
      await ensureColumn(queryInterface, usersTable, "walletBalance", {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
      await User.update(
        { chatLastReadAt: new Date() },
        { where: { chatLastReadAt: null } }
      );
      await User.update(
        { isVerified: false },
        { where: { isVerified: null } }
      );
      await User.update(
        { walletBalance: 0 },
        { where: { walletBalance: null } }
      );

      const scopedModels = [
        Game,
        Post,
        LiveStream,
        MonthlySquad,
        PlayerOfMonth,
        BookingAd,
      ];
      for (const model of scopedModels) {
        await model.sync();
        await ensureColumn(queryInterface, model.getTableName(), "governorateId", {
          type: DataTypes.INTEGER,
          allowNull: true,
        });
      }

      await ensureColumn(queryInterface, Game.getTableName(), "stadiumImage", {
        type: DataTypes.STRING,
        allowNull: true,
      });
      await ensureColumn(queryInterface, Post.getTableName(), "formationSize", {
        type: DataTypes.STRING(2),
        allowNull: false,
        defaultValue: "11",
      });
      await ensureFormationSizeEnum(queryInterface, Game);
      await ensureFormationSizeEnum(queryInterface, MonthlySquad);
      await ensureColumn(
        queryInterface,
        PlayerMatchStats.getTableName(),
        "individualAward",
        {
          type: DataTypes.STRING(24),
          allowNull: true,
          defaultValue: null,
        }
      );
      await WalletTransaction.sync();
      await ensureColumn(queryInterface, GameSlot.getTableName(), "paymentMethod", {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: "cash",
      });
      await ensureColumn(queryInterface, GameSlot.getTableName(), "walletDebit", {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });

      const [baghdad] = await Governorate.findOrCreate({
        where: { name: BAGHDAD_NAME },
        defaults: { isActive: true },
      });

      await Governorate.update(
        { isActive: true },
        { where: { id: baghdad.id } }
      );

      await User.update(
        { governorateId: baghdad.id },
        {
          where: {
            governorateId: null,
          },
        }
      );

      await User.update(
        { isActive: true },
        {
          where: {
            isActive: null,
          },
        }
      );

      await backfillGovernorateId(Game, baghdad.id);
      await backfillGovernorateId(Post, baghdad.id);
      await backfillGovernorateId(LiveStream, baghdad.id);
      await backfillMonthlySquadGovernorateId(baghdad.id);
      await backfillPlayerOfMonthGovernorateId(baghdad.id);

      await ensurePlayerOfMonthIndexes(queryInterface);
      await shiftLegacyGamesByTwoHours(queryInterface);

      await AppSetting.findOrCreate({
        where: { key: PLAYER_VERIFICATION_THRESHOLD_KEY },
        defaults: { value: String(DEFAULT_PLAYER_VERIFICATION_THRESHOLD) },
      });
      await AppSetting.findOrCreate({
        where: { key: GOAL_REWARD_KEY },
        defaults: { value: String(DEFAULT_GOAL_REWARD) },
      });
      await AppSetting.findOrCreate({
        where: { key: PLAYER_OF_MONTH_REWARD_KEY },
        defaults: { value: String(DEFAULT_PLAYER_OF_MONTH_REWARD) },
      });
      // Existing players can earn the badge from their old match records too.
      await awardEligiblePlayers();
    })().catch((error) => {
      coreSchemaPromise = null;
      throw error;
    });
  }

  return coreSchemaPromise;
}

module.exports = {
  ensureCoreSchema,
};
