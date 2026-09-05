"use strict"

const assert = require("assert")
const charts = require("../data/erasmus/charts.json")
const implementationMap = require("../data/erasmus/node-implementation-map.json")

const chartNodes = charts.charts.flatMap(chart => chart.nodes.map(node => `${chart.id}:${node.id}`))
const mappedNodes = implementationMap.nodes.map(node => `${node.chart_id}:${node.node_id}`)

assert.strictEqual(implementationMap.policy_version, charts.policy_version, "implementation map policy is stale")
assert.strictEqual(mappedNodes.length, chartNodes.length, "implementation map node count differs from charts")
assert.strictEqual(new Set(mappedNodes).size, mappedNodes.length, "implementation map contains duplicate nodes")
assert.deepStrictEqual(mappedNodes.slice().sort(), chartNodes.slice().sort(), "implementation map misses or invents chart nodes")

for (const node of implementationMap.nodes) {
	assert(node.implementation_entry, `${node.chart_id}/${node.node_id} has no implementation entry`)
	assert(node.status.startsWith("implemented-"), `${node.chart_id}/${node.node_id} has unaudited status ${node.status}`)
}

console.log(`Erasmus implementation map passed: ${mappedNodes.length} nodes`)
