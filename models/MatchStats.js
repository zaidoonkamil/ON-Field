const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const MatchStats = sequelize.define("MatchStats", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  gameId: { type: DataTypes.INTEGER, allowNull: false, unique: true },

  offsidesA: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  offsidesB: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

  cornersA: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  cornersB: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

  bigChancesA: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  bigChancesB: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

  shotsA: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  shotsB: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

  xgA: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
  xgB: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },

  possessionA: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50, validate:{min:0,max:100} },
  possessionB: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50, validate:{min:0,max:100} },
}, { timestamps: true });

module.exports = MatchStats;
