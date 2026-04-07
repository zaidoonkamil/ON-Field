const User = require("./user");
const Governorate = require("./Governorate");
const UserDevice = require("./user_device");
const Post = require("./Post");
const Game = require("./Game");
const GameSlot = require("./GameSlot");
const MatchStats = require("./MatchStats");
const PlayerMatchStats = require("./PlayerMatchStats");
const LiveStream = require("./LiveStream");
const MonthlySquad = require("./MonthlySquad");
const MonthlySquadSlot = require("./MonthlySquadSlot");
const Message = require("./Message");
const PlayerOfMonth = require("./PlayerOfMonth");

Governorate.hasMany(User, {
  foreignKey: "governorateId",
  as: "users",
  onDelete: "SET NULL",
});
User.belongsTo(Governorate, {
  foreignKey: "governorateId",
  as: "governorate",
});

Governorate.hasMany(Game, {
  foreignKey: "governorateId",
  as: "games",
  onDelete: "SET NULL",
});
Game.belongsTo(Governorate, {
  foreignKey: "governorateId",
  as: "governorate",
});

Governorate.hasMany(Post, {
  foreignKey: "governorateId",
  as: "posts",
  onDelete: "SET NULL",
});
Post.belongsTo(Governorate, {
  foreignKey: "governorateId",
  as: "governorate",
});

Governorate.hasMany(LiveStream, {
  foreignKey: "governorateId",
  as: "liveStreams",
  onDelete: "SET NULL",
});
LiveStream.belongsTo(Governorate, {
  foreignKey: "governorateId",
  as: "governorate",
});

Governorate.hasMany(MonthlySquad, {
  foreignKey: "governorateId",
  as: "monthlySquads",
  onDelete: "SET NULL",
});
MonthlySquad.belongsTo(Governorate, {
  foreignKey: "governorateId",
  as: "governorate",
});

Governorate.hasMany(PlayerOfMonth, {
  foreignKey: "governorateId",
  as: "playerOfMonths",
  onDelete: "SET NULL",
});
PlayerOfMonth.belongsTo(Governorate, {
  foreignKey: "governorateId",
  as: "governorate",
});

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

User.hasMany(Message, { foreignKey: "userId", as: "messages", onDelete: "CASCADE" });
Message.belongsTo(User, { foreignKey: "userId", as: "user" });

User.hasMany(PlayerOfMonth, { foreignKey: "userId", as: "playerOfMonths", onDelete: "CASCADE" });
PlayerOfMonth.belongsTo(User, { foreignKey: "userId", as: "user" });

module.exports = {
  User,
  Governorate,
  UserDevice,
  Post,
  Game,
  GameSlot,
  MatchStats,
  PlayerMatchStats,
  LiveStream,
  MonthlySquad,
  MonthlySquadSlot,
  Message,
  PlayerOfMonth,
};
