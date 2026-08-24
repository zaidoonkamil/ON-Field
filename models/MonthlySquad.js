const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const MonthlySquad = sequelize.define("MonthlySquad", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },

  formationSize: {
    type: DataTypes.ENUM("5", "7", "9", "11"),
    allowNull: false,
  },

  status: {
    type: DataTypes.ENUM("draft", "published"),
    allowNull: false,
    defaultValue: "published",
  },

  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  governorateId: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, { timestamps: true });

module.exports = MonthlySquad;
