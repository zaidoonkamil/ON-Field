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
const BookingAd = require("./BookingAd");
const AppSetting = require("./AppSetting");
const WalletTransaction = require("./WalletTransaction");
const ChatPoll = require("./ChatPoll");
const ChatPollOption = require("./ChatPollOption");
const ChatPollVote = require("./ChatPollVote");
const Tournament = require("./Tournament");
const TournamentTeam = require("./TournamentTeam");
const TournamentSlot = require("./TournamentSlot");
const TournamentMatch = require("./TournamentMatch");
const TournamentMatchStats = require("./TournamentMatchStats");
const TournamentPlayerMatchStats = require("./TournamentPlayerMatchStats");

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

Governorate.hasMany(BookingAd, {
  foreignKey: "governorateId",
  as: "bookingAds",
  onDelete: "SET NULL",
});
BookingAd.belongsTo(Governorate, {
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
Message.belongsTo(Message, { foreignKey: "replyToMessageId", as: "replyTo" });
Message.hasMany(Message, { foreignKey: "replyToMessageId", as: "replies" });
User.hasMany(Message, { foreignKey: "pinnedByUserId", as: "pinnedMessages", onDelete: "SET NULL" });
Message.belongsTo(User, { foreignKey: "pinnedByUserId", as: "pinnedBy" });
Message.hasOne(ChatPoll, { foreignKey: "messageId", as: "poll", onDelete: "CASCADE", hooks: true });
ChatPoll.belongsTo(Message, { foreignKey: "messageId", as: "message" });
ChatPoll.hasMany(ChatPollOption, { foreignKey: "pollId", as: "options", onDelete: "CASCADE", hooks: true });
ChatPollOption.belongsTo(ChatPoll, { foreignKey: "pollId", as: "poll" });
ChatPoll.hasMany(ChatPollVote, { foreignKey: "pollId", as: "votes", onDelete: "CASCADE", hooks: true });
ChatPollVote.belongsTo(ChatPoll, { foreignKey: "pollId", as: "poll" });
ChatPollOption.hasMany(ChatPollVote, { foreignKey: "optionId", as: "votes", onDelete: "CASCADE", hooks: true });
ChatPollVote.belongsTo(ChatPollOption, { foreignKey: "optionId", as: "option" });

User.hasMany(PlayerOfMonth, { foreignKey: "userId", as: "playerOfMonths", onDelete: "CASCADE" });
PlayerOfMonth.belongsTo(User, { foreignKey: "userId", as: "user" });

User.hasMany(WalletTransaction, { foreignKey: "userId", as: "walletTransactions", onDelete: "CASCADE" });
WalletTransaction.belongsTo(User, { foreignKey: "userId", as: "user" });

Governorate.hasMany(Tournament, { foreignKey: "governorateId", as: "tournaments", onDelete: "SET NULL" });
Tournament.belongsTo(Governorate, { foreignKey: "governorateId", as: "governorate" });
Tournament.hasMany(TournamentTeam, { foreignKey: "tournamentId", as: "teams", onDelete: "CASCADE", hooks: true });
TournamentTeam.belongsTo(Tournament, { foreignKey: "tournamentId", as: "tournament" });
Tournament.hasMany(TournamentSlot, { foreignKey: "tournamentId", as: "slots", onDelete: "CASCADE", hooks: true });
TournamentSlot.belongsTo(Tournament, { foreignKey: "tournamentId", as: "tournament" });
TournamentTeam.hasMany(TournamentSlot, { foreignKey: "tournamentTeamId", as: "slots", onDelete: "SET NULL" });
TournamentSlot.belongsTo(TournamentTeam, { foreignKey: "tournamentTeamId", as: "team" });
User.hasMany(TournamentTeam, { foreignKey: "createdBy", as: "createdTournamentTeams", onDelete: "SET NULL" });
TournamentTeam.belongsTo(User, { foreignKey: "createdBy", as: "creator" });
User.hasMany(TournamentSlot, { foreignKey: "userId", as: "tournamentSlots", onDelete: "SET NULL" });
TournamentSlot.belongsTo(User, { foreignKey: "userId", as: "user" });

Tournament.hasMany(TournamentMatch, { foreignKey: "tournamentId", as: "matches", onDelete: "CASCADE", hooks: true });
TournamentMatch.belongsTo(Tournament, { foreignKey: "tournamentId", as: "tournament" });
TournamentTeam.hasMany(TournamentMatch, { foreignKey: "teamAId", as: "homeTournamentMatches", onDelete: "CASCADE" });
TournamentTeam.hasMany(TournamentMatch, { foreignKey: "teamBId", as: "awayTournamentMatches", onDelete: "CASCADE" });
TournamentMatch.belongsTo(TournamentTeam, { foreignKey: "teamAId", as: "teamA" });
TournamentMatch.belongsTo(TournamentTeam, { foreignKey: "teamBId", as: "teamB" });
TournamentMatch.hasOne(TournamentMatchStats, { foreignKey: "tournamentMatchId", as: "matchStats", onDelete: "CASCADE", hooks: true });
TournamentMatchStats.belongsTo(TournamentMatch, { foreignKey: "tournamentMatchId", as: "match" });
TournamentMatch.hasMany(TournamentPlayerMatchStats, { foreignKey: "tournamentMatchId", as: "playerStats", onDelete: "CASCADE", hooks: true });
TournamentPlayerMatchStats.belongsTo(TournamentMatch, { foreignKey: "tournamentMatchId", as: "match" });
Tournament.hasMany(TournamentPlayerMatchStats, { foreignKey: "tournamentId", as: "playerStats", onDelete: "CASCADE", hooks: true });
TournamentPlayerMatchStats.belongsTo(Tournament, { foreignKey: "tournamentId", as: "tournament" });
TournamentTeam.hasMany(TournamentPlayerMatchStats, { foreignKey: "tournamentTeamId", as: "matchPlayerStats", onDelete: "CASCADE" });
TournamentPlayerMatchStats.belongsTo(TournamentTeam, { foreignKey: "tournamentTeamId", as: "team" });
User.hasMany(TournamentPlayerMatchStats, { foreignKey: "userId", as: "tournamentPlayerStats", onDelete: "CASCADE" });
TournamentPlayerMatchStats.belongsTo(User, { foreignKey: "userId", as: "user" });

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
  BookingAd,
  AppSetting,
  WalletTransaction,
  ChatPoll,
  ChatPollOption,
  ChatPollVote,
  Tournament,
  TournamentTeam,
  TournamentSlot,
  TournamentMatch,
  TournamentMatchStats,
  TournamentPlayerMatchStats,
};
