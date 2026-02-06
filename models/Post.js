const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Post = sequelize.define("Post", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  userId: {
    type: DataTypes.INTEGER,
    allowNull: true, 
  },

  text: { type: DataTypes.TEXT, allowNull: true },

  media: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: { images: [], videos: [] },
  },
  
}, { timestamps: true });

module.exports = Post;
