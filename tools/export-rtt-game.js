"use strict"

// 导出 RTT 本地数据库中的对局为紧凑 JSON 牌谱(供 GitHub 存档/复盘):
//   存 .setup 参数(seed/剧本/options) + 完整动作序列 + 终局摘要 + 终态(gzip),
//   不存逐步快照(snaps 太大); 任何一局都可用 seed+actions 在 rules.js 下确定性重放。
// 用法: node tools/export-rtt-game.js <runtimeDir> <outDir> [--min-moves N] [--gz-state]
//   默认导出 moves >= 1 的全部对局; --gz-state 把终态压成 .gz(推荐)。

const fs = require("fs")
const path = require("path")
const zlib = require("zlib")

const args = process.argv.slice(2)
const runtimeDir = path.resolve(args[0] || ".")
const outDir = path.resolve(args[1] || "replays")
let minMoves = 1
let gzState = false
for (let i = 2; i < args.length; ++i) {
    if (args[i] === "--min-moves") minMoves = Number(args[++i]) || 1
    if (args[i] === "--gz-state") gzState = true
}
const BetterSqlite3 = require(path.join(runtimeDir, "node_modules", "better-sqlite3"))
const db = new BetterSqlite3(path.join(runtimeDir, "db"), { readonly: true })

const games = db.prepare("select game_id,owner_id,scenario,status,result,moves,options,notice,ctime,mtime from games order by game_id").all()
fs.mkdirSync(outDir, { recursive: true })
const users = Object.fromEntries(db.prepare("select user_id,name from users").all().map(u => [u.user_id, u.name]))
const index = []

for (const g of games) {
    if ((g.moves | 0) < minMoves) continue
    const options = JSON.parse(g.options || "{}")
    const players = db.prepare("select role,user_id,bot_id from players where game_id=?").all(g.game_id)
        .map(p => ({ role: p.role, user: users[p.user_id] || ("user" + p.user_id), bot_id: p.bot_id || null }))
    const replay = db.prepare("select replay_id,role,action,arguments from game_replay where game_id=? order by replay_id").all(g.game_id)
    const stateRow = db.prepare("select state from game_state where game_id=?").pluck().get(g.game_id)
    let setup = null, actions = []
    for (const r of replay) {
        if (r.action === ".setup") { setup = JSON.parse(r.arguments); continue }
        actions.push([r.role, r.action, r.arguments === null ? null : JSON.parse(r.arguments)])
    }
    let state = null
    if (stateRow) {
        try {
            const s = JSON.parse(stateRow)
            s.undo = undefined
            if (gzState) {
                fs.writeFileSync(path.join(outDir, `game-${g.game_id}.state.json.gz`), zlib.gzipSync(JSON.stringify(s)))
            } else {
                state = s
            }
        } catch (e) { /* 状态缺失时跳过 */ }
    }
    const dump = {
        gameId: g.game_id, exportedAt: new Date().toISOString(),
        titleId: "empire-of-the-sun", scenario: g.scenario,
        status: g.status, result: g.result, moves: g.moves,
        created: g.ctime, finished: g.status === 2 ? g.mtime : null,
        mode: options.mode || "pvp", options, players,
        setup: setup ? { seed: setup[0], scenario: setup[1], options: setup[2] } : null,
        replayActions: actions,
        state: gzState ? undefined : state,
        stateGz: gzState ? `game-${g.game_id}.state.json.gz` : undefined,
    }
    const file = path.join(outDir, `game-${g.game_id}.json`)
    fs.writeFileSync(file, JSON.stringify(dump))
    index.push({ gameId: g.game_id, scenario: g.scenario, mode: dump.mode, result: g.result, turn: state ? state.turn : null, moves: g.moves, created: g.ctime, players, file: path.basename(file) })
    console.log(`#${g.game_id} ${g.scenario.slice(0, 32)} | ${dump.mode} | ${g.result || "进行中"} | moves=${g.moves} → ${path.basename(file)} (${(fs.statSync(file).size / 1024).toFixed(0)} KB${gzState ? " + state.gz" : ""})`)
}
fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify({ exportedAt: new Date().toISOString(), source: "rots-runtime-pve/db", games: index }, null, 1))
console.log(`\n共 ${index.length} 局 → ${outDir} (index.json 已更新)`)
