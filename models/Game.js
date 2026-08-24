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
  stadiumImage: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  startsAt: { 
    type: DataTypes.DATE, 
    allowNull: false 
   },  
  locationUrl: {
    type: DataTypes.STRING(2048),
    allowNull: true,
    validate: {
      isUrl: true,
    },
  }, 
  formationSize: {
    type: DataTypes.ENUM("5", "7", "9", "11"),
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM("open", "closed"),
    allowNull: false,
    defaultValue: "open",
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    defaultValue: 0,
    validate: {
      min: 0,
    },
  },
  governorateId: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },

}, { timestamps: true });


module.exports = Game;
