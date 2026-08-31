"use strict"

const fs = require("fs")
const path = require("path")
const rules = require("../rules.js")

const gameCount = Number(process.argv[2] || 50)
const baseSeed = Number(process.argv[3] || 424242)
const maxActions = Number(process.argv[4] || 20000)
const policy = rules.bots["erasmus-v2"]

if (!Number.isInteger(gameCount) || gameCount < 1)
	throw new Error("game count must be a positive integer")

function activeRole(state) {
	if (Array.isArray(state.active))
		return state.active.slice().sort()[0]
	return state.active
}

function play(seed) {
	let state = rules.setup(seed, "South Pacific", {})
	let actions = 0
	let fallback = 0
	let lastTurn = Number(state.turn || 0)
	const roleActions = { Japan: 0, Allies: 0 }
	let lastDecisionContext = null

	try {
		while (state.active !== "None" && actions < maxActions) {
			const role = activeRole(state)
			if (role !== "Japan" && role !== "Allies")
				throw new Error(`unexpected active role: ${JSON.stringify(state.active)}`)
			const view = rules.view(state, role)
			lastDecisionContext = { role, prompt: view.prompt, actions: view.actions }
			const decision = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
			if (!view.actions || !(decision.action in view.actions))
				throw new Error(`illegal policy action: ${decision.action}`)
			if (decision.publicTrace.fallback) ++fallback
			state = rules.action(state, role, decision.action, decision.argument)
			++roleActions[role]
			++actions
			lastTurn = Math.max(lastTurn, Number(state.turn || 0))
		}
	} catch (error) {
		return { seed, status: "error", winner: null, actions, turn: lastTurn, fallback, roleActions, error: error.message, context: lastDecisionContext }
	}

	if (state.active !== "None")
		return { seed, status: "action-limit", winner: null, actions, turn: lastTurn, fallback, roleActions }
	return {
		seed, status: "complete", winner: state.result || null, actions, turn: lastTurn, fallback, roleActions,
		message: state.L?.message || state.log?.[state.log.length - 1] || null,
	}
}

const games = []
for (let index = 0; index < gameCount; ++index) {
	const result = play(baseSeed + index)
	games.push(result)
	process.stderr.write(`\r${index + 1}/${gameCount} ${result.status} seed=${result.seed} actions=${result.actions} turn=${result.turn}   `)
}
process.stderr.write("\n")

const summary = {
	policy: policy.version,
	scenario: "South Pacific",
	gameCount,
	baseSeed,
	maxActions,
	complete: games.filter(game => game.status === "complete").length,
	japanWins: games.filter(game => game.status === "complete" && game.winner === "Japan").length,
	alliesWins: games.filter(game => game.status === "complete" && game.winner === "Allies").length,
	draws: games.filter(game => game.status === "complete" && !["Japan", "Allies"].includes(game.winner)).length,
	actionLimit: games.filter(game => game.status === "action-limit").length,
	errors: games.filter(game => game.status === "error").length,
	fallbackActions: games.reduce((sum, game) => sum + game.fallback, 0),
	averageActions: games.reduce((sum, game) => sum + game.actions, 0) / games.length,
	averageTurn: games.reduce((sum, game) => sum + game.turn, 0) / games.length,
}

const output = { generatedAt: new Date().toISOString(), summary, games }
const outputPath = path.join(__dirname, "results", `erasmus-selfplay-${gameCount}-${baseSeed}.json`)
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n")
console.log(JSON.stringify(summary, null, 2))
console.log(outputPath)
