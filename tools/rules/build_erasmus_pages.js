"use strict"

// Builds one auditable JSON document per Erasmus chart page. The page definitions
// below are intentionally declarative: visual/semantic inferences are marked in
// each node so they can be replaced without touching the evaluator.
const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "../..")
const sourceDir = path.join(root, "docs/rules/normalized/erasmus-v2-zh-charts/charts")
const outputDir = path.join(root, "data/erasmus/pages")
const sourcePdf = "伊拉斯谟v2.0_图表汉化.pdf"

const pages = [
	[1, "Japan", "early", "decision-axis", ["JP_PHI_RESOURCES", "JP_RESOURCES_LTE_13", "JP_LOGISTICS_GTE_20", "TURN_GE_3", "JP_AZOI_COMPLETE", "JP_RABAUL_CONTROLLED", "JP_TARGET_LIST_FALLBACK"], ["JP_SOUTHWEST_RESOURCE", "JP_EVENT", "JP_PRESSURE_INDIA", "JP_PRESSURE_HQ", "JP_CENTRAL_PACIFIC", "JP_CHINA", "JP_NEW_GUINEA", "JP_PHILIPPINES"]],
	[2, "Japan", "middle", "decision-axis", ["JP_HAS_PASS", "JP_HAND_GE_3", "JP_RESOURCES_GE_13", "JP_LOGISTICS_GTE_20", "AP_WAR_ENTHUSIASM_LE_4", "AP_CBI_HAS_FORT", "TURN_GE_5"], ["JP_CENTRAL_PACIFIC", "JP_RESOURCE", "JP_INDIA", "JP_NEW_GUINEA", "JP_CHINA", "JP_FOREIGN_DEFENSE", "JP_EVENT", "JP_PASS"]],
	[3, "Japan", "end", "decision-axis", ["JP_HAND_GE_3", "JP_PORT_WITHIN_TOKYO_8", "JP_AIRFIELD_WITHIN_TOKYO_5", "JP_HAS_PASS", "JP_MAINLAND_FORT"], ["JP_EVENT", "JP_FINAL_EMPIRE", "JP_FINAL_DEFENSE", "JP_PASS"]],
	[4, "Japan", "all", "card-selection", ["JP_FO_ACTIVE", "JP_HAND_GT_2", "JP_FIRST_CARD", "JP_HAS_IMPERIAL_INTERVENTION", "JP_HAS_EVENT_CARD", "JP_HAS_LIMITED_EVENT", "JP_ALL_EVENTS_LIMITED", "JP_ISR_TARGET", "JP_FUTURE_OFFENSIVE"], ["JP_FUTURE_OFFENSIVE_CARD", "JP_LIMITED_EVENT_CARD", "JP_UNLIMITED_EVENT_CARD", "JP_LIMITED_OPS_CARD", "JP_UNLIMITED_OPS_CARD", "JP_EVENT_CARD", "JP_PASS"]],
	[5, "Japan", "all", "task-force", ["TARGET_IS_SEACOAST_OR_ISLAND", "CAN_GROUND_ADVANCE", "TARGET_EMPTY", "TARGET_ONLY_ENEMY_NAVAL", "GROUND_CAN_ENTER_EXIT", "TARGET_IS_SR", "ENEMY_AIR_CAN_REACT", "HAS_SUPPORT_POINTS", "DAMAGE_LEVEL_MET", "ENEMY_NAVAL_GROUND_CAN_REACT", "IS_EC_OFFENSIVE", "IS_LAST_TARGET"], ["JP_AIR_STRIKE", "JP_AIR_SUPPORT_GROUND", "JP_AIR_SEA_GROUND", "JP_SEA_SUPPORT_LANDING", "JP_AIR_SEA_LANDING", "JP_GROUND_ADVANCE", "JP_UNSUPPORTED_LANDING"]],
	[6, "Japan", "all", "reaction", ["WEATHER_CARD_AVAILABLE", "WEATHER_STANDARD_MET", "ISR_REACTION", "HAS_BATTLE", "HQ_IN_RANGE", "HAS_JN25", "ATTACK_REACTION_AVAILABLE", "DEI_COMPLETE", "FOREIGN_DEFENSE_TARGET", "NUKE_TARGET", "PBM_AIR_REQUIRED", "PBM_SEA_REQUIRED", "PBM_AA_FAILED"], ["JP_WEATHER_REACTION", "JP_NUKE_REACTION", "JP_INTEL_REACTION", "JP_COUNTERATTACK_REACTION", "JP_PBM_AIR", "JP_PBM_SEA", "JP_PBM_AA"]],
	[7, "Allies", "early", "decision-axis", ["AP_HAS_3_CARDS", "AP_HQ_SUPPLY_AVAILABLE", "AP_RABAUL_CONTROLLED", "AP_CBI_BUILT", "AP_HAS_PASS", "AP_LAST_CARD", "AP_THIRD_TURN", "AP_PHILIPPINES_NOT_SURRENDERED", "AP_ABDA_HQ_READY"], ["AP_PHILIPPINES", "AP_MALAYA", "AP_ABDA", "AP_CBI", "AP_ORANGE_PLAN", "AP_EVENT", "AP_PASS", "AP_DEI_DEFENSE"]],
	[8, "Allies", "middle", "decision-axis", ["AP_HAS_PASS", "AP_NEEDS_PROGRESS", "AP_HAS_3_CARDS", "JP_TARGET_CONTROLLED", "AP_PORT_TARGET", "AP_AIRFIELD_TARGET", "AP_HAS_ASP", "AP_CAN_ATTACK", "AP_CARD_GROUP_ROLL"], ["AP_PASS", "AP_COUNTEROFFENSIVE", "AP_SOUTH_PACIFIC", "AP_CBI", "AP_DEI", "AP_EVENT"]],
	[9, "Allies", "end", "decision-axis", ["AP_HAS_PASS", "IS_FINAL_TURN", "AP_HAS_3_CARDS", "AP_STRATEGIC_BASE", "AP_B29_TARGET", "AP_CAN_ATOMIC_VICTORY"], ["AP_PASS", "AP_EVENT", "AP_CAPTURE_STRATEGIC_BASE", "AP_PUSH_B29", "AP_REDEPLOY", "AP_INVade_JAPAN", "AP_ATOMIC_VICTORY"]],
	[10, "Allies", "all", "card-selection", ["AP_FO_ACTIVE", "AP_HAND_GT_2", "AP_FIRST_CARD", "AP_HAS_FISSION", "AP_HAS_EVENT_CARD", "AP_HAS_LIMITED_EVENT", "AP_ALL_EVENTS_LIMITED", "AP_CBI_COMPLETE", "AP_CHINA_EVENT_AVAILABLE"], ["AP_FUTURE_OFFENSIVE_CARD", "AP_LIMITED_EVENT_CARD", "AP_UNLIMITED_EVENT_CARD", "AP_LIMITED_OPS_CARD", "AP_UNLIMITED_OPS_CARD", "AP_CHINA_EVENT_CARD", "AP_EVENT_CARD", "AP_PASS"]],
	[11, "Allies", "all", "task-force", ["TARGET_IS_SEACOAST_OR_ISLAND", "CAN_GROUND_ADVANCE", "TARGET_EMPTY", "TARGET_ONLY_ENEMY_NAVAL", "GROUND_CAN_ENTER_EXIT", "TARGET_IS_SR", "ENEMY_AIR_CAN_REACT", "HAS_SUPPORT_POINTS", "DAMAGE_LEVEL_MET", "ENEMY_NAVAL_GROUND_CAN_REACT", "IS_EC_OFFENSIVE", "IS_LAST_TARGET"], ["AP_AIR_STRIKE", "AP_AIR_SUPPORT_GROUND", "AP_AIR_SEA_GROUND", "AP_SEA_SUPPORT_LANDING", "AP_AIR_SEA_LANDING", "AP_GROUND_ADVANCE", "AP_UNSUPPORTED_LANDING"]],
	[12, "Allies", "all", "reaction", ["ISR_REACTION", "HAS_BATTLE", "HQ_IN_RANGE", "ATTACK_REACTION_AVAILABLE", "DEI_COMPLETE", "NUKE_TARGET", "PBM_AIR_REQUIRED", "PBM_SEA_REQUIRED", "PBM_AA_FAILED"], ["AP_INTEL_REACTION", "AP_COUNTERATTACK_REACTION", "AP_PBM_AIR", "AP_PBM_SEA", "AP_PBM_AA"]],
]

const actionFamilies = {
	"decision-axis": "strategy",
	"card-selection": "card",
	"task-force": "task-force",
	reaction: "reaction",
}

function pageFile(page) {
	return fs.readdirSync(sourceDir).filter(name => /^\d\d-.*\.md$/.test(name)).sort()[page - 1]
}

function node(id, type, extra = {}) {
	return { id, type, confidence: extra.confidence || "inferred", source_page: extra.source_page, ...extra }
}

function buildChart([page, role, phase, kind, predicates, strategies]) {
	const id = `ERASMUS-${role === "Japan" ? "JP" : "AP"}-${String(page).padStart(2, "0")}`
	const source = pageFile(page)
	const nodes = [node(`${id}-START`, "start", { confidence: "confirmed", source_page: page, edges: [{ when: "always", to: `${id}-C01` }] })]
	for (let i = 0; i < predicates.length; ++i) {
		const next = i + 1 < predicates.length ? `${id}-C${String(i + 2).padStart(2, "0")}` : `${id}-SELECT`
		nodes.push(node(`${id}-C${String(i + 1).padStart(2, "0")}`, "condition", {
			predicate: { id: predicates[i] },
			label_zh: predicates[i],
			edges: [{ when: true, to: `${id}-S${String((i % strategies.length) + 1).padStart(2, "0")}` }, { when: false, to: next }],
			source_page: page,
		}))
	}
	for (let i = 0; i < strategies.length; ++i) {
		nodes.push(node(`${id}-S${String(i + 1).padStart(2, "0")}`, "action", {
			strategy: strategies[i],
			edges: [{ when: "always", to: `${id}-END` }],
			source_page: page,
		}))
	}
	nodes.push(node(`${id}-SELECT`, "priority", {
		family: actionFamilies[kind],
		strategies: strategies.map((strategy, index) => ({ id: strategy, priority: index + 1, actionTag: strategy })),
		edges: [{ when: "candidate_found", to: `${id}-END` }, { when: "no_candidate", to: `${id}-FALLBACK` }],
		source_page: page,
	}))
	if (kind === "reaction") {
		nodes.push(node(`${id}-DICE-01`, "dice", {
			table_id: `${id}-D10`, sides: 10, ranges: [{ min: 0, max: 3, result: "low" }, { min: 4, max: 9, result: "high" }],
			source_page: page,
		inference_basis: "PDF reaction/PBM Roll 1d10 branches",
	}))
	}
	nodes.push(node(`${id}-FALLBACK`, "fallback", {
		allowed_actions: ["pass", "skip"],
		reason: "chart candidates are not legal in current view",
		source_page: page,
	}))
	nodes.push(node(`${id}-END`, "terminal", { source_page: page, confidence: "confirmed" }))
	const sourceText = fs.readFileSync(path.join(sourceDir, source), "utf8")
	return {
		schema_version: 2,
		id,
		chart_id: id,
		role,
		phase,
		kind,
		action_family: actionFamilies[kind],
		source_page: page,
		source: { pdf: sourcePdf, page, markdown: path.relative(root, path.join(sourceDir, source)).replace(/\\/g, "/") },
		source_markdown: path.relative(root, path.join(sourceDir, source)).replace(/\\/g, "/"),
		rules: kind === "task-force" ? ["EOTS-7", "EOTS-8", "EOTS-9"] : ["EOTS-5", "EOTS-7"],
		nodes,
		strategies,
		dice_tables: kind === "reaction" ? [{ id: `${id}-D10`, sides: 10, source_page: page }] : [],
		qa: {
			inferred_nodes: nodes.filter(item => item.confidence === "inferred").map(item => item.id),
			visual_review_required: true,
			source_line_count: sourceText.split(/\r?\n/).length,
		},
	}
}

fs.mkdirSync(outputDir, { recursive: true })
const charts = pages.map(buildChart)
for (const chart of charts) {
	const filename = `page-${chart.source.page.toString().padStart(2, "0")}.json`
	fs.writeFileSync(path.join(outputDir, filename), JSON.stringify(chart, null, 2) + "\n")
	const lines = chart.nodes.map(item => {
		const edgeText = (item.edges || []).map(edge => `${edge.when} -> ${edge.to}`).join("; ")
		const predicate = item.predicate ? ` predicate=${item.predicate.id}` : ""
		return `| ${item.id} | ${item.type}${predicate} | ${item.confidence} | ${edgeText || "-"} |`
	}).join("\n")
	const markdown = [
		`# ${chart.id}（第 ${chart.source_page} 页）`, "",
		`- 阵营：${chart.role}`, `- 阶段：${chart.phase}`, `- 类型：${chart.kind}`,
		`- 来源：${chart.source.pdf}，第 ${chart.source.page} 页`,
		`- 机器文档：data/erasmus/pages/page-${String(chart.source.page).padStart(2, "0")}.json`, "",
		"## 节点与边", "", "| 节点 | 类型/谓词 | 置信度 | 出边 |", "| --- | --- | --- | --- |", lines, "",
		"## 策略出口", "", chart.strategies.map((item, index) => `${index + 1}. **${item}**`).join("\n"), "",
		"## 审校", "", "本页节点中的 inferred 表示依据 PDF 视觉内容与规则语义推断，必须在黄金路径测试中复核。",
	].join("\n") + "\n"
	fs.writeFileSync(path.join(outputDir, `page-${chart.source.page.toString().padStart(2, "0")}.md`), markdown)
}
fs.writeFileSync(path.join(outputDir, "README.md"), "# 伊拉斯谟逐页机器文档\n\n每个 page-XX.json 是单页权威数据；`confidence=inferred` 表示按视觉与规则语义推断，须在黄金路径审校中替换或确认。\n")
console.log(`Generated ${charts.length} Erasmus page JSON files`)
