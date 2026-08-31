"use strict"

const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "../..")
const chartDir = path.join(root, "docs/rules/normalized/erasmus-v2-zh-charts/charts")
const output = path.join(root, "data/erasmus/charts.json")

const definitions = [
	[1, "Japan", "early", "decision-axis"], [2, "Japan", "middle", "decision-axis"],
	[3, "Japan", "end", "decision-axis"], [4, "Japan", "all", "card-selection"],
	[5, "Japan", "all", "task-force"], [6, "Japan", "all", "reaction"],
	[7, "Allies", "early", "decision-axis"], [8, "Allies", "middle", "decision-axis"],
	[9, "Allies", "end", "decision-axis"], [10, "Allies", "all", "card-selection"],
	[11, "Allies", "all", "task-force"], [12, "Allies", "all", "reaction"],
]

const files = fs.readdirSync(chartDir).filter(name => /^\d\d-.*\.md$/.test(name)).sort()
const charts = definitions.map(([page, role, phase, kind]) => {
	const filename = files[page - 1]
	if (!filename) throw new Error(`missing page ${page}`)
	const text = fs.readFileSync(path.join(chartDir, filename), "utf8")
	const sourceLines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith(">"))
	const conditionLines = sourceLines.filter(line => /^[A-L][.．]/.test(line))
	const chartId = `ERASMUS-${role === "Japan" ? "JP" : "AP"}-${String(page).padStart(2, "0")}`
	const nodes = [{
		id: `${chartId}-START`, type: "start", condition: "enter when role, phase and action family match",
		on_true: conditionLines.length ? `${chartId}-COND-A` : `${chartId}-POLICY`, source_page: page,
	}]
	conditionLines.forEach((line, index) => {
		const letter = String.fromCharCode(65 + index)
		nodes.push({
			id: `${chartId}-COND-${letter}`, type: "condition", text: line,
			on_true: `${chartId}-POLICY`,
			on_false: index + 1 < conditionLines.length ? `${chartId}-COND-${String.fromCharCode(66 + index)}` : `${chartId}-POLICY`,
			source_page: page,
		})
	})
	nodes.push({
		id: `${chartId}-POLICY`, type: "priority", condition: "select only from legal actions using source-page priorities",
		on_true: `${chartId}-END`, on_false: `${chartId}-FALLBACK`, source_page: page,
	})
	nodes.push({ id: `${chartId}-FALLBACK`, type: "guard", condition: "no chart candidate is legal", on_true: `${chartId}-END`, source_page: page })
	nodes.push({ id: `${chartId}-END`, type: "terminal", source_page: page })
	return {
		id: chartId, role, phase, kind, source_page: page,
		source_markdown: path.relative(root, path.join(chartDir, filename)).replace(/\\/g, "/"),
		rules: kind === "task-force" ? ["EOTS-7", "EOTS-8", "EOTS-9"] : ["EOTS-5", "EOTS-7"],
		nodes, source_lines: sourceLines,
	}
})

const document = {
	schema_version: 1,
	policy_version: "erasmus-v2.0-zh.1",
	source: "伊拉斯谟v2.0_图表汉化.pdf",
	charts,
}
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, JSON.stringify(document, null, 2) + "\n")

