const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const UserDevice = sequelize.define("UserDevice", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    player_id: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    chat_notifications_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
    },
}, {
    timestamps: true,
    tableName: "user_devices"
});

module.exports = UserDevice;
