"use strict"

// 把 aivai-batch 录制的对局转储导入 RTT 数据库(与 server.js 的 aivai 写库路径逐语句一致):
//   games(status=1→终局2) + players(bot 两个座位) + game_replay(含 .setup 首条)
//   + game_snap + game_ai_trace + game_state(终态)。
// 用法: node tools/import-aivai-game.js <runtimeDir> <dump.json> [more.json...]
//   runtimeDir = rots-runtime-pve 目录(取其 node_modules/better-sqlite3 与其中的 db 文件)。
// 幂等: 按 notice(seed 标识) 跳过已导入的对局。

const fs = require("fs")
const path = require("path")

const runtimeDir = path.resolve(process.argv[2])
if (!runtimeDir || process.argv.length < 4) {
	console.error("usage: node tools/import-aivai-game.js <runtimeDir> <dump.json> [more.json...]")
	process.exit(2)
}
const BetterSqlite3 = require(path.join(runtimeDir, "node_modules", "better-sqlite3"))
const db = new BetterSqlite3(path.join(runtimeDir, "db"))

const SQL_INSERT_GAME = db.prepare(
	"INSERT INTO games (owner_id,title_id,scenario,options,player_count,pace,is_private,is_random,notice,is_match) VALUES (?,?,?,?,?,?,?,?,?,?) returning game_id").pluck()
// 导入对局归属此账号(默认 42439069), 非私密, 便于网页端"我的对局"直接可见。
const OWNER_NAME = process.env.RTT_IMPORT_OWNER || "42439069"
const OWNER_ID = db.prepare("select user_id from users where name=?").pluck().get(OWNER_NAME) ?? 1
const SQL_START_GAME = db.prepare(
	"update games set status = 1, is_private = (is_private or user_count = 1 or user_count < player_count), ctime = datetime(), mtime = datetime(), active = ? where game_id = ?")
const SQL_INSERT_BOT_ROLE = db.prepare(
	"INSERT OR IGNORE INTO players (game_id,role,user_id,is_invite,bot_id) VALUES (?,?,0,0,?)")
const SQL_INSERT_REPLAY = db.prepare(
	"insert into game_replay (game_id,replay_id,role,action,arguments) values (?, (select coalesce(max(replay_id), 0) + 1 from game_replay where game_id=?) ,?,?,?) returning replay_id").pluck()
const SQL_INSERT_AI_TRACE = db.prepare(
	"insert or replace into game_ai_trace (game_id,replay_id,bot_id,role,policy_version,public_trace,private_trace) values (?,?,?,?,?,?,?)")
const SQL_INSERT_SNAP = db.prepare(
	"insert into game_snap (game_id,snap_id,replay_id,state) values (?, (select coalesce(max(snap_id), 0) + 1 from game_snap where game_id=?), ?, ?)")
const SQL_INSERT_GAME_STATE = db.prepare(
	"insert or replace into game_state (game_id,state) values (?,?)")
const SQL_UPDATE_GAME_ACTIVE = db.prepare(
	"update games set active=?, mtime=datetime(), moves=moves+1 where game_id=?")
const SQL_FINISH_GAME = db.prepare(
	"update games set status = 2, mtime = datetime(), active = null, moves = moves + ?, result = ? where game_id = ?")

// put_replay 口径: null/数字原样, 其余 JSON 字符串化。
function replayArgs(args) {
	if (args !== undefined && args !== null && typeof args !== "number")
		return JSON.stringify(args)
	return args === undefined ? null : args
}

const importOne = db.transaction(function (dump) {
	const options = { ...dump.options }
	const notice = `aivai ${dump.scenario} seed=${dump.seed} ${dump.bots.Japan} vs ${dump.bots.Allies}`
	const game_id = SQL_INSERT_GAME.get(OWNER_ID, "empire-of-the-sun", dump.scenario,
		JSON.stringify(options), 2, 0, 0, 0, notice, 0)
	for (const role of ["Japan", "Allies"])
		SQL_INSERT_BOT_ROLE.run(game_id, role, dump.bots[role])

	// start_game: 先置 status/active(终局局直接 None,  lobby 列表不显示"等待玩家"),
	// 再写 .setup 首条 replay + 无条件首快照 + 初始 game_state。
	SQL_START_GAME.run(dump.finalState.active === "None" ? "None" : "Both", game_id)
	const setupReplayId = SQL_INSERT_REPLAY.get(game_id, game_id, null, ".setup", replayArgs(dump.replay[0][2]))
	const traceByReplayId = new Map(dump.traces.map(t => [t[0], t]))
	const snapByReplayId = new Map(dump.snaps.map(s => [s[0], s[1]]))
	if (snapByReplayId.has(1)) SQL_INSERT_SNAP.run(game_id, game_id, setupReplayId, snapByReplayId.get(1))

	let moves = 0
	const n = dump.replay.length
	for (let i = 1; i < n; ++i) {
		const [role, action, args] = dump.replay[i]
		// replay_id 在库内自动递增; 录制时的 1-based 序号即插入顺序(.setup=1, 动作从 2 起)。
		const replay_id = i + 1
		SQL_INSERT_REPLAY.run(game_id, game_id, role, action, replayArgs(args))
		const trace = traceByReplayId.get(replay_id)
		if (trace)
			SQL_INSERT_AI_TRACE.run(game_id, replay_id, trace[1], trace[2], trace[3],
				JSON.stringify(trace[4] ?? null), JSON.stringify(trace[5] ?? null))
		const snap = snapByReplayId.get(replay_id)
		if (snap) SQL_INSERT_SNAP.run(game_id, game_id, replay_id, snap)
	}
	moves = dump.moves | 0
	SQL_INSERT_GAME_STATE.run(game_id, JSON.stringify(dump.finalState))
	SQL_FINISH_GAME.run(1, dump.winner, game_id)
	db.prepare("update games set moves=? where game_id=?").run(moves, game_id)
	return game_id
})

for (let i = 3; i < process.argv.length; ++i) {
	const file = path.resolve(process.argv[i])
	const dump = JSON.parse(fs.readFileSync(file, "utf8"))
	const notice = `aivai ${dump.scenario} seed=${dump.seed} ${dump.bots.Japan} vs ${dump.bots.Allies}`
	const existing = db.prepare("select game_id from games where notice=?").pluck().get(notice)
	if (existing) {
		console.log(`skip ${file.name ?? file} (already game_id ${existing})`)
		continue
	}
	const game_id = importOne(dump)
	console.log(`${path.basename(file)} → game_id ${game_id} (winner=${dump.winner}, turn=${dump.turn}, moves=${dump.moves}, replay=${dump.replay.length}, snaps=${dump.snaps.length})`)
}
