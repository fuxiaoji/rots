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

console.log("ERASMUS graph and deterministic policy tests passed")

