const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Tournament = sequelize.define("Tournament", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  title: { type: DataTypes.STRING, allowNull: false },
  bannerImage: { type: DataTypes.STRING, allowNull: true },
  startsAt: { type: DataTypes.DATE, allowNull: false },
  formationSize: { type: DataTypes.ENUM("5", "7", "9", "11"), allowNull: false, defaultValue: "11" },
  teamCapacity: { type: DataTypes.ENUM("16", "32", "64"), allowNull: false },
  competitionFormat: { type: DataTypes.ENUM("knockout", "groups"), allowNull: false },
  status: { type: DataTypes.ENUM("open", "closed", "finished"), allowNull: false, defaultValue: "open" },
  governorateId: { type: DataTypes.INTEGER, allowNull: true },
  createdBy: { type: DataTypes.INTEGER, allowNull: true },
}, { timestamps: true });

module.exports = Tournament;
