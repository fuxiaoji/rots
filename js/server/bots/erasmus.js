/** import server/erasmus_data.js*/

const ERASMUS_VERSION = "erasmus-v2.0-zh.4"
const ACTION_PRIORITY = ["event", "ops", "play_card", "card", "action_hex", "unit", "hex", "strat_move", "ground_move", "roll", "continue", "next", "done", "skip", "pass", "cancel"]
const FAMILY_ACTION_PRIORITY = {
    // OPS 卡/攻势战略: 在“Select action”窗口应打出 ops,而不是事件
    ops: ["ops", "event", "card", "play_card", "action_hex", "unit", "hex", "strat_move", "ground_move", "roll", "continue", "next", "done", "skip", "pass"],
    // 事件卡/事件战略: 先按 EC 打出
    event: ["event", "ops", "card", "play_card", "future_offensive", "discard", "roll", "continue", "next", "done", "skip", "pass"],
    // 先发打击 FO 卡: 本身按事件打出(在顶窗口表现为选择该牌)
    fo: ["card", "event", "ops", "play_card", "future_offensive", "roll", "continue", "next", "done", "skip", "pass"],
    pass: ["pass", "skip", "done", "next", "roll"],
    ground: ["action_hex", "unit", "hex", "event", "ops", "done"],
    reaction: ["roll", "event", "unit", "action_hex", "done"],
}

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

function strategy_family(tag) {
    // 先处理后缀式卡牌策略(避免 *_OPS_CARD 被 *_EVENT_CARD 分支误判)
    if (/_OPS_CARD$/.test(tag)) return "ops"
    if (/(?:UN)?LIMITED_EVENT_CARD$/.test(tag) || /_EVENT_CARD$/.test(tag) || /_EVENT$/.test(tag)) return "event"
    if (tag.includes("FUTURE_OFFENSIVE")) return "fo"
    if (tag.includes("PASS")) return "pass"
    if (tag.includes("PBM") || tag.includes("REACTION")) return "reaction"
    if (tag.includes("GROUND") || tag.includes("LANDING") || tag.includes("STRIKE") || tag.includes("ADVANCE")) return "ground"
    return "default"
}

function action_for_strategy(strategy, legal) {
    const tag = String(strategy || "")
    const family = strategy_family(tag)
    const preferred = FAMILY_ACTION_PRIORITY[family] || ACTION_PRIORITY
    return [...preferred, ...ACTION_PRIORITY].find(action => legal.includes(action)) || null
}

// 迭代 SELECT(priority) 节点的候选策略,按优先级返回第一个当前窗口可执行的
// 策略(对应图中 candidate_found 边);全部不可执行才返回 null(→ no_candidate/fallback)。
function first_executable_strategy(strategies, legal, view) {
    const attempts = []
    for (const item of strategies || []) {
        const id = typeof item === "string" ? item : item?.id
        const action = action_for_strategy(id, legal)
        attempts.push({ strategy: id, action })
        if (action) return { strategy: id, action, attempts }
    }
    return { strategy: null, action: null, attempts }
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
    // 策略解析: 单出口 action 节点直接取该策略; priority(SELECT)节点按图中
    // candidate_found/no_candidate 语义迭代候选,而不是只取 strategies[0]。
    let strategy = null
    let action = null
    let attempted = []
    let fallback = false
    if (current?.type === "priority") {
        const chosen = first_executable_strategy(current.strategies, legal, view)
        attempted = chosen.attempts
        strategy = chosen.strategy
        action = chosen.action
        if (!strategy) fallback = true // no_candidate
    } else {
        strategy = current?.strategy || null
        action = strategy ? action_for_strategy(strategy, legal) : null
        if (!action) fallback = true
    }
    const progress = String(view.prompt || "").match(/(\d+)\s+of\s+(\d+)/i)
    if (progress && Number(progress[1]) >= Number(progress[2]) && legal.includes("done")) action = "done"
    // “Declare battle hexes.”窗口的 unit 是选择可打击的已激活空中单位(随后用
    // action_hex 指向目标格并 create_battle_hex), 并非追加激活单位, 因此该窗口
    // 不能强制按 done 跳过——否则攻势永远零会战(有射程内敌格也不会申报)。
    // 激活/移动窗口仍由上一行逻辑收尾(done), 行为不变。
    const isDeclareHexesWindow = /declare battle hexes|confirm declared battle hexes/i.test(String(view.prompt || ""))
    if (!isDeclareHexesWindow && legal.includes("done") && legal.includes("unit") && view.offensive?.active_units?.flat?.().length > 0) action = "done"
    if (fallback) {
        const fallbackNode = nodes.get(`${prefix}-FALLBACK`)
        action = (fallbackNode?.allowed_actions || []).find(item => legal.includes(item)) || legal.slice().sort()[0]
    }
    const nodeId = fallback ? `${prefix}-FALLBACK` : (current?.id || `${prefix}-FALLBACK`)
    const seedText = `${context.seed}:${context.actionOrdinal}:${chart.id}:${nodeId}`
    const diceTable = chart.dice_tables?.[0]
    const dice = diceTable ? { id: diceTable.id, sides: diceTable.sides, result: erasmus_hash(`${seedText}:dice`) % diceTable.sides + 1 } : null
    const argument = pick_argument(view.actions[action], `${seedText}:${action}`, action, view)
    const publicTrace = {
        policy: ERASMUS_VERSION, chart: chart.id, node: nodeId, role: context.role, conditions,
        attempted: attempted.length ? attempted : undefined,
        strategy, action, argument: action === "card" ? "[出牌后公开]" : argument, dice, fallback,
        inferred: chart.qa?.inferred_nodes?.includes(nodeId) || false,
        explanation: fallback ? "图表优先策略在本窗口均不可执行(no_candidate)，执行图表声明的保护出口。"
            : "沿图表条件分支和策略优先级迭代候选(candidate_found)后选择。",
    }
    return { action, argument, publicTrace, privateTrace: { ...publicTrace, argument, legalActions: legal, candidates: view.actions[action] } }
}

var EOTS_BOTS = {
    "erasmus-v2": {
        name: "伊拉斯谟 v2.0", version: ERASMUS_VERSION,
        scenarios: ["South Pacific", "1942-1945 (The Shortened Campaign)"], roles: ["Japan", "Allies"],
        decide(view, context) {
            const chart = select_chart(context.role, view)
            if (!chart) throw new Error(`No Erasmus chart for ${context.role}`)
            return evaluateChart(chart, view, context)
        },
    },
}
