const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const LiveStream = sequelize.define("LiveStream", {
  id: {
     type: DataTypes.INTEGER, 
     autoIncrement: true, 
     primaryKey: true 
    },

  title: { 
    type: DataTypes.STRING,
     allowNull: true 
    },

  youtubeVideoId: { 
     type: DataTypes.STRING,
     allowNull: false
    },

  isActive: {
     type: DataTypes.BOOLEAN, 
     allowNull: false, 
     defaultValue: true
    },
}, {
     timestamps: true 
});

module.exports = LiveStream;
