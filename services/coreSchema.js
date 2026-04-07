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
      type: DataTypes.ENUM("user", "admin", "super_admin"),
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

async function ensureCoreSchema() {
  if (!coreSchemaPromise) {
    coreSchemaPromise = (async () => {
      const queryInterface = sequelize.getQueryInterface();

      await Governorate.sync();

      const usersTable = User.getTableName();
      await ensureUserRoleEnum(queryInterface, usersTable);
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

      for (const model of scopedModels) {
        await backfillGovernorateId(model, baghdad.id);
      }
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
