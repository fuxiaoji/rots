"use strict"

// AI vs AI 批量对局运行器（master / erasmus-v2-opt）:
//   1) 多进程并行跑 N 局无头对局, 统计胜负/终局;
//   2) 发现盟军胜局时二次确定性重放, 录制 RTT 兼容的完整对局转储
//      (replay[.setup 首条] + snaps + ai_trace + 终态), 写 tests/results/aivai-win-<seed>.json,
//      供 tools/import-aivai-game.js 直接导入 rots-runtime-pve 数据库复盘。
// 用法(父进程): node tests/aivai-batch.js <count> <baseSeed> [scenario] [jpBot] [apBot] [workers] [tag]
//      worker : node tests/aivai-batch.js --worker <fromSeed> <toSeed> <scenario> <jpBot> <apBot> <outJsonl>

const fs = require("fs")
const path = require("path")
const { spawn } = require("child_process")

const NODE = process.execPath

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

// snap_from_state 复刻(server.js): 去掉 undo, log 换成长度, 返回 JSON 字符串。
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

// 跑一局。record=true 时录制 RTT 转储(replay/snaps/traces/终态)。
function playGame(rules, bots, seed, scenario, options, record, maxActions) {
	let state
	try {
		state = rules.setup(seed, scenario, options)
	} catch (error) {
		return { seed, status: "setup-error", error: error.message }
	}
	const dump = record ? {
		replay: [[null, ".setup", [seed, scenario, options]]],
		snaps: [],     // [replay_id(1-based), snapJson]
		traces: [],    // [replay_id, bot_id, role, policy_version, publicTrace, privateTrace]
		moves: 0,
	} : null
	if (record) {
		// start_game: .setup 后无条件打一个快照(replay_id=1)
		dump.snaps.push([1, snapFromState(state)])
	}
	let actions = 0
	let fallback = 0
	try {
		while (state.active !== "None" && actions < maxActions) {
			const role = activeRole(state)
			if (role !== "Japan" && role !== "Allies") throw new Error(`unexpected active role: ${JSON.stringify(state.active)}`)
			const view = rules.view(state, role)
			const bot = bots[role]
			const decision = bot.decide(view, { role, seed, actionOrdinal: actions + 1 })
			if (!view.actions || !(decision.action in view.actions))
				throw new Error(`illegal policy action ${decision.action} @ ${view.prompt}`)
			if (decision.publicTrace && decision.publicTrace.fallback) ++fallback
			const oldActive = String(state.active)
			state = rules.action(state, role, decision.action, decision.argument)
			++actions
			if (record) {
				const replayId = dump.replay.length + 1
				dump.replay.push([role, decision.action, decision.argument === undefined ? null : decision.argument])
				dump.traces.push([replayId, bot.id || "?", role, bot.version || "?", decision.publicTrace || null, decision.privateTrace || null])
				// put_new_state 快照口径: 终局不快照; multi→multi 不快照; active 未变不快照。
				const nobody = isNobodyActive(state.active)
				if (!nobody) {
					const oldMulti = isMultiActive(oldActive)
					const newMulti = isMultiActive(state.active)
					const changed = String(state.active) !== oldActive
					if (!(oldMulti && newMulti) && changed)
						dump.snaps.push([replayId, snapFromState(state)])
				}
				// moves 口径(put_game_state): 终局 +1, 否则 active 变化 +1。
				if (nobody) dump.moves += 1
				else if (String(state.active) !== oldActive) dump.moves += 1
			}
		}
	} catch (error) {
		return { seed, status: "error", actions, error: error.message }
	}
	if (state.active !== "None")
		return { seed, status: "action-limit", actions }
	const winner = state.result && state.result.won_side ? state.result.won_side : state.result
	const result = { seed, status: "complete", winner, actions, turn: Number(state.turn || 0), fallback }
	if (record) {
		result.dump = dump
		result.finalState = state
		result.won_text = state.result && state.result.won_text ? state.result.won_text
			: (state.L && state.L.message ? state.L.message : null)
		result.politicalWill = Number(state.political_will || 0)
	}
	return result
}

function workerMain() {
	const [, , flag, fromSeed, toSeed, scenario, jpBotName, apBotName, outJsonl, maxActionsArg] = process.argv
	if (flag !== "--worker") throw new Error("bad worker invocation")
	const rules = require(path.join(__dirname, "..", "rules.js"))
	const jpBot = rules.bots[jpBotName]
	const apBot = rules.bots[apBotName]
	if (!jpBot || !apBot) throw new Error(`unknown bot: ${jpBotName} / ${apBotName}`)
	const bots = { Japan: jpBot, Allies: apBot }
	const options = { mode: "aivai", human_role: "Allies", bot_id: apBotName, bot_id_jp: jpBotName, bot_id_ap: apBotName, ai_step: true, headless_moves: true }
	const maxActions = Number(maxActionsArg || 80000)
	const out = fs.createWriteStream(outJsonl, { flags: "a" })
	let line = ""
	for (let seed = Number(fromSeed); seed <= Number(toSeed); ++seed) {
		const first = playGame(rules, bots, seed, scenario, options, false, maxActions)
		process.stderr.write(`\rseed ${seed}: ${first.status} winner=${first.winner ?? "-"} actions=${first.actions} ${" ".repeat(10)}`)
		if (first.status === "complete" && first.winner === "Allies") {
			// 二次确定性重放录制(与 sweep-find-win 同口径); 校验两遍一致才落盘。
			const second = playGame(rules, bots, seed, scenario, options, true, maxActions)
			if (second.status === "complete" && second.winner === "Allies" && second.actions === first.actions) {
				const file = path.join(__dirname, "results", `aivai-win-${seed}.json`)
				const payload = {
					recordedAt: new Date().toISOString(),
					scenario, seed, bots: { Japan: jpBotName, Allies: apBotName }, options,
					winner: second.winner, won_text: second.won_text, turn: second.turn,
					politicalWill: second.politicalWill, actions: second.actions,
					replay: second.dump.replay, snaps: second.dump.snaps,
					traces: second.dump.traces, moves: second.dump.moves,
					finalState: second.finalState,
				}
				fs.writeFileSync(file, JSON.stringify(payload))
				out.write(JSON.stringify({ seed, status: "complete", winner: "Allies", actions: second.actions, turn: second.turn, won_text: second.won_text, saved: file }) + "\n")
				process.stderr.write(`  *** ALLIES WIN seed ${seed} (T${second.turn}) → ${file} ***\n`)
			} else {
				out.write(JSON.stringify({ seed, status: "diverged", first, second: { winner: second.winner, actions: second.actions, status: second.status } }) + "\n")
				process.stderr.write(`  !! divergence on win seed ${seed}: pass2=${second.status}/${second.winner}\n`)
			}
		} else {
			const brief = { ...first }
			delete brief.dump
			out.write(JSON.stringify(brief) + "\n")
		}
		line = ""
	}
	out.end()
	process.stderr.write("\nworker done\n")
}

// 单局录制(不限胜负, 供导入管线联调): node tests/aivai-batch.js --record-one <seed> [scenario] [jpBot] [apBot]
function recordOneMain() {
	const seed = Number(process.argv[3])
	const scenario = String(process.argv[4] || "1942-1945 (The Shortened Campaign)")
	const jpBotName = String(process.argv[5] || "erasmus-v2-opt")
	const apBotName = String(process.argv[6] || "erasmus-v2-opt")
	const rules = require(path.join(__dirname, "..", "rules.js"))
	const jpBot = rules.bots[jpBotName]
	const apBot = rules.bots[apBotName]
	const options = { mode: "aivai", human_role: "Allies", bot_id: apBotName, bot_id_jp: jpBotName, bot_id_ap: apBotName, ai_step: true, headless_moves: true }
	const result = playGame(rules, { Japan: jpBot, Allies: apBot }, seed, scenario, options, true, 80000)
	const file = path.join(__dirname, "results", `aivai-win-${seed}.json`)
	fs.writeFileSync(file, JSON.stringify({
		recordedAt: new Date().toISOString(),
		scenario, seed, bots: { Japan: jpBotName, Allies: apBotName }, options,
		winner: result.winner, won_text: result.won_text, turn: result.turn,
		politicalWill: result.politicalWill, actions: result.actions,
		replay: result.dump.replay, snaps: result.dump.snaps, traces: result.dump.traces,
		moves: result.dump.moves, finalState: result.finalState,
	}))
	console.log(`seed ${seed}: ${result.status} winner=${result.winner} T${result.turn} actions=${result.actions} → ${file}`)
}

function parentMain() {
	const count = Number(process.argv[2] || 300)
	const baseSeed = Number(process.argv[3] || 20260910)
	const scenario = String(process.argv[4] || "1942-1945 (The Shortened Campaign)")
	const jpBotName = String(process.argv[5] || "erasmus-v2-opt")
	const apBotName = String(process.argv[6] || "erasmus-v2-opt")
	const workers = Math.max(1, Number(process.argv[7] || 4))
	const tag = String(process.argv[8] || "batch" + count).replace(/[^\w-]+/g, "-")
	const maxActions = Number(process.argv[9] || 80000)

	const resultsDir = path.join(__dirname, "results")
	fs.mkdirSync(resultsDir, { recursive: true })
	const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15)
	const jsonlFiles = []
	const children = []
	const slices = []
	for (let w = 0; w < workers; ++w) slices.push([])
	for (let i = 0; i < count; ++i) slices[i % workers].push(baseSeed + i)

	for (let w = 0; w < workers; ++w) {
		if (!slices[w].length) continue
		const outJsonl = path.join(resultsDir, `_aivai-${tag}-w${w}.jsonl`)
		jsonlFiles.push(outJsonl)
		fs.rmSync(outJsonl, { force: true })
		const child = spawn(NODE, [__filename, "--worker", String(slices[w][0]), String(slices[w][slices[w].length - 1]),
			scenario, jpBotName, apBotName, outJsonl, String(maxActions)], { stdio: ["ignore", "inherit", "inherit"] })
		children.push(child)
	}
	let failed = 0
	for (const child of children) child.on("exit", code => { if (code !== 0) ++failed })
	let done = 0
	Promise.all(children.map(c => new Promise(res => c.on("exit", res)))).then(() => {
		const games = []
		for (const file of jsonlFiles)
			for (const line of fs.readFileSync(file, "utf8").split("\n"))
				if (line.trim()) { try { games.push(JSON.parse(line)) } catch (_) {} }
		games.sort((a, b) => a.seed - b.seed)
		const complete = games.filter(g => g.status === "complete")
		const summary = {
			scenario, gameCount: count, baseSeed,
			bots: { Japan: jpBotName, Allies: apBotName }, maxActions, workers, failedWorkers: failed,
			complete: complete.length,
			japanWins: complete.filter(g => g.winner === "Japan").length,
			alliesWins: complete.filter(g => g.winner === "Allies").length,
			otherWins: complete.filter(g => !["Japan", "Allies"].includes(g.winner)).length,
			errors: games.filter(g => g.status === "error" || g.status === "setup-error").length,
			actionLimits: games.filter(g => g.status === "action-limit").length,
			diverged: games.filter(g => g.status === "diverged").length,
			savedWins: complete.filter(g => g.winner === "Allies" && g.saved).map(g => ({ seed: g.seed, turn: g.turn, won_text: g.won_text, file: g.saved })),
		}
		const summaryFile = path.join(resultsDir, `aivai-${tag}-${stamp}-summary.json`)
		fs.writeFileSync(summaryFile, JSON.stringify({ summary, games }, null, 1))
		console.log(JSON.stringify(summary, null, 1))
		console.log("summary →", summaryFile)
		if (summary.alliesWins === 0) console.log("NO ALLIED WINS in this batch.")
		process.exit(failed ? 1 : 0)
	})
}

if (process.argv[2] === "--worker") workerMain()
else if (process.argv[2] === "--record-one") recordOneMain()
else parentMain()
