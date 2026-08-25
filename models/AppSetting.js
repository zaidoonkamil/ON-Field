const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const AppSetting = sequelize.define("AppSetting", {
  key: {
    type: DataTypes.STRING(80),
    primaryKey: true,
  },
  value: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
}, {
  timestamps: true,
});

module.exports = AppSetting;
