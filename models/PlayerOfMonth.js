const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const PlayerOfMonth = sequelize.define("PlayerOfMonth", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  month: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  note: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  image: {
    type: DataTypes.JSON,
    allowNull: true,
  },
}, {
  tableName: "player_of_month",
  timestamps: true,
});

module.exports = PlayerOfMonth;