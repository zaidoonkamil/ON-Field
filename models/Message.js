const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const parseMentions = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    return [];
};

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
        defaultValue: "",
    },
    room: {
        type: DataTypes.STRING,
        defaultValue: "main_chat",
        allowNull: false,
    },
    mediaUrl: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
    },
    mediaType: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "text",
    },
    replyToMessageId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: "Messages",
            key: "id"
        }
    },
    mentions: {
        type: DataTypes.TEXT("long"),
        allowNull: true,
        get() {
            return parseMentions(this.getDataValue("mentions"));
        },
        set(value) {
            this.setDataValue("mentions", JSON.stringify(parseMentions(value)));
        },
    }
}, {
    timestamps: true,
});

module.exports = Message;
