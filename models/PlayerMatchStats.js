const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const PlayerMatchStats = sequelize.define("PlayerMatchStats", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  gameId: { type: DataTypes.INTEGER, allowNull: false },
  userId: { type: DataTypes.INTEGER, allowNull: false },

  team: { type: DataTypes.ENUM("A","B"), allowNull: false },

  goals: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  assists: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  yellowCards: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  redCards: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

  isMotm: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { timestamps: true });

module.exports = PlayerMatchStats;
