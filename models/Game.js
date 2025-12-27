const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Game = sequelize.define("Game", {
  id: { 
    type: DataTypes.INTEGER, 
    autoIncrement: true, 
    primaryKey: true 
    },
  stadiumName: { 
    type: DataTypes.STRING, 
    allowNull: false 
   },
  startsAt: { 
    type: DataTypes.DATE, 
    allowNull: false 
   },   
  formationSize: {
    type: DataTypes.ENUM("5", "7", "11"),
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM("open", "closed"),
    allowNull: false,
    defaultValue: "open",
  },
}, { timestamps: true });


module.exports = Game;
