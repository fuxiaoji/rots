/** import server/erasmus_data.js*/

const ERASMUS_VERSION = "erasmus-v2.0-zh.2"
const ACTION_PRIORITY = ["event", "ops", "play_card", "card", "action_hex", "unit", "hex", "strat_move", "ground_move", "roll", "continue", "next", "done", "skip", "pass"]

function erasmus_hash(text) {
    let value = 2166136261
    for (let i = 0; i < text.length; ++i) { value ^= text.charCodeAt(i); value = Math.imul(value, 16777619) }
    return value >>> 0
}

function legal_actions(view) {
    return Object.keys(view.actions || {}).filter(action => {
        if (["undo", "redo", "awaiting"].includes(action)) return false
        const value = view.actions[action]
        return Array.isArray(value) ? value.length > 0 : Boolean(value)
    })
}

function predicate_value(view, id) {
    const turn = Number(view.turn || 0)
    const prompt = String(view.prompt || "").toLowerCase()
    const has = action => Object.prototype.hasOwnProperty.call(view.actions || {}, action)
    const hand = faction => Array.isArray(view.hand?.[faction]) ? view.hand[faction].length : Number(view.hand?.[faction] || 0)
    const values = {
        JP_HAND_GE_3: hand(0) >= 3, AP_HAND_GE_3: hand(1) >= 3,
        JP_HAND_GT_2: hand(0) > 2, AP_HAND_GT_2: hand(1) > 2,
        JP_LOGISTICS_GTE_20: Number(view.logistics?.[0] || view.logistic?.[0] || 0) >= 20,
        JP_RESOURCES_LTE_13: Number(view.resources?.[0] || 99) <= 13,
        JP_RESOURCES_GE_13: Number(view.resources?.[0] || 0) >= 13,
        AP_WAR_ENTHUSIASM_LE_4: Number(view.wie || 99) <= 4,
        AP_HAS_PASS: Number(view.passes?.[1] || 0) > 0, JP_HAS_PASS: Number(view.passes?.[0] || 0) > 0,
        TURN_GE_3: turn >= 3, TURN_GE_5: turn >= 5, IS_FINAL_TURN: turn >= 10,
        JP_FO_ACTIVE: Number(view.future_offensive?.[0] || 0) > 0, AP_FO_ACTIVE: Number(view.future_offensive?.[1] || 0) > 0,
        HAS_BATTLE: prompt.includes("battle") || prompt.includes("战斗"),
        WEATHER_CARD_AVAILABLE: has("card") || has("event"), ISR_REACTION: prompt.includes("reaction") || prompt.includes("情报"),
        HAS_SUPPORT_POINTS: has("unit") || has("action_hex"),
    }
    if (Object.prototype.hasOwnProperty.call(values, id)) return values[id]
    if (id.startsWith("TARGET_") || id.startsWith("ENEMY_") || id.startsWith("CAN_") || id.startsWith("GROUND_") || id.startsWith("DAMAGE_") || id.startsWith("IS_") || id.startsWith("HAS_")) return false
    return false
}

function select_chart(role, view) {
    const side = role === "Japan" ? "JP" : "AP"
    const turn = Number(view.turn || 0)
    const prompt = String(view.prompt || "").toLowerCase()
    const actions = Object.keys(view.actions || {})
    const kind = actions.some(a => ["card", "event", "ops"].includes(a)) ? "card-selection"
        : prompt.includes("reaction") || prompt.includes("intelligence") || prompt.includes("反应") ? "reaction"
            : actions.some(a => ["unit", "hex", "action_hex"].includes(a)) ? "task-force" : "decision-axis"
    const phase = kind === "decision-axis" ? (turn >= 10 ? "end" : turn >= 5 ? "middle" : "early") : "all"
    return ERASMUS_CHARTS.find(chart => chart.role === role && chart.phase === phase && chart.kind === kind)
        || ERASMUS_CHARTS.find(chart => chart.role === role && chart.kind === kind)
        || ERASMUS_CHARTS.find(chart => chart.role === role)
}

function action_for_strategy(strategy, legal) {
    const tag = String(strategy || "")
    const preferred = tag.includes("CARD") ? ["card", "event", "ops", "play_card"]
        : tag.includes("PASS") ? ["pass", "skip"]
            : tag.includes("PBM") || tag.includes("REACTION") ? ["roll", "event", "unit", "action_hex", "done"]
                : tag.includes("GROUND") || tag.includes("LANDING") || tag.includes("STRIKE") || tag.includes("ADVANCE") ? ["action_hex", "unit", "hex", "event", "ops", "done"]
                    : ACTION_PRIORITY
    return [...preferred, ...ACTION_PRIORITY].find(action => legal.includes(action)) || null
}

function pick_argument(value, seedText, action, view) {
    if (!Array.isArray(value) || value.length === 0) return undefined
    let candidates = value.slice()
    if (action === "unit" && view.offensive?.active_units) {
        const selected = new Set(view.offensive.active_units.flat())
        const available = candidates.filter(item => !selected.has(item))
        if (available.length) candidates = available
    }
    candidates.sort((a, b) => String(a).localeCompare(String(b), "en", { numeric: true }))
    return candidates[erasmus_hash(seedText) % candidates.length]
}

function evaluateChart(chart, view, context) {
    const legal = legal_actions(view)
    if (!legal.length) throw new Error("ERASMUS has no legal action")
    const nodes = new Map(chart.nodes.map(item => [item.id, item]))
    const prefix = chart.chart_id || chart.id
    let current = nodes.get(`${prefix}-START`)
    const conditions = []
    let guard = 0
    while (current && !["action", "priority", "fallback", "terminal"].includes(current.type)) {
        if (++guard > chart.nodes.length + 2) throw new Error(`chart cycle: ${chart.id}`)
        if (current.type === "condition") {
            const result = predicate_value(view, current.predicate?.id)
            conditions.push({ nodeId: current.id, predicate: current.predicate?.id, result })
            const edge = current.edges.find(item => item.when === result) || current.edges.find(item => item.when === "always")
            current = nodes.get(edge?.to)
        } else current = nodes.get(current.edges?.find(item => item.when === "always")?.to)
    }
    let strategy = current?.strategy || current?.strategies?.[0]?.id
    let action = action_for_strategy(strategy, legal)
    const progress = String(view.prompt || "").match(/(\d+)\s+of\s+(\d+)/i)
    if (progress && Number(progress[1]) >= Number(progress[2]) && legal.includes("done")) action = "done"
    if (legal.includes("done") && legal.includes("unit") && view.offensive?.active_units?.flat?.().length > 0) action = "done"
    let fallback = false
    if (!action) {
        const fallbackNode = nodes.get(`${prefix}-FALLBACK`)
        action = (fallbackNode?.allowed_actions || []).find(item => legal.includes(item)) || legal.slice().sort()[0]
        fallback = true
    }
    const nodeId = current?.id || `${prefix}-FALLBACK`
    const seedText = `${context.seed}:${context.actionOrdinal}:${chart.id}:${nodeId}`
    const diceTable = chart.dice_tables?.[0]
    const dice = diceTable ? { id: diceTable.id, sides: diceTable.sides, result: erasmus_hash(`${seedText}:dice`) % diceTable.sides + 1 } : null
    const argument = pick_argument(view.actions[action], `${seedText}:${action}`, action, view)
    const publicTrace = {
        policy: ERASMUS_VERSION, chart: chart.id, node: nodeId, role: context.role, conditions,
        strategy, action, argument: action === "card" ? "[出牌后公开]" : argument, dice, fallback,
        inferred: chart.qa?.inferred_nodes?.includes(nodeId) || false,
        explanation: fallback ? "图表策略无合法候选，执行图表声明的保护出口。" : "沿图表条件分支和策略优先级选择。",
    }
    return { action, argument, publicTrace, privateTrace: { ...publicTrace, argument, legalActions: legal, candidates: view.actions[action] } }
}

var EOTS_BOTS = {
    "erasmus-v2": {
        name: "伊拉斯谟 v2.0", version: ERASMUS_VERSION,
        scenarios: ["South Pacific"], roles: ["Japan", "Allies"],
        decide(view, context) {
            const chart = select_chart(context.role, view)
            if (!chart) throw new Error(`No Erasmus chart for ${context.role}`)
            return evaluateChart(chart, view, context)
        },
    },
}
