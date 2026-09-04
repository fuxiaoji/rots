/** import server/erasmus_ops.js*/
/** import server/erasmus_data.js*/
/** import server/erasmus_state.js*/

const ERASMUS_VERSION = "erasmus-v2.0-zh.7"
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

// 无头移动窗里这些“按钮”不会真正完成移动, bot 永不把它们当作最终动作:
//  - move: 无路径参数的残按钮(move(undefined) 直接崩溃)。
//  - avoid_zoi/amphibious/barges/extended_air/advanced_move/no_organic: 只切 L.move_type
//    或改编成后重渲染(期望玩家再点目标格), 无头下只会重落到 move 崩溃或死窗。
// 真正的移动由 advance 经 self.move(path) 完成, 或由 done/turn_box/no_move/stop 收尾。
const HEADLESS_MOVE_NOOP = new Set(["move", "avoid_zoi", "amphibious", "barges", "extended_air", "advanced_move", "no_organic"])

// 在“移动窗里单位已被选中(active_stack 非空, 表现为 unselect 非空且无 advance)”时, 唯一
// 能回到可控状态的合法动作就是撤销选择(unit) —— 回空栈后 advance/done/turn_box 重新接管。
// 其余按钮(avoid_zoi/strat_move/ground_move/... / move)要么切模式要么崩溃, 不可作为收尾。
function move_window_should_deselect(view, legal) {
    return /move units/i.test(String(view.prompt || ""))
        && !legal.includes("advance")
        && legal.includes("unit")
        && Array.isArray(view.unselect) && view.unselect.length > 0
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

// 目标聚焦 (操作层, 见 erasmus_ops.js): 当该方有“主轴/焦点”时, 把选目标格
// (action_hex) 与选进攻单位 (unit) 的散打改为沿主轴线行动——先打当前最优先
// 未夺目标, 目标不可达时打离焦点最近的格/单位, 逐步向主轴推进。
function target_argument(action, value, seedText, role, view) {
    const prompt = String(view?.prompt || "")
    // 通用: unit 候选里若混入“已选/将被撤销”的 unselect 单位(unselect_unit 塞进来的),
    // 选它只会 toggle 撤销当前选择 → 死循环。先在入口统一剔除, 只留“可新增/可前进”的单位;
    // 若剔除后为空, 交 evaluateChart 的动作级兜底跳过 unit(见 isActivateWindow 上方的通用兜底)。
    if (action === "unit" && Array.isArray(value) && Array.isArray(view?.unselect) && view.unselect.length) {
        const unsel = new Set(view.unselect)
        const avail = value.filter(u => !unsel.has(u))
        if (avail.length) value = avail
    }
    // CDSS「增援或补员阶段」落位/补员选择 (zh.7 补全): 按优先级落位, 而非散打(随机/就近焦点)。
    // 仅完整全图剧本启用(gate on), 保持 SP/Burma 子图剧本行为不变(golden 不动)。
    if (esm_gate_on() && action === "action_hex" && /as a reinforcement|choose hex to place/i.test(prompt)) {
        const u = (typeof G !== "undefined" && G && G.active_stack && G.active_stack[0]) || -1
        const piece = (u >= 0 && typeof pieces !== "undefined" && pieces[u]) ? pieces[u] : null
        const picked = esm_pick_placement(value, role, u, piece)
        return picked !== undefined ? picked : pick_argument(value, seedText, action, view)
    }
    if (esm_gate_on() && action === "unit" && /choose unit to reinforce/i.test(prompt)) {
        const picked = esm_pick_replacement_unit(value, role)
        return picked !== undefined ? picked : pick_argument(value, seedText, action, view)
    }
    if (action === "action_hex") {
        const picked = eop_pick_action_hex(value, role)
        return picked !== undefined ? picked : pick_argument(value, seedText, action, view)
    }
    if (action === "unit" && /activate units/i.test(prompt)) {
        // 超限(hq_bonus 随激活动态变化, 可能先“5 of 6”再激活第 6 个后变“6 of 5 Too many”):
        // 此时没有 done 按钮, 必须撤销已激活单位回到上限。从 view.unselect(已激活)里逐个撤销
        // (取最大 id, 确定性), 直到 ≤ 上限后 progress 逻辑自然 done。
        if (/Too many units selected/i.test(prompt)) {
            const unsel = Array.isArray(view?.unselect) ? view.unselect : []
            if (unsel.length) return unsel[unsel.length - 1]
            return pick_argument(value, seedText, action, view)
        }
        // 正常激活: unit 候选同时含“待激活单位”(action_unit)与“已激活单位”(unselect_unit
        // 塞进来并记入 view.unselect)。误选已激活单位会被 toggle 撤销 → 死循环, 故先剔除已激活。
        let pickValue = value
        if (Array.isArray(view?.unselect) && view.unselect.length) {
            const unsel = new Set(view.unselect)
            const avail = value.filter(u => !unsel.has(u))
            if (avail.length) pickValue = avail
        }
        // 空中单位不参与常规攻势夺格, 且无头引擎对其移动支持有缺口(攻击→turn_box 退场、
        // 反应→死窗); 激活只选地面/海军(由 advance 推进夺格), 空中单位留在原地继续 ZOI/防守。
        pickValue = pickValue.filter(u => { try { return pieces[u] && pieces[u].class !== "air" } catch (e) { return true } })
        const picked = eop_pick_unit(pickValue, role)
        return picked !== undefined ? picked : pick_argument(pickValue, seedText, action, view)
    }
    if (action === "unit" && /Declare battle hexes|Confirm declared battle hexes|Assign units to battle/i.test(prompt)) {
        const picked = eop_pick_unit(value, role)
        return picked !== undefined ? picked : pick_argument(value, seedText, action, view)
    }
    return pick_argument(value, seedText, action, view)
}

function evaluateChart(chart, view, context) {
    const legal = legal_actions(view)
    if (!legal.length) {
        // 窗口只有 awaiting(如无头地面推进触发的 disengagement 确认窗, 引擎仅给
        // 这一个按钮): 无其它动作可选, 必须确认继续; 其余 undo/redo/awaiting 被过滤。
        if (view.actions && view.actions.awaiting !== undefined) {
            const chartId = (chart && (chart.chart_id || chart.id)) || "NO-CHART"
            const nodeId = `${chartId}-START`
            const base = { policy: ERASMUS_VERSION, chart: chartId, node: nodeId, role: context.role,
                conditions: [], strategy: "HEADLESS_AWAIT", action: "awaiting", argument: undefined,
                dice: null, fallback: false, inferred: false,
                explanation: "窗口只提供 awaiting(确认继续), 无其它合法动作。" }
            return { action: "awaiting", argument: undefined, publicTrace: base, privateTrace: { ...base, legalActions: legal, candidates: {} } }
        }
        throw new Error("ERASMUS has no legal action")
    }
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
    // “Activate units”窗口: 当 unit 候选里已无可新增单位(全部是已激活的 unselect 单位, 或
    // 只剩空中单位)时, 继续选 unit 只会 toggle 撤销或触发无头移动死窗; 此时必须 done 收尾。
    if (action !== "done" && /activate units/i.test(String(view.prompt || "")) && legal.includes("done") && legal.includes("unit")) {
        const unsel = new Set(Array.isArray(view?.unselect) ? view.unselect : [])
        // 空中单位不算“可新增”(不参与常规攻势夺格且无头移动有缺口), 全部过滤;
        // 若过滤后为空(只剩空中/已激活单位), 则 done 收尾。
        const addable = (Array.isArray(view.actions.unit) ? view.actions.unit : [])
            .filter(u => !unsel.has(u))
            .filter(u => { try { return pieces[u] && pieces[u].class !== "air" } catch (e) { return true } })
        if (addable.length === 0) action = "done"
    }
    // “Declare battle hexes.”窗口的 unit 是选择可打击的已激活空中单位(随后用
    // action_hex 指向目标格并 create_battle_hex), 并非追加激活单位, 因此该窗口
    // 不能强制按 done 跳过——否则攻势永远零会战(有射程内敌格也不会申报)。
    // 激活/移动窗口仍由上一行逻辑收尾(done), 行为不变。
    // “Activate units: X of Y”窗口的 unit 是逐个激活进攻单位(done 才收尾), 若在已激活
    // 1 个单位后就强制 done, 则每个攻势只激活 1 个单位 → 会战几乎为零 → 无法夺格/PoW。
    // 该窗口必须豁免“强制 done”, 让 bot 反复 unit 直到 hit 上限, 由上一行 progress 逻辑收尾。
    const isDeclareHexesWindow = /declare battle hexes|confirm declared battle hexes/i.test(String(view.prompt || ""))
    const isActivateWindow = /activate units/i.test(String(view.prompt || ""))
    if (!isDeclareHexesWindow && !isActivateWindow && legal.includes("done") && legal.includes("unit") && view.offensive?.active_units?.flat?.().length > 0) action = "done"
    if (fallback) {
        const fallbackNode = nodes.get(`${prefix}-FALLBACK`)
        // 保护出口绝不能选中“切换 move_type/无路径 move”这类无头残按钮(会崩溃/死窗)。
        const safeLegal = legal.filter(a => !HEADLESS_MOVE_NOOP.has(a))
        action = (fallbackNode?.allowed_actions || []).find(item => legal.includes(item) && !HEADLESS_MOVE_NOOP.has(item))
            || safeLegal.slice().sort()[0]
    }
    // 无头自对打: advance 只在 headless_moves 攻击方 ATTACK_STAGE 空栈移动窗出现(引擎端
    // 唯一来源), 表示该窗应把一组地面/海军沿合法格推进向敌而不是直接 done。它必须覆盖
    // 上面 “强制 done” 与 fallback, 否则移动窗被整窗吞掉, 地面/海军永远无法接敌。
    if (legal.includes("advance")) {
        action = "advance"
        fallback = false
        strategy = "HEADLESS_ADVANCE"
    }
    // “Move units”窗口 + 已选中空中单位(纯空/无地面海军的攻势, 无 advance): 空中单位
    // “就地待命”应走 turn_box(退到回合轨、下回合返场), 而非 no_move——no_move 会触发
    // move_to 原地落子, 在反应/纯空场景下落入无合法动作的死窗。地面/海军由 advance 处理。
    if (/move units/i.test(String(view.prompt || "")) && legal.includes("turn_box") && !legal.includes("advance")) {
        action = "turn_box"
    }
    // 通用防 toggle 死循环: 引擎里 unselect_unit 会把“已选/将被撤销”的单位也塞进 unit 候选
    // (记入 view.unselect)。若此刻 unit 的每个候选都是 unselect, 选 unit 只会撤销当前选择 →
    // 在“Move units (0/1)↔(1/1)”这类窗口原地打转。此时跳过 unit, 改取下一个可执行动作
    // (move/no_move/done 等), 让移动/收尾真正发生。
    if (action === "unit" && Array.isArray(view.actions.unit) && view.actions.unit.length > 0) {
        const unsel = new Set(Array.isArray(view?.unselect) ? view.unselect : [])
        const addable = view.actions.unit.filter(u => !unsel.has(u))
        if (addable.length === 0) {
            if (move_window_should_deselect(view, legal)) {
                // 移动窗 + 已选中单位(如撤退/会战把单位重选回来 spec_move=1): 选 unit 是
                // 撤销选择回空栈, 让 advance/done/turn_box 重新接管并推进, 不是 toggle 死循环。
                action = "unit"
            } else {
                // 激活/申报窗: unit 候选只剩已激活单位, 选它=撤销激活回退, 才是死循环; 跳过。
                action = ACTION_PRIORITY.find(a => a !== "unit" && legal.includes(a) && !HEADLESS_MOVE_NOOP.has(a))
                    || legal.find(a => a !== "unit" && !HEADLESS_MOVE_NOOP.has(a))
                    || "unit"
            }
        }
    }
    // "Move units"窗口 + 已有选中组(unselect 非空) + 无 advance(无头推进不可用) + 有
    // no_move/advanced_move 可收尾: 继续选 unit 会在 (1/N)↔(2/N) 间 toggle 死循环。
    // 就地待命(no_move)收尾该组, 让窗口前进。(spec_move 撤退窗无 no_move, 仍走 unit 撤销。)
    if (/move units/i.test(String(view.prompt || "")) && !legal.includes("advance")
        && Array.isArray(view?.unselect) && view.unselect.length > 0 && action === "unit"
        && (legal.includes("no_move") || legal.includes("advanced_move"))) {
        action = legal.includes("no_move") ? "no_move" : "advanced_move"
    }
    // 最终安全网: 无头下绝不把“切 move_type/无路径 move”当最终动作 —— 它们只会崩溃或重落到
    // 死窗。真到这一步(上面各分支已规避, 属兜底), 退回可控收尾/撤销动作, 让窗口推进而非卡死。
    if (HEADLESS_MOVE_NOOP.has(action)) {
        action = ["advance", "done", "turn_box", "unit", "no_move", "stop", "cancel", "skip", "pass", "continue", "next"]
            .find(a => legal.includes(a))
            || legal.filter(a => !HEADLESS_MOVE_NOOP.has(a)).slice().sort()[0]
    }
    const nodeId = fallback ? `${prefix}-FALLBACK` : (current?.id || `${prefix}-FALLBACK`)
    const seedText = `${context.seed}:${context.actionOrdinal}:${chart.id}:${nodeId}`
    const diceTable = chart.dice_tables?.[0]
    const dice = diceTable ? { id: diceTable.id, sides: diceTable.sides, result: erasmus_hash(`${seedText}:dice`) % diceTable.sides + 1 } : null
    const argument = target_argument(action, view.actions[action], `${seedText}:${action}`, context.role, view)
    const focusInfo = eop_trace(context.role)
    const publicTrace = {
        policy: ERASMUS_VERSION, chart: chart.id, node: nodeId, role: context.role, conditions,
        attempted: attempted.length ? attempted : undefined,
        strategy, action, argument: action === "card" ? "[出牌后公开]" : argument, dice, fallback,
        axis: focusInfo.axis, focus: focusInfo.focus,
        inferred: chart.qa?.inferred_nodes?.includes(nodeId) || false,
        explanation: fallback ? "图表优先策略在本窗口均不可执行(no_candidate)，执行图表声明的保护出口。"
            : "沿图表条件分支和策略优先级迭代候选(candidate_found)后选择。",
    }
    return { action, argument, publicTrace, privateTrace: { ...publicTrace, argument, legalActions: legal, candidates: view.actions[action] } }
}

// 状态机 trace 分页: 决策轴首卡窗记对应轴图页(JP-01/02/03, AP-07/08/09);
// 其余同回合选牌窗记选牌图页(JP-04/AP-10)。
function erasmus_sm_page(strategy, isPin) {
    const rolePage = strategy.role === "Japan" ? "JP" : "AP"
    const axis = { early: 1, mid: 2, late: 3 }
    if (isPin) return `${rolePage}-0${axis[strategy.phase] || 1}`
    return rolePage === "JP" ? "JP-04" : "AP-10"
}

// 钉住/沿用战略时, 构造 decision trace(字段与 evaluateChart 兼容)。
function erasmus_sm_decision(strategy, pick, view, context) {
    const isPin = Number(strategy.ord) === Number(context.actionOrdinal || 0)
    const page = erasmus_sm_page(strategy, isPin)
    const node = `${page}-SM-${strategy.name}`
    const arg = pick.action === "card" ? "[出牌后公开]" : pick.argument
    // 决策 trace 附加 isPin: 本窗是否即“钉选”事件(每方每回合首卡), 沿用窗为 false。
    const sm = Object.assign(esm_trace_of(strategy) || {}, { pinnedNow: isPin })
    const base = {
        policy: ERASMUS_VERSION, chart: page, node, role: context.role,
        conditions: [], strategy: strategy.name, sm, action: pick.action, argument: arg,
        dice: null, fallback: false, inferred: false,
        ...(pick.via ? { via: pick.via } : {}),
        explanation: `状态机(zh.7): ${strategy.phase}阶段选轴「${strategy.name}」钉住整回合. ${(strategy.notes || []).join(" ")}`,
    }
    return { action: pick.action, argument: pick.argument, publicTrace: base, privateTrace: { ...base, argument: pick.argument, legalActions: Object.keys(view.actions || {}) } }
}

var EOTS_BOTS = {
    "erasmus-v2": {
        name: "伊拉斯谟 v2.0", version: ERASMUS_VERSION,
        scenarios: ["South Pacific", "1942-1945 (The Shortened Campaign)"], roles: ["Japan", "Allies"],
        decide(view, context) {
            // 完整全图剧本(1942-45 等): 回合级状态机选轴; 其余剧本(=gate 关)保持 zh.6。
            let sm = null
            try {
                if (esm_gate_on()) {
                    sm = esm_pin_strategy(view, context)
                    // 忠实目标链: chain = parse_goals 有序 idx; goals = 每行 Goal(kind/text)
                    if (sm) eop_set_strategy_chain(context.role, { name: sm.name, kind: sm.kind, note: (sm.notes || []).join("; "), goals: sm.goals, chain: sm.chain })
                } else {
                    eop_clear_all_chains()   // 防同进程跨剧本串台
                }
            } catch (e) {
                sm = null   // 任何 SM 异常不阻断游戏: 退回原路径(等同 zh.6)
                if (typeof eop_clear_all_chains === "function") eop_clear_all_chains()
            }
            if (sm) {
                // 选牌窗 / “Select action.” 窗: 按钉住战略的 kind 决定 PASS/OC/事件。
                if (esm_is_card_window(view)) {
                    const pick = esm_card_window_action(sm, view, context)
                    if (pick) return erasmus_sm_decision(sm, pick, view, context)
                } else if (esm_is_card_action_window(view)) {
                    const pick = esm_card_action_window_action(sm, view, context)
                    if (pick) return erasmus_sm_decision(sm, pick, view, context)
                }
                // 其余窗口走原图表微执行(焦点已由外部链覆盖转向钉住战略)。
            }
            const chart = select_chart(context.role, view)
            if (!chart) throw new Error(`No Erasmus chart for ${context.role}`)
            const res = evaluateChart(chart, view, context)
            if (sm && res && res.publicTrace) {
                const t = esm_trace_of(sm)
                res.publicTrace.sm = t
                if (!res.publicTrace.axis) res.publicTrace.axis = t ? t.axis : null
            }
            return res
        },
    },
}
