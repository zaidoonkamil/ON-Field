const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const TournamentMatch = sequelize.define("TournamentMatch", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  tournamentId: { type: DataTypes.INTEGER, allowNull: false },
  teamAId: { type: DataTypes.INTEGER, allowNull: true },
  teamBId: { type: DataTypes.INTEGER, allowNull: true },
  scoreA: { type: DataTypes.INTEGER, allowNull: true },
  scoreB: { type: DataTypes.INTEGER, allowNull: true },
  roundIndex: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  roundLabel: { type: DataTypes.STRING(80), allowNull: false, defaultValue: "الجولة 1" },
  groupName: { type: DataTypes.STRING(16), allowNull: true },
  startsAt: { type: DataTypes.DATE, allowNull: true },
  status: {
    type: DataTypes.ENUM("scheduled", "live", "closed"),
    allowNull: false,
    defaultValue: "scheduled",
  },
}, { timestamps: true });

module.exports = TournamentMatch;
