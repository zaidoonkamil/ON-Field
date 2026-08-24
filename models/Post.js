const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Post = sequelize.define("Post", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

  userId: {
    type: DataTypes.INTEGER,
    allowNull: true, 
  },
  governorateId: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },

  text: { type: DataTypes.TEXT, allowNull: true },

  // Old posts and clients belong to the 11-a-side section by default.
  formationSize: {
    type: DataTypes.STRING(2),
    allowNull: false,
    defaultValue: "11",
  },

  media: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: { images: [], videos: [] },
  },
  
}, { timestamps: true });

module.exports = Post;
