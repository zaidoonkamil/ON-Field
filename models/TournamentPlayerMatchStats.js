const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const TournamentPlayerMatchStats = sequelize.define("TournamentPlayerMatchStats", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  tournamentMatchId: { type: DataTypes.INTEGER, allowNull: false },
  tournamentId: { type: DataTypes.INTEGER, allowNull: false },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  teamSide: { type: DataTypes.ENUM("A", "B"), allowNull: false },
  tournamentTeamId: { type: DataTypes.INTEGER, allowNull: false },
  goals: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  assists: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  yellowCards: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  redCards: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  isMotm: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  individualAward: { type: DataTypes.STRING(24), allowNull: true, defaultValue: null },
}, { timestamps: true });

module.exports = TournamentPlayerMatchStats;
