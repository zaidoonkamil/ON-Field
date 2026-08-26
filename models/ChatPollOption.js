const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ChatPollOption = sequelize.define("ChatPollOption", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  pollId: { type: DataTypes.INTEGER, allowNull: false },
  text: { type: DataTypes.STRING(300), allowNull: false },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false },
}, { timestamps: true });

module.exports = ChatPollOption;
