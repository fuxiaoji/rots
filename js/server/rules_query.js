// ============================================================================
// rules_query.js — RTT 规则查询层（只读）
//
// 原则（整改清单 #1）：Erasmus 负责“选什么”，RTT 规则引擎负责“什么是合法的”。
// 本文件把引擎已有的合法性/移动/反应/战斗逻辑封装成只读查询，供 Erasmus 在
// decide() 期间询问“什么是合法”，从而不再在 AI 层复制第二套移动/反应/补给/战斗规则。
//
// 两级接口：
//   Tier 1 纯读叶子 —— 直接包装引擎纯函数，要求调用时 G.supply_cache 已对当前
//                        单位位置有效（decide() 内通常成立，因为 state 是上一次
//                        action() 保存的一致状态）。
//   Tier 2 快照事务 —— 引擎合法性生成器（get_ground_move / get_activatable_units /
//                        get_reaction_able_units / update_move_hex ...）会就地改写
//                        G.supply_cache 的临时位、G.offensive.* 或 L.*，因此必须在一
//                        个 save/restore 快照里执行并在 finally 里恢复，绝不污染全局 G。
//
// 这些函数都是同一内联作用域里的全局函数，bot 直接调用即可；测试经
//   rules.query(state, role, { name:"rules_query", fn:"queryXxx", args:[...] })
// 在框架 _load/_save 周期内驱动。
// ============================================================================

// 引擎移动/激活/反应生成器会写入这些 L 键，快照事务在 finally 里恢复它们。
const RULES_QUERY_L_KEYS = [
    "move_data", "move_type", "allowed_hexes", "possible_hexes", "possible_units",
    "reaction_able_units", "asp_ground_units", "cv_reaction_hex_map", "air_reaction_hex_map",
    "overstack", "allowed_units", "ground_units", "hex_to_retreat", "supply",
    "hq_bonus", "kwai", "card", "movable_units", "is_naval_present", "is_ground_present",
]

// 快照事务：在 fn() 执行前后保存/恢复全局可变状态。
// 注意不重赋值 G（避免破坏 exports.* 中 G=state 的原地引用约定），只就地恢复字段。
// 引擎移动/反应生成器要求 G.active 为数值阵营；而 decide() 期间 G.active 被框架
// _save 还原成 "Allies"/"Japan" 字符串。故事务内把 G.active 临时规整为数值（默认取
// 数值 R，或显式 activeOverride），finally 里还原，绝不外泄。
function rules_query_snapshot(fn, activeOverride) {
    const rSaved = R
    const activeSaved = G.active
    const seed = G.seed
    const supplyCache = Array.isArray(G.supply_cache) ? G.supply_cache.slice() : G.supply_cache
    const logLen = Array.isArray(G.log) ? G.log.length : 0
    const oos = G.oos ? G.oos.slice() : G.oos
    const burmaRoad = G.burma_road
    const activeStack = G.active_stack ? G.active_stack.slice() : G.active_stack
    const location = G.location ? G.location.slice() : G.location
    const reduced = G.reduced ? G.reduced.slice() : G.reduced
    const offensive = G.offensive ? object_copy(G.offensive) : G.offensive
    const control = G.control ? object_copy(G.control) : G.control
    const nonControl = G.non_control ? object_copy(G.non_control) : G.non_control
    const lSaved = {}
    for (const k of RULES_QUERY_L_KEYS) lSaved[k] = { had: Object.prototype.hasOwnProperty.call(L, k), value: L[k] }
    let result
    try {
        if (activeOverride !== undefined) G.active = activeOverride
        else if (typeof G.active !== "number" && typeof R === "number") G.active = R
        result = fn()
    } finally {
        R = rSaved
        G.active = activeSaved
        G.seed = seed
        G.supply_cache = supplyCache
        if (Array.isArray(G.log)) G.log.length = logLen
        if (oos !== undefined) G.oos = oos
        if (burmaRoad !== undefined) G.burma_road = burmaRoad
        if (activeStack !== undefined) G.active_stack = activeStack
        if (location !== undefined) G.location = location
        if (reduced !== undefined) G.reduced = reduced
        if (offensive !== undefined) G.offensive = offensive
        if (control !== undefined) G.control = control
        if (nonControl !== undefined) G.non_control = nonControl
        for (const k of RULES_QUERY_L_KEYS) {
            if (lSaved[k].had) L[k] = lSaved[k].value
            else delete L[k]
        }
    }
    return result
}

// ============================================================================
// Tier 1 — 纯读叶子
// ============================================================================

// 该格是否存在 faction 的（非中立）ZOI。
function queryZoi(hex, faction) {
    return !!has_zoi(hex, faction)
}

// 非中立 ZOI（区别于“经过中立 ZOI 不会被挡”）。
function queryNonNeutralZoi(hex, faction) {
    return !!has_non_n_zoi(hex, faction)
}

// 地面移动一步的 MP 成本（无地面边返回 100）。
function queryGroundMoveCost(from, to, faction) {
    return get_ground_move_cost(from, to, faction)
}

// 某单位是否在补给状态下（HQ 恒真、已激活恒真、否则看补给位）。
function querySupplyStatus(unit) {
    return !!check_unit_supply(G.location[unit], unit, pieces[unit])
}

// 一组单位对某会战格的潜在战斗力合计（复用引擎 sum_combat_factor）。
function queryPotentialCombatStrength(units, battleHex) {
    return sum_combat_factor(units, battleHex)
}

// 战果表（naval / ground）roll → 命中乘数。
function queryBattleTable(kind, roll) {
    return kind === "ground" ? ground_battle_table(roll) : naval_battle_table(roll)
}

// 某格是否被 faction 控制（稳态下纯读；G.control 挂起时引擎会就地刷新 control 位）。
function querySpaceControlled(hex, faction) {
    return is_space_controlled(hex, faction)
}

// 某格是否存在 faction 的单位（海陆空任意）。
function queryFactionUnits(hex, faction) {
    return !!is_faction_units(hex, faction)
}

// 单位增援的合法部署格（友控港口/机场、有补给、无敌方非中立 ZOI、不超叠）。
function queryLegalReinforcementHexes(unit) {
    return get_unit_reinforcement_hexes(unit)
}

// 单位应急撤退的合法目的地（友控港口/机场，范围内）。
function queryEmergencyRetreatHexes(unit) {
    return get_emergency_retreat_hexes(unit)
}

// 某 HQ 可激活的单位（复用引擎精确激活区逻辑的现成快照包装）。
// erasmus_preview_activatable_units 自身会恢复大部分字段，但会留下 active_hq 数组
// 被“写长”的痕迹；再包一层快照事务彻底还原 G.offensive。
function queryActivationCandidates(hq) {
    return rules_query_snapshot(() => erasmus_preview_activatable_units(hq))
}

// ============================================================================
// Tier 2 — 快照事务
// ============================================================================

// 地面单位可达格（复用引擎 get_ground_move 的 BFS）。
// 返回 { reachableHexes, costByHex, predecessor }；ctx 可给 { move_type, avoid_zoi }。
function queryGroundReachability(unit, ctx) {
    return rules_query_snapshot(() => {
        const loc = G.location[unit]
        // 地面可达性只在有实际攻势（激活卡牌）的上下文里才有意义；否则返回空。
        if (!G.offensive || !Array.isArray(G.offensive.active_cards) || !G.offensive.active_cards[0]) {
            return { reachableHexes: [], costByHex: {}, predecessor: {} }
        }
        G.active_stack = [unit]
        L.move_type = (ctx && ctx.move_type) || ANY_MOVE
        L.move_data = get_move_data()
        const dm = get_ground_move(!!(ctx && ctx.avoid_zoi))
        const reachableHexes = []
        const costByHex = {}
        const predecessor = {}
        // get_ground_move 返回平铺 map [hex0, path0, hex1, path1, ...]；path = [cost, ...hexes, dest]
        for (let i = 0; i < dm.length; i += 2) {
            const hex = dm[i]
            const path = dm[i + 1]
            costByHex[hex] = path[0]
            if (path.length >= 3) predecessor[hex] = path[path.length - 2]
            if (hex !== loc) reachableHexes.push(hex)
        }
        return { reachableHexes, costByHex, predecessor }
    })
}

// 海军单位可达格（复用引擎 get_naval_move 的 BFS）。与 queryGroundReachability 同构：
// 快照内设 active_stack/move_type，跑 get_move_data + mark_participate_attack_hex +
// get_naval_move，收割可达格。返回 { reachableHexes, costByHex, predecessor }。
function queryNavalReachability(unit, ctx) {
    return rules_query_snapshot(() => {
        const loc = G.location[unit]
        if (!G.offensive || !Array.isArray(G.offensive.active_cards) || !G.offensive.active_cards[0]) {
            return { reachableHexes: [], costByHex: {}, predecessor: {} }
        }
        G.active_stack = [unit]
        L.move_type = (ctx && ctx.move_type) || NAVAL_MOVE
        L.move_data = get_move_data()
        if (L.move_data.move_type & NAVAL_MOVE) mark_participate_attack_hex()
        const dm = get_naval_move(0)
        const reachableHexes = []
        const costByHex = {}
        const predecessor = {}
        for (let i = 0; i < dm.length; i += 2) {
            const hex = dm[i]
            const path = dm[i + 1]
            costByHex[hex] = path[0]
            if (path.length >= 3) predecessor[hex] = path[path.length - 2]
            if (hex !== loc) reachableHexes.push(hex)
        }
        return { reachableHexes, costByHex, predecessor }
    })
}

// 合法参与判定：单位能否合法参与 target 会战（只读，无副作用）。
//   ground: 引擎地面 BFS 可达 target，或已在 target。
//   air:    战斗航程 in_range_on_map 可达（br 或延伸 ebr）。
//   naval:  引擎海军 BFS 可达 target，或已在 target。
// 返回 { legal, moveMode, path, usesExtendedRange, effectiveAttack }。
function queryCombatParticipation(unit, target, ctx) {
    const base = { legal: false, moveMode: null, path: null, usesExtendedRange: false, effectiveAttack: 0 }
    if (!Number.isInteger(target) || target < 0 || target > LAST_BOARD_HEX) return base
    const piece = pieces[unit]
    const loc = G.location[unit]
    if (!piece || !Number.isInteger(loc)) return base
    const cf = piece.reduced ? (Number(piece.rcf) || Math.ceil((Number(piece.cf) || 0) / 2)) : (Number(piece.cf) || 0)
    const faction = piece.faction
    if (piece.class === "ground") {
        if (loc === target) return { legal: true, moveMode: "already", path: [loc], usesExtendedRange: false, effectiveAttack: cf }
        const reach = queryGroundReachability(unit, ctx)
        const legal = reach.reachableHexes.indexOf(target) >= 0
        return { legal, moveMode: "ground", path: legal ? [loc, target] : null, usesExtendedRange: false, effectiveAttack: cf }
    }
    if (piece.class === "air") {
        const br = Math.max(1, Number(piece.br) || 0)
        const ebr = Math.max(1, Number(piece.ebr) || Number(piece.br) || 0)
        const normal = in_range_on_map(loc, br, [target], faction).length > 0
        const extended = ebr > br && in_range_on_map(loc, ebr, [target], faction).length > 0
        return { legal: normal || extended, moveMode: normal ? "air" : (extended ? "air-extended" : null),
            path: null, usesExtendedRange: !normal && extended, effectiveAttack: cf }
    }
    if (piece.class === "naval") {
        if (loc === target) return { legal: true, moveMode: "already", path: [loc], usesExtendedRange: false, effectiveAttack: cf }
        const reach = queryNavalReachability(unit, ctx)
        const legal = reach.reachableHexes.indexOf(target) >= 0
        return { legal, moveMode: "naval", path: legal ? [loc, target] : null, usesExtendedRange: false, effectiveAttack: cf }
    }
    return base
}

// 反应候选：反应方 reactFaction 对当前（或注入的 targetHex）会战格能合法反应的部队，
// 按兵种分类成 { air, carrier, naval, ground, hq, specialReaction }。
function queryReactionCandidates(opts) {
    const reactionFaction = opts && opts.reactionFaction !== undefined ? opts.reactionFaction : (1 - R)
    const targetHex = opts && opts.targetHex
    return rules_query_snapshot(() => {
        if (!G.offensive || !Array.isArray(G.offensive.battle_hexes)) {
            return { air: [], carrier: [], naval: [], ground: [], hq: [], specialReaction: [] }
        }
        const prevR = R
        R = reactionFaction
        if (targetHex !== undefined && targetHex !== null) {
            // 把假设目标临时并入会战格集合，供反应格标记使用（快照会恢复）。
            if (!set_has(G.offensive.battle_hexes, targetHex)) set_add(G.offensive.battle_hexes, targetHex)
        }
        L.reaction_able_units = []
        L.asp_ground_units = []
        L.cv_reaction_hex_map = []
        L.air_reaction_hex_map = []
        get_reaction_able_units()
        const air = []
        const carrier = []
        const naval = []
        const ground = []
        for_each_unit_on_map((u, piece) => {
            if (piece.faction !== reactionFaction) return
            const reactionAble = set_has(L.reaction_able_units, u) || set_has(L.asp_ground_units, u)
            if (piece.class === "air") {
                if (is_air_reaction_able(u)) air.push(u)
            } else if (is_cv_unit(piece)) {
                if (reactionAble || is_cv_reaction_able(u)) carrier.push(u)
            } else if (piece.class === "naval") {
                if (reactionAble) naval.push(u)
            } else if (piece.class === "ground") {
                if (reactionAble) ground.push(u)
            }
        })
        R = prevR
        return { air, carrier, naval, ground, hq: [], specialReaction: [] }
    }, reactionFaction)
}

// 反应候选强度合计（空海 + 地面），供 potentialReactionStrength 使用。
function queryReactionStrength(opts) {
    const c = queryReactionCandidates(opts)
    const battleHex = opts && opts.battleHex
    const all = c.air.concat(c.carrier, c.naval, c.ground)
    return sum_combat_factor(all, battleHex)
}

// 特殊反应资格：目标是否为反应方可掷“特殊反应”骰的潜在 SR 格。
// 忠实复用 P.special_reaction._begin 的逐格资格判定：命名格 + 反应方 ZOI +
// 反应方某 HQ 指挥范围内。返回 { eligible, reason, respondingHq, legalUnits }。
function querySpecialReaction(opts) {
    const reactingFaction = (opts && opts.reactingFaction !== undefined)
        ? opts.reactingFaction : (1 - (G.offensive ? G.offensive.attacker : R))
    const target = opts && opts.target
    return rules_query_snapshot(() => {
        if (target === null || target === undefined || !Number.isInteger(target)) {
            return { eligible: false, reason: "no-target", respondingHq: null, legalUnits: [] }
        }
        const md = get_map_data(target)
        if (!md || !md.named) return { eligible: false, reason: "not-named", respondingHq: null, legalUnits: [] }
        if (!has_zoi(target, reactingFaction)) return { eligible: false, reason: "no-zoi", respondingHq: null, legalUnits: [] }
        let respondingHq = null
        for_each_unit_on_map((u, piece) => {
            if (respondingHq !== null) return
            if (piece.faction === reactingFaction && piece.class === "hq"
                && in_range_on_map(G.location[u], piece.cr, [target], reactingFaction).length) {
                respondingHq = u
            }
        })
        return respondingHq !== null
            ? { eligible: true, reason: null, respondingHq, legalUnits: [] }
            : { eligible: false, reason: "out-of-range", respondingHq: null, legalUnits: [] }
    })
}

// ============================================================================
// 测试/工具分发
// ============================================================================

const RULES_QUERY_FNS = [
    "queryZoi", "queryNonNeutralZoi", "queryGroundMoveCost", "querySupplyStatus",
    "queryPotentialCombatStrength", "queryBattleTable", "querySpaceControlled",
    "queryFactionUnits", "queryLegalReinforcementHexes", "queryEmergencyRetreatHexes",
    "queryActivationCandidates", "queryGroundReachability", "queryNavalReachability",
    "queryCombatParticipation", "queryReactionCandidates",
    "queryReactionStrength", "querySpecialReaction",
]

function rules_query_dispatch(q) {
    if (!q || typeof q !== "object") return null
    const fn = q.fn || q.query
    const impl = {
        queryZoi, queryNonNeutralZoi, queryGroundMoveCost, querySupplyStatus,
        queryPotentialCombatStrength, queryBattleTable, querySpaceControlled,
        queryFactionUnits, queryLegalReinforcementHexes, queryEmergencyRetreatHexes,
        queryActivationCandidates, queryGroundReachability, queryNavalReachability,
        queryCombatParticipation, queryReactionCandidates,
        queryReactionStrength, querySpecialReaction,
    }
    if (typeof impl[fn] !== "function") return null
    const args = q.args || q.params
    return impl[fn].apply(null, Array.isArray(args) ? args : [])
}
