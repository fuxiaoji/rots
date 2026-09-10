"use strict"

// 将 tests/results/replay-win-*.json 导入本地 RTT 服务器数据库复盤。
// 用法: node tools/import-replay-to-rtt.js <rtt-runtime-dir> <db-file> <replay-json> [game-name]
//   rtt-runtime-dir: 含 node_modules(better-sqlite3) 的 RTT 平台目录(如 Windows 的 rots-runtime-pve)
//   db-file: RTT 的 SQLite 数据库文件(默认 db)
// 说明: RTT 以"当前游戏模块代码"从头重放动作序列; 录制文件内含 codeNote 与 seed,
//       请确保服务器上的 rots 模块与录制时的工作区版本一致(见文件 commit/codeNote 字段)。
const fs = require("fs")
const path = require("path")

const [runtimeDir, dbFile, replayFile, gameNameArg] = process.argv.slice(2)
if (!runtimeDir || !dbFile || !replayFile) {
    console.error("usage: node tools/import-replay-to-rtt.js <rtt-runtime-dir> <db> <replay-json> [game-name]")
    process.exit(2)
}
const BetterSqlite3 = require(path.join(path.resolve(runtimeDir), "node_modules", "better-sqlite3"))
const replay = JSON.parse(fs.readFileSync(replayFile, "utf8"))
const db = new BetterSqlite3(path.resolve(dbFile))

const gameName = gameNameArg || `复盘: 盟军原子弹胜局 seed ${replay.seed} (T${replay.turn})`
// games 表字段以 RTT schema 为准; 只写最小可玩集, 其余字段让 RTT 默认。
const info = db.prepare(`insert into games (name, scenario, created_at) values (?, ?, datetime('now'))`)
    .run(gameName, replay.scenario)
const gameId = info.lastInsertRowid

const insert = db.prepare(`insert into game_replay (game_id, replay_id, role, action, arguments) values (?, ?, ?, ?, ?)`)
const tx = db.transaction(() => {
    replay.actions.forEach((a, i) => {
        insert.run(gameId, i + 1, a.role, a.action, JSON.stringify(a.arguments))
    })
})
tx()

const snap = db.prepare(`select count(*) as n from game_replay where game_id=?`).get(gameId)
console.log(`imported game ${gameId}: "${gameName}" | ${snap.n} actions | winner(录制时): ${replay.winner} T${replay.turn}`)
console.log(`在 RTT 界面打开该对局即可逐步复盤; 若行动与当前模块版本不兼容, 请检出录制时的代码版本。`)
