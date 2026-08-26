const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ChatPoll = sequelize.define("ChatPoll", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  messageId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  question: { type: DataTypes.STRING(500), allowNull: false },
  createdByUserId: { type: DataTypes.INTEGER, allowNull: false },
  isClosed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { timestamps: true });

module.exports = ChatPoll;
