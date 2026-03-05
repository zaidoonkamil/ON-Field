const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const MonthlySquadSlot = sequelize.define("MonthlySquadSlot", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  squadId: { type: DataTypes.INTEGER, allowNull: false },

  code: { type: DataTypes.STRING, allowNull: false },
  label: { type: DataTypes.STRING, allowNull: false },

  role: {
    type: DataTypes.ENUM("player", "bench", "coach"),
    allowNull: false,
    defaultValue: "player",
  },

  userId: { type: DataTypes.INTEGER, allowNull: true },

  assignedAt: { type: DataTypes.DATE, allowNull: true },
}, { timestamps: true });

module.exports = MonthlySquadSlot;