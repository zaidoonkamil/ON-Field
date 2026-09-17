const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const TournamentTeam = sequelize.define("TournamentTeam", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  tournamentId: { type: DataTypes.INTEGER, allowNull: false },
  teamNumber: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  joinCode: { type: DataTypes.STRING(12), allowNull: false, unique: true },
  // Required by the create route, but nullable after the creator account is deleted.
  createdBy: { type: DataTypes.INTEGER, allowNull: true },
}, { timestamps: true });

module.exports = TournamentTeam;
