"use strict"

// 导出本地 RTT 对局的可审计 AI 日志。用法：
// node tools/audit-rtt-game.js <db> <game-id> <output-prefix> [runtime-dir]
// 生成：<prefix>.summary.json（关键指标）与 <prefix>.public.json.gz（完整回放+公开轨迹）。

const fs = require("fs")
const path = require("path")
const zlib = require("zlib")

const [dbFile, gameText, outputPrefix, runtimeDir = path.dirname(dbFile || "")] = process.argv.slice(2)
if (!dbFile || !gameText || !outputPrefix) {
    console.error("usage: node tools/audit-rtt-game.js <db> <game-id> <output-prefix> [runtime-dir]")
    process.exit(2)
}
const BetterSqlite3 = require(path.join(path.resolve(runtimeDir), "node_modules", "better-sqlite3"))
const db = new BetterSqlite3(path.resolve(dbFile), { readonly: true })
const gameId = Number(gameText)
const parse = text => { try { return JSON.parse(text) } catch (_) { return null } }
const replay = db.prepare("select replay_id,role,action,arguments from game_replay where game_id=? order by replay_id").all(gameId)
    .map(row => ({ ...row, arguments: parse(row.arguments) }))
const traces = db.prepare("select replay_id,role,bot_id,policy_version,public_trace from game_ai_trace where game_id=? order by replay_id").all(gameId)
    .map(row => ({ ...row, public_trace: parse(row.public_trace) }))
const snap = db.prepare("select replay_id,state from game_snap where game_id=? order by replay_id desc limit 1").get(gameId)
const state = snap ? parse(snap.state) : null

const inc = (obj, key) => { const k = String(key ?? "(none)"); obj[k] = (obj[k] || 0) + 1 }
const summary = {
    gameId,
    exportedAt: new Date().toISOString(),
    replayCount: replay.length,
    traceCount: traces.length,
    latestReplay: snap?.replay_id ?? null,
    turn: state?.turn ?? null,
    active: state?.active ?? null,
    result: state?.result ?? state?.victory ?? null,
    policyVersions: {}, roles: {}, strategies: {}, windows: {}, actions: {},
    firstPriorityTargets: {},
    minimumAlliedUnitDistanceToTokyo: null,
    minimumAlliedControlledDistanceToTokyo: null,
    minimumB29DistanceToTokyo: null,
    turns: {},
}
for (const row of traces) {
    const t = row.public_trace || {}, sm = t.sm || {}
    inc(summary.policyVersions, row.policy_version)
    inc(summary.roles, row.role)
    inc(summary.actions, t.action)
    inc(summary.windows, t.windowKind || sm.windowKind)
    inc(summary.strategies, `${row.role}:${sm.strategy || t.strategy}`)
    const head = Array.isArray(sm.priorityTargets) ? sm.priorityTargets[0] : null
    if (head) inc(summary.firstPriorityTargets, `${head.name || head.id || head.hex}:${head.objective || ""}`)
    const d = sm.diag || {}, adv = d.advance || {}
    const takeMin = (key, value) => {
        if (!Number.isFinite(value)) return
        summary[key] = summary[key] === null ? value : Math.min(summary[key], value)
    }
    takeMin("minimumAlliedUnitDistanceToTokyo", adv.closestAlliedUnit?.distance)
    takeMin("minimumAlliedControlledDistanceToTokyo", adv.closestAlliedControlledHex?.distance)
    takeMin("minimumB29DistanceToTokyo", adv.closestB29?.distance)
    if (Number.isInteger(d.turn)) summary.turns[d.turn] = {
        jpResources: d.jpRes ?? d.atomic?.jpResources ?? null,
        jpResourceHexes: d.resHexes ?? d.atomic?.jpResourceHexes ?? [],
        politicalWill: sm.powEmergency?.politicalWill ?? null,
        powRequired: d.pow ?? sm.progressPlan?.required ?? null,
        powBank: d.bank ?? sm.progressPlan?.bank ?? null,
        alliedUnitDistanceToTokyo: adv.closestAlliedUnit?.distance ?? null,
        alliedControlledDistanceToTokyo: adv.closestAlliedControlledHex?.distance ?? null,
        b29DistanceToTokyo: adv.closestB29?.distance ?? null,
        philippinesSurrendered: d.openingSurrender?.philippines ?? null,
        deiSurrendered: d.openingSurrender?.dei ?? null,
    }
}

const prefix = path.resolve(outputPrefix)
fs.mkdirSync(path.dirname(prefix), { recursive: true })
fs.writeFileSync(`${prefix}.summary.json`, JSON.stringify(summary, null, 2) + "\n")
const raw = Buffer.from(JSON.stringify({ gameId, replay, traces }))
fs.writeFileSync(`${prefix}.public.json.gz`, zlib.gzipSync(raw, { level: 9 }))
console.log(JSON.stringify({ summary: `${prefix}.summary.json`, archive: `${prefix}.public.json.gz`, rawBytes: raw.length }, null, 2))
