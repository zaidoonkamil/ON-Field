const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Governorate = sequelize.define(
  "Governorate",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: "governorates",
    timestamps: true,
  }
);

module.exports = Governorate;
