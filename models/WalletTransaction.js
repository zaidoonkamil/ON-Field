const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const WalletTransaction = sequelize.define("WalletTransaction", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  // Positive amounts are rewards/refunds; negative amounts are wallet payments.
  amount: { type: DataTypes.INTEGER, allowNull: false },
  balanceAfter: { type: DataTypes.INTEGER, allowNull: false },
  type: { type: DataTypes.STRING(40), allowNull: false },
  referenceKey: { type: DataTypes.STRING(160), allowNull: false, unique: true },
  description: { type: DataTypes.STRING(255), allowNull: false },
  metadata: { type: DataTypes.JSON, allowNull: true },
}, {
  timestamps: true,
});

module.exports = WalletTransaction;
