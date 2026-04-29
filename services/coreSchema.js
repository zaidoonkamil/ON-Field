const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const {
  Governorate,
  User,
  Game,
  Post,
  LiveStream,
  MonthlySquad,
  PlayerOfMonth,
} = require("../models");
const { BAGHDAD_NAME } = require("./governorates");

let coreSchemaPromise = null;

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
      await ensureColumn(queryInterface, usersTable, "governorateId", {
        type: DataTypes.INTEGER,
        allowNull: true,
      });

      const scopedModels = [Game, Post, LiveStream, MonthlySquad, PlayerOfMonth];
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
