const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const GameSlot = sequelize.define("GameSlot", {
  id: { 
    type: DataTypes.INTEGER, 
    autoIncrement: true, 
    primaryKey: true 
},
  gameId: { 
    type: DataTypes.INTEGER, 
    allowNull: false 
},
  team: { 
    type: DataTypes.ENUM("A", "B"), 
    allowNull: false 
},
  code: { 
    type: DataTypes.STRING, 
    allowNull: false 
},
  label: { 
    type: DataTypes.STRING, 
    allowNull: false 
},
  role: {
    type: DataTypes.ENUM("player", "bench", "coach"),
    allowNull: false,
    defaultValue: "player",
  },

  userId: { type: DataTypes.INTEGER, allowNull: true },
  bookedAt: { type: DataTypes.DATE, allowNull: true },
  // Missing from requests made by old app versions, so cash remains the safe default.
  paymentMethod: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "cash" },
  walletDebit: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, { 
    timestamps: true 
});

module.exports = GameSlot;
