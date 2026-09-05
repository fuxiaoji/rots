"use strict"

const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "../..")
const chartsPath = path.join(root, "data/erasmus/charts.json")
const jsonPath = path.join(root, "data/erasmus/node-implementation-map.json")
const mdPath = path.join(root, "docs/architecture/erasmus-node-implementation-map.md")

const document = JSON.parse(fs.readFileSync(chartsPath, "utf8"))

function handlerFor(chart, node) {
	const base = {
		status: "implemented-by-family",
		entry: "js/server/bots/erasmus.js:evaluateChart",
		detail: "图解释器按显式边推进，并在返回前校验 view.actions。",
	}

	if (node.type === "start" || node.type === "terminal" || node.type === "fallback")
		return base

	if (node.type === "dice") return {
		status: "implemented-generic",
		entry: "js/server/bots/erasmus.js:evaluateChart",
		detail: "以 seed、动作序号、图表、节点和骰表派生确定性 D10（0–9），由骰点边选择后继。",
	}

	if (chart.kind === "decision-axis") return {
		status: "implemented-specialized",
		entry: `js/server/erasmus_state.js:${chart.role === "Japan" ? "esm_jp_eval_" : "esm_al_eval_"}${chart.phase === "middle" ? "mid" : chart.phase === "end" ? "late" : "early"}`,
		detail: node.type === "condition"
			? `专用战略轴求值器计算 ${node.predicate?.id || "条件"}，并把实际节点写入轨迹。`
			: "战略出口绑定策略库、有序目标链和卡牌意图。",
	}

	if (chart.kind === "card-selection") return {
		status: "implemented-specialized",
		entry: node.type === "process"
			? "js/server/erasmus_state.js:classifyCards"
			: "js/server/erasmus_state.js:esm_card_selection_tree",
		detail: node.type === "action"
			? "把图表出口翻译为 event/ops/future-offensive/pass 意图，再由 esm_card_window_action 选择合法卡牌。"
			: "用己方手牌元数据计算条件；不读取对手手牌。",
	}

	if (chart.kind === "task-force") return {
		status: "implemented-specialized",
		entry: node.type === "condition"
			? "js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility"
			: "js/server/erasmus_ops.js:composeTaskForce",
		detail: node.type === "action" || node.type === "process"
			? "按目标性质、兵种、伤害标准、潜在反应、HQ守卫和剩余激活量选择最少但足够的合法单位。"
			: `从阵营视图派生 ${node.predicate?.id || "条件"}，图解释器选择 true/false 边。`,
	}

	if (chart.kind === "reaction") return {
		status: "implemented-specialized",
		entry: /PBM/.test(node.id)
			? "js/server/erasmus_ops.js:planPostBattleMovement + js/server/offensive.js:erasmus_pbm_target_score"
			: "js/server/erasmus_ops.js:planReaction",
		detail: /PBM/.test(node.id)
			? "按航空、海军、失败两栖三条独立 PBM 优先级选择合法单位和目的地。"
			: "按天气、情报、特殊反应、反应战斗格和兵力标准选择合法动作。",
	}

	return base
}

const rows = []
for (const chart of document.charts) {
	for (const node of chart.nodes) {
		const handler = handlerFor(chart, node)
		rows.push({
			chart_id: chart.id,
			page: chart.source_page,
			role: chart.role,
			phase: chart.phase,
			kind: chart.kind,
			node_id: node.id,
			node_type: node.type,
			label_zh: node.label_zh || "",
			predicate_id: node.predicate?.id || "",
			strategy_id: typeof node.action === "string" ? node.action : "",
			status: handler.status,
			implementation_entry: handler.entry,
			implementation_detail: handler.detail,
		})
	}
}

const counts = rows.reduce((out, row) => {
	out[row.status] = (out[row.status] || 0) + 1
	return out
}, {})

const output = {
	schema_version: 1,
	policy_version: document.policy_version,
	generated_from: "data/erasmus/charts.json",
	note: "这是逻辑实现映射，不是 PDF 视觉坐标。视觉坐标由 node-regions.csv 人工回填。",
	summary: { charts: document.charts.length, nodes: rows.length, by_status: counts },
	nodes: rows,
}
fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2) + "\n")

const lines = [
	"# 伊拉斯谟节点到引擎实现映射",
	"",
	"> 本文件由 `node tools/rules/build_erasmus_implementation_map.js` 生成。它回答‘逻辑节点由哪段代码执行’，不替代 PDF 节点视觉坐标。坐标请填写 `docs/rules/normalized/erasmus-v2-zh-charts/node-regions.csv`。",
	"",
	`- 策略版本：\`${document.policy_version}\``,
	`- 图表：${document.charts.length} 张`,
	`- 节点：${rows.length} 个`,
	`- 实现分类：${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join("，")}`,
	"",
	"## 执行链",
	"",
	"`规则状态 → rules.view(role) → view.ai 派生字段/谓词 → 图表或专用求值器 → 候选过滤/排序 → view.actions 合法性校验 → rules.action → 回放与 AI trace`",
	"",
]

for (const chart of document.charts) {
	lines.push(`## 第 ${chart.source_page} 页 · ${chart.id}`)
	lines.push("")
	lines.push("| 节点 | 类型 | 谓词/策略 | 中文标签 | 实现入口 | 状态 |")
	lines.push("|---|---|---|---|---|---|")
	for (const row of rows.filter(item => item.chart_id === chart.id)) {
		const semantic = row.predicate_id || row.strategy_id || "—"
		const label = row.label_zh.replace(/\|/g, "\\|").replace(/\r?\n/g, " ") || "—"
		lines.push(`| ${row.node_id} | ${row.node_type} | ${semantic} | ${label} | ${row.implementation_entry} | ${row.status} |`)
	}
	lines.push("")
}

lines.push("## 状态含义")
lines.push("")
lines.push("- `implemented-specialized`：该图表族有专用谓词、策略或动作规划器。")
lines.push("- `implemented-generic`：由通用确定性骰表/图遍历代码执行。")
lines.push("- `implemented-by-family`：开始、终点和保护出口由图表族公共解释逻辑执行。")
lines.push("")
lines.push("此映射只证明调用路径存在，不单独证明语义与纸面图表完全相同。语义正确性仍由逐节点黄金测试、来源脚注和实战轨迹共同验收。")
lines.push("")
fs.mkdirSync(path.dirname(mdPath), { recursive: true })
fs.writeFileSync(mdPath, lines.join("\n"))

console.log(`wrote ${path.relative(root, jsonPath)} (${rows.length} nodes)`)
console.log(`wrote ${path.relative(root, mdPath)}`)
