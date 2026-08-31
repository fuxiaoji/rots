const ERASMUS_VERSION = "erasmus-v2.0-zh.1"

const ERASMUS_ACTION_PRIORITY = [
	"event", "ops", "play_card", "card", "action_hex", "unit", "hex", "box", "turn_box",
	"strat_move", "amphibious", "ground_move", "advanced_move", "extended_air", "range",
	"all", "eliminate", "displace", "discard", "hold", "roll", "bonus", "continue", "next",
	"done", "no_move", "skip", "pass", "stop",
]

function erasmus_hash(text) {
	let hash = 2166136261
	for (let i = 0; i < text.length; ++i) {
		hash ^= text.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	return hash >>> 0
}

function erasmus_phase(view) {
	const turn = Number(view.turn || 0)
	if (turn >= 10) return "end"
	if (turn >= 5) return "middle"
	return "early"
}

function erasmus_action_family(view, legal) {
	const prompt = String(view.prompt || "").toLowerCase()
	if (prompt.includes("reaction") || prompt.includes("intelligence")) return "reaction"
	if (legal.includes("card") || legal.includes("play_card") || legal.includes("event") || legal.includes("ops")) return "card-selection"
	if (legal.includes("unit") || legal.includes("hex") || legal.includes("action_hex")) return "task-force"
	return "decision-axis"
}

function erasmus_chart_id(role, phase, family) {
	const side = role === "Japan" ? "JP" : "AP"
	let page
	if (family === "card-selection") page = side === "JP" ? 4 : 10
	else if (family === "task-force") page = side === "JP" ? 5 : 11
	else if (family === "reaction") page = side === "JP" ? 6 : 12
	else if (side === "JP") page = phase === "early" ? 1 : phase === "middle" ? 2 : 3
	else page = phase === "early" ? 7 : phase === "middle" ? 8 : 9
	return `ERASMUS-${side}-${String(page).padStart(2, "0")}`
}

function erasmus_candidates(actions) {
	return Object.keys(actions || {}).filter(action => {
		if (action === "undo" || action === "redo" || action === "awaiting") return false
		const value = actions[action]
		return Array.isArray(value) ? value.length > 0 : Boolean(value)
	})
}

function erasmus_pick_argument(value, seedText) {
	if (!Array.isArray(value)) return undefined
	const sorted = value.slice().sort((a, b) => String(a).localeCompare(String(b), "en", { numeric: true }))
	return sorted[erasmus_hash(seedText) % sorted.length]
}

function erasmus_decide(view, context) {
	const role = context.role
	const legal = erasmus_candidates(view.actions)
	if (!legal.length) throw new Error("ERASMUS has no legal action")
	const phase = erasmus_phase(view)
	const family = erasmus_action_family(view, legal)
	const chart = erasmus_chart_id(role, phase, family)
	let action = ERASMUS_ACTION_PRIORITY.find(name => legal.includes(name))
	let fallback = false
	if (!action) {
		action = legal.slice().sort()[0]
		fallback = true
	}
	const seedText = `${context.seed}:${context.actionOrdinal}:${chart}:${action}`
	const argument = erasmus_pick_argument(view.actions[action], seedText)
	const roll = erasmus_hash(seedText + ":roll") % 10
	const publicTrace = {
		policy: ERASMUS_VERSION, chart, node: `${chart}-${fallback ? "FALLBACK" : "POLICY"}`,
		page: Number(chart.slice(-2)), role, phase, family, action,
		argument: action === "card" ? "[出牌后公开]" : argument,
		roll, fallback,
		explanation: fallback ? "图表优先项均不可用，采用稳定合法动作保护策略。" : "依据图表类别和合法行动优先级选择。",
	}
	return {
		action, argument, publicTrace,
		privateTrace: { ...publicTrace, argument, legalActions: legal, candidates: view.actions[action] },
	}
}

var EOTS_BOTS = {
	"erasmus-v2": {
		name: "伊拉斯谟 v2.0", version: ERASMUS_VERSION,
		scenarios: ["South Pacific"], roles: ["Japan", "Allies"], decide: erasmus_decide,
	},
}

