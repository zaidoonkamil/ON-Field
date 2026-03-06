const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Message = sequelize.define("Message", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: "Users",
            key: "id"
        }
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    room: {
        type: DataTypes.STRING,
        defaultValue: "main_chat",
        allowNull: false,
    }
}, {
    timestamps: true,
});

module.exports = Message;
