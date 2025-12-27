const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const User = sequelize.define("User", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },

    image: {
        type: DataTypes.JSON,
        allowNull: true,
    },

    name: {
        type: DataTypes.STRING,
        allowNull: false,
    },

    phone: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },

    password: {
        type: DataTypes.STRING,
        allowNull: false,
    },

    role: {
        type: DataTypes.ENUM("user", "admin"),
        allowNull: false,
        defaultValue: "user",
    },
    position: {
        type: DataTypes.ENUM(
            "GK",
            "CB",
            "LB",
            "RB",
            "CM",
            "AMF",
            "RWF",
            "LWF",
            "CF"
        ),
        allowNull: true,
    },
    spd: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100,
        validate: { min: 0, max: 100 }
    },
    fin: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100,
        validate: { min: 0, max: 100 }
    },
    pas: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100,
        validate: { min: 0, max: 100 }
    },
    skl: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100,
        validate: { min: 0, max: 100 }
    },
    tkl: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100,
        validate: { min: 0, max: 100 }
    },
    str: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 100,
        validate: { min: 0, max: 100 }
    },
}, {
    timestamps: true,
});

module.exports = User;
