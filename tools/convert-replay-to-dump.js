"use strict"

// 把 replay-win-*.json(仅动作序列) 转换为 import-aivai-game.js 需要的完整转储:
// 重放每步动作(校验合法性/active 角色一致), 按 server 口径采集快照与终态,
// 并校验终局与录制一致。用法:
//   node tools/convert-replay-to-dump.js <replay-win.json> [out-dump.json]

const fs = require("fs")
const path = require("path")
const rules = require(path.join(__dirname, "..", "rules.js"))

const srcFile = process.argv[2]
if (!srcFile) {
	console.error("usage: node tools/convert-replay-to-dump.js <replay-win.json> [out-dump.json]")
	process.exit(2)
}
const outDump = process.argv[3] || srcFile.replace(/\.json$/, "") + ".dump.json"
const replayWin = JSON.parse(fs.readFileSync(srcFile, "utf8"))

function activeRole(state) {
	return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
}
function isNobodyActive(active) {
	return !active || active === "None"
}
function isMultiActive(active) {
	if (!active) return false
	if (Array.isArray(active)) return true
	return active === "Both" || active.includes(",")
}
function snapFromState(state) {
	const saveUndo = state.undo
	const saveLog = state.log
	state.undo = undefined
	state.log = saveLog.length
	const snap = JSON.stringify(state)
	state.undo = saveUndo
	state.log = saveLog
	return snap
}

const scenario = replayWin.scenario
const seed = replayWin.seed
const jpBot = replayWin.bots && replayWin.bots.Japan || "erasmus-v2-opt"
const apBot = replayWin.bots && replayWin.bots.Allies || "erasmus-v2-opt"
const options = { mode: "aivai", human_role: "Allies", bot_id: apBot, bot_id_jp: jpBot, bot_id_ap: apBot, ai_step: true, headless_moves: true }

let state = rules.setup(seed, scenario, options)
const dump = {
	recordedAt: new Date().toISOString(),
	convertedFrom: path.basename(srcFile), originalRecordedAt: replayWin.recordedAt,
	scenario, seed, bots: { Japan: jpBot, Allies: apBot }, options,
	winner: null, won_text: null, turn: Number(state.turn || 0),
	politicalWill: null, actions: 0, moves: 0,
	replay: [[null, ".setup", [seed, scenario, options]]],
	snaps: [[1, snapFromState(state)]], traces: [],
}
let mismatches = 0
for (let i = 0; i < replayWin.actions.length; ++i) {
	const a = replayWin.actions[i]
	const role = activeRole(state)
	if (state.active === "None") { console.error(`action ${i + 1} but game already finished`); process.exit(1) }
	if (a.role && a.role !== role) { console.error(`action ${i + 1}: recorded role ${a.role} != active ${role}`); process.exit(1) }
	const view = rules.view(state, role)
	if (!view.actions || !(a.action in view.actions)) {
		console.error(`action ${i + 1} illegal: ${a.action} @ ${view.prompt}`)
		process.exit(1)
	}
	const oldActive = String(state.active)
	const args = a.arguments === undefined ? a.argument : a.arguments
	state = rules.action(state, role, a.action, args === undefined ? null : args)
	const replayId = dump.replay.length + 1
	dump.replay.push([role, a.action, args === undefined ? null : args])
	dump.turn = Math.max(dump.turn, Number(state.turn || 0))
	if (!isNobodyActive(state.active)) {
		const changed = String(state.active) !== oldActive
		if (!(isMultiActive(oldActive) && isMultiActive(state.active)) && changed)
			dump.snaps.push([replayId, snapFromState(state)])
		dump.moves += changed ? 1 : 0
	} else {
		dump.moves += 1
	}
	dump.actions = i + 1
}
if (state.active !== "None") { console.error("recorded actions did not finish the game"); process.exit(1) }
dump.winner = state.result && state.result.won_side ? state.result.won_side : state.result
dump.won_text = (state.result && state.result.won_text) || (state.L && state.L.message) || null
dump.politicalWill = Number(state.political_will || 0)
if (dump.winner !== replayWin.winner) {
	console.error(`WINNER MISMATCH: recorded ${replayWin.winner}, replay ${dump.winner} (actions=${dump.actions})`)
	mismatches = 1
}
fs.writeFileSync(outDump, JSON.stringify(dump))
console.log(`${path.basename(srcFile)} → ${path.basename(outDump)} | actions=${dump.actions} snaps=${dump.snaps.length} | winner=${dump.winner} T${dump.turn} (${dump.won_text})${mismatches ? " [MISMATCH]" : " [verified]"}`)
process.exit(mismatches)
