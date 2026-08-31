"use strict"

const assert = require("assert")
const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "..")
const graphs = JSON.parse(fs.readFileSync(path.join(root, "data/erasmus/charts.json"), "utf8"))
assert.equal(graphs.charts.length, 12)
assert.deepEqual(new Set(graphs.charts.map(chart => chart.source_page)), new Set(Array.from({ length: 12 }, (_, i) => i + 1)))
for (const chart of graphs.charts) {
	const ids = new Set(chart.nodes.map(node => node.id))
	assert.equal(ids.size, chart.nodes.length, `${chart.id}: duplicate node`)
	for (const node of chart.nodes)
		for (const edge of [node.on_true, node.on_false].filter(Boolean))
			assert(ids.has(edge), `${chart.id}: dangling edge ${edge}`)
}

const rules = require(path.join(root, "rules.js"))
const bot = rules.bots["erasmus-v2"]
assert(bot)
for (const role of ["Japan", "Allies"]) {
	const view = { turn: 3, prompt: "Select card to play.", actions: { card: [12, 4, 8], pass: 1, undo: 1 } }
	const context = { role, seed: 12345, actionOrdinal: 7 }
	const first = bot.decide(view, context)
	const second = bot.decide(view, context)
	assert.deepEqual(first, second)
	assert(Object.prototype.hasOwnProperty.call(view.actions, first.action))
	assert(view.actions[first.action].includes(first.argument))
	assert.equal(first.publicTrace.fallback, false)
}

// Operation KE previously entered a dead state when the selected coastal hex had
// no eligible evacuation units. Keep the original failing seed as a full-game regression.
{
	const seed = 424243
	let state = rules.setup(seed, "South Pacific", {})
	let ordinal = 0
	while (state.active !== "None" && ordinal < 1000) {
		const role = Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
		const view = rules.view(state, role)
		const decision = bot.decide(view, { role, seed, actionOrdinal: ++ordinal })
		assert(Object.prototype.hasOwnProperty.call(view.actions, decision.action), `illegal action at ${ordinal}`)
		state = rules.action(state, role, decision.action, decision.argument)
	}
	assert.equal(state.active, "None", "Operation KE regression seed must reach a normal ending")
	assert(ordinal < 1000, "Operation KE regression seed exceeded the action guard")
}

console.log("ERASMUS graph and deterministic policy tests passed")
