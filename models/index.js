const User = require("./user");
const UserDevice = require("./user_device");
const Post = require("./Post");
const Game = require("./Game");
const GameSlot = require("./GameSlot");
const MatchStats = require("./MatchStats");
const PlayerMatchStats = require("./PlayerMatchStats");
const LiveStream = require("./LiveStream");
const MonthlySquad = require("./MonthlySquad");
const MonthlySquadSlot = require("./MonthlySquadSlot");

Game.hasMany(GameSlot, { foreignKey: "gameId", as: "slots", onDelete: "CASCADE", hooks: true });
GameSlot.belongsTo(Game, { foreignKey: "gameId", as: "game" });

Game.hasOne(MatchStats, { foreignKey: "gameId", as: "matchStats", onDelete: "CASCADE", hooks: true });
MatchStats.belongsTo(Game, { foreignKey: "gameId", as: "game" });

Game.hasMany(PlayerMatchStats, { foreignKey: "gameId", as: "playerStats", onDelete: "CASCADE", hooks: true });
PlayerMatchStats.belongsTo(Game, { foreignKey: "gameId", as: "game" });

User.hasMany(PlayerMatchStats, { foreignKey: "userId", as: "stats", onDelete: "CASCADE" });
PlayerMatchStats.belongsTo(User, { foreignKey: "userId", as: "user" });

User.hasMany(UserDevice, { foreignKey: "user_id", as: "devices", onDelete: "CASCADE" });
UserDevice.belongsTo(User, { foreignKey: "user_id", as: "user" });

User.hasMany(GameSlot, { foreignKey: "userId", as: "gameSlots", onDelete: "SET NULL" });
GameSlot.belongsTo(User, { foreignKey: "userId", as: "user" });

MonthlySquad.hasMany(MonthlySquadSlot, { foreignKey: "squadId", as: "slots", onDelete: "CASCADE",hooks: true,});
MonthlySquadSlot.belongsTo(MonthlySquad, { foreignKey: "squadId", as: "squad" });

User.hasMany(MonthlySquadSlot, { foreignKey: "userId", as: "monthlySquadSlots", onDelete: "SET NULL" });
MonthlySquadSlot.belongsTo(User, { foreignKey: "userId", as: "user" });

module.exports = {
  User,
  UserDevice,
  Post,
  Game,
  GameSlot,
  MatchStats,
  PlayerMatchStats,
  LiveStream,
  MonthlySquad,
  MonthlySquadSlot,
};
