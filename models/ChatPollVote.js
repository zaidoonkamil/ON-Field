const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const ChatPollVote = sequelize.define("ChatPollVote", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  pollId: { type: DataTypes.INTEGER, allowNull: false },
  optionId: { type: DataTypes.INTEGER, allowNull: false },
  userId: { type: DataTypes.INTEGER, allowNull: false },
}, {
  timestamps: true,
  indexes: [{ unique: true, fields: ["pollId", "userId"] }],
});

module.exports = ChatPollVote;
