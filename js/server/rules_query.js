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
    for (const k of RULES_QUERY_L_KEYS) lSaved[k] = { had: Object.prototype.hasOwnProperty.call(L, k),
        value: k==="supply" && L[k] && typeof L[k]==="object" ? object_copy(L[k]) : L[k] }
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

function queryAspRemaining(faction) {
    return faction===AP || faction===JP ? get_asp_limit(faction) : 0
}

// Stacking facts only: this does not authorize movement, activation or a
// temporary combat exception. Project the whole own group, including pairs,
// and rebuild the engine's stacking cache rather than multiply a lead unit.
function queryProjectedStack(hex, incomingIds, ctx) {
    const faction=rules_query_own_faction(ctx),ids=[...new Set(incomingIds || [])]
    const empty=reason=>({eligible:false,fits:false,fitsForIncoming:false,reason})
    if(faction===null||ids.some(u=>!Number.isInteger(u)||pieces[u]?.faction!==faction))return empty("unauthorized-units")
    if(hex!==CHINA_BOX&&(!Number.isInteger(hex)||hex<0||hex>LAST_BOARD_HEX))return empty("invalid-target")
    return rules_query_snapshot(()=>{
        for(const u of ids)G.location[u]=hex
        L.overstack=null;fill_overstack(faction)
        const local=[];for_each_unit((u,p,loc)=>{if(p.faction===faction&&loc===hex)local.push(u)})
        const hqCount=local.filter(u=>pieces[u].class==="hq").length
        const groundAir=local.filter(u=>!["naval","hq"].includes(pieces[u].class))
        const naval=local.filter(u=>pieces[u].class==="naval")
        const buckets={groundAir:groundAir.every(u=>!is_overstack(hex,u,0)),naval:naval.every(u=>!is_overstack(hex,u,0)),hq:hqCount<=1}
        const relevant=new Set(ids.map(u=>pieces[u].class==="naval"?"naval":pieces[u].class==="hq"?"hq":"groundAir"))
        return {eligible:true,reason:null,fits:Object.values(buckets).every(Boolean),fitsForIncoming:[...relevant].every(k=>buckets[k]),buckets,
            counts:{engineGroundAirSlots:(L.overstack[hex]%128)>>1,naval:naval.length,hq:hqCount},
            unitIds:local,incomingIds:ids,evidence:"engine projected stacking; no movement permission"}
    },faction)
}

// A temporary combat stack needs a real public PBM escape, not an assumption
// that losses will free slots. Greedily reserve safe legal final destinations;
// every actual post-battle move will still be queried again in its real state.
function queryPbmStackRecovery(hex,incomingIds,ctx) {
    ctx=ctx || {}
    const faction=rules_query_own_faction(ctx),ids=[...new Set(incomingIds || [])]
    const empty=reason=>({recoverable:false,reason,moves:[]})
    if(faction===null||!ids.length||ids.some(u=>pieces[u]?.faction!==faction))return empty("unauthorized-units")
    if(!G.offensive?.active_cards?.[0] || ![ATTACK_STAGE,REACTION_STAGE].includes(G.offensive.stage)
        ||ctx.move_type&STRAT_MOVE)return empty("not-temporary-battle-movement")
    const active=G.offensive.active_units[faction] || []
    if(ids.some(u=>!active.includes(u)))return empty("units-not-activated")
    return rules_query_snapshot(()=>{
        for(const u of ids)G.location[u]=hex
        // Participants at this projected battle cannot use the extended PBM
        // reserved for units that neither entered nor joined any battle.
        G.offensive.all_bh ||= []
        set_add(G.offensive.all_bh,hex)
        const local=()=>active.filter(u=>G.location[u]===hex)
        const relevant=new Set(ids.map(u=>pieces[u].class==="naval"?"naval":pieces[u].class==="hq"?"hq":"groundAir"))
        const fits=()=>{const p=queryProjectedStack(hex,[],{faction});return [...relevant].every(k=>p.buckets[k])}
        if(fits())return {recoverable:true,reason:null,moves:[]}
        const movable=local().filter(u=>["air","naval"].includes(pieces[u].class)
            &&!(map_get(G.offensive.paths,u,[0])[0]&STRAT_MOVE))
            .sort((a,b)=>Number(pieces[a].cf||0)-Number(pieces[b].cf||0)||a-b)
        const moves=[]
        for(const unit of movable) {
            const targets=queryPbmDestinations(unit,{move_type:pieces[unit].class==="air"?AIR_MOVE:NAVAL_MOVE})
                .filter(h=>h!==hex&&queryProjectedStack(h,[unit],{faction}).fitsForIncoming)
                .sort((a,b)=>get_distance(hex,a)-get_distance(hex,b)||a-b)
            if(!targets.length)continue
            const destination=targets[0];G.location[unit]=destination;L.overstack=null
            moves.push({unit,hex:destination})
            if(fits())return {recoverable:true,reason:null,moves,evidence:"projected legal PBM destinations reserved; recheck after battle"}
        }
        return {recoverable:false,reason:"no-complete-safe-pbm-recovery",moves}
    },faction)
}

// 一组单位对某会战格的潜在战斗力合计（复用引擎 sum_combat_factor）。
function queryPotentialCombatStrength(units, battleHex) {
    return sum_combat_factor(units, battleHex)
}

// Public defending ground, including city garrisons created only when a battle
// begins. prepare_battle always deploys get_garrison() templates reduced; do not
// omit them just because their shared counters are currently off the map.
function queryDefendingGround(hex, opts) {
    const faction = opts && opts.faction !== undefined ? opts.faction : 1 - R
    return rules_query_snapshot(() => {
        const result = { hex, faction, units: [], cf: 0, lfs: [] }
        if ((faction !== JP && faction !== AP) || !Number.isInteger(hex) || hex < 0 || hex > LAST_BOARD_HEX)
            return result
        const builtIn = new Set(get_garrison(hex).filter(u => pieces[u]?.faction === faction))
        const ids = new Set(builtIn)
        for_each_unit_on_map((u, piece) => {
            if (piece.faction === faction && piece.class === "ground" && G.location[u] === hex) ids.add(u)
        })
        result.units = [...ids].sort((a, b) => a - b).map(id => {
            const piece = pieces[id]
            const reduced = builtIn.has(id) || !!set_has(G.reduced, id)
            return { id, definitionId: piece.id, name: piece.name, class: piece.class, faction: piece.faction,
                service: piece.service, location: hex, reduced, garrison: !!piece.garrison, oneStep: !!piece.one_step,
                cf: Number(reduced ? piece.rcf : piece.cf) || 0, fullCf: Number(piece.cf) || 0,
                rcf: Number(piece.rcf) || 0, lf: Number(piece.lf) || 0 }
        })
        result.cf = result.units.reduce((total, unit) => total + unit.cf, 0)
        result.lfs = result.units.map(unit => unit.lf)
        return result
    })
}

// National-status blockade uses a Japan-to-resource supply trace, not a count
// of captured ports. Reuse that exact traversal with its optional endpoint
// collector; no second movement graph or hypothetical route is synthesized.
// This intentionally runs only when a planner asks, never on every game view.
function queryBlockadeStatus() {
    return rules_query_snapshot(() => {
        const connectedResources = []
        const connected = !!check_japan_resource_trace(connectedResources)
        const resources = RESOURCE_HEX.filter(hex => get_map_data(hex).resource).map(hex => ({
            hex, name: get_map_data(hex).name || null,
            japanControlled: !!is_space_controlled(hex, JP), connected: connectedResources.includes(hex),
        }))
        const disconnectedResources = resources.filter(resource => resource.japanControlled && !resource.connected).map(resource => resource.hex)
        const startedTurn = Number(is_event_active(events.JAPAN_TRACE_RESOURCES) || 0)
        const turn = Number(G.turn || 0)
        const applicable = G.sid !== BURMA_SCENARIO && G.sid !== SOUTH_PACIFIC_SCENARIO
        // During an offensive, this turn's national-status check is still to
        // come. After that synchronous segment, political/attrition frames or
        // a timer just started this turn establish that it already happened.
        let currentPhaseChecked = startedTurn > 0 && startedTurn === turn
        for (let frame = L; frame; frame = frame.L) {
            if (["political_phase", "attrition_phase", "end_of_turn_phase"].includes(frame.P)) currentPhaseChecked = true
        }
        const wonByBlockade = G.result === "Allies" && L?.message === "Allies Victory by blockade"
        if (wonByBlockade) currentPhaseChecked = true
        const nextJudgementTurn = turn + (currentPhaseChecked ? 1 : 0)
        const completedPhases = connected || !startedTurn ? 0
            : Math.max(0, Math.min(3, nextJudgementTurn - startedTurn))
        const remainingPhases = applicable ? (wonByBlockade ? 0 : 3 - completedPhases) : null
        return { connected, allDisconnected: !connected, resources, connectedResources, disconnectedResources,
            startedTurn, applicable, requiredPhases: 3, completedPhases, remainingPhases,
            currentPhaseChecked, nextJudgementTurn,
            earliestWinTurn: !applicable || connected ? null : wonByBlockade ? turn
                : startedTurn ? Math.max(nextJudgementTurn, startedTurn + 2) : nextJudgementTurn + 2,
            timerWillReset: connected && startedTurn > 0, endpointOnly: true,
            assessment: "Public resource endpoints from the actual supply trace; remaining phases assume routes stay cut through each national-status check" }
    })
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
function queryActivationCandidates(hq, ctx) {
    // Existing public reaction/activation queries remain available without a
    // hypothetical card. A private hand preview must use the requesting role.
    const ownPreview = !!(ctx && ctx.cardId)
    const faction = ownPreview ? rules_query_own_faction(ctx) : ctx && ctx.faction
    if (ownPreview && (faction === null || !pieces[hq] || pieces[hq].faction !== faction)) return []
    return rules_query_snapshot(() => {
        if (!rules_query_prepare_card(ctx && { ...ctx, hqId: hq })) return []
        return rules_query_preview_activation_units(hq)
    }, faction)
}

// Check authorization before rules_query_snapshot applies a caller-supplied
// faction override. Otherwise a card-id probe could reveal an opponent's hand.
function rules_query_own_faction(ctx) {
    const faction = typeof R === "number" ? R : ROLES.indexOf(R)
    if (faction !== AP && faction !== JP) return null
    if (ctx && ctx.faction !== undefined && ctx.faction !== faction) return null
    return faction
}

// Ordinary military cards and the declarative ground-only Tsuji exception
// have an exact preview. Other hook-bearing cards must actually be played.
// The exception never executes the hook, draw, discard or random effects.
function rules_query_event_preview_eligible(card) {
    if (!card || card.type !== MILITARY) return false
    const hooks = Object.keys(card).filter(key => /^(before_|after_)/.test(key) && typeof card[key] === "function")
    return hooks.length === 0 || rules_query_optional_paratroopers(card)
        || card.c === COL_TSUJI && card.faction === JP && !scenario_data().before_unit_activation
        && hooks.length === 1 && hooks[0] === "before_unit_activation"
}

// These three cards have exactly one optional window. The enhanced Japanese
// planner commits to its legal skip action; no other hook is previewed.
function rules_query_optional_paratroopers(card) {
    const hooks=Object.keys(card || {}).filter(k=>/^(before_|after_)/.test(k) && typeof card[k]==="function")
    return card?.faction===JP && [58,59,60].some(n=>card.c===find_card(JP,n))
        && hooks.length===1 && hooks[0]==="before_movement"
        && card.before_movement===cards[find_card(JP,58)].before_movement
        && !scenario_data().before_movement
}

function rules_query_preview_activation_units(hq) {
    const groundOnly = G.offensive.type === EC && G.offensive.offensive_card === COL_TSUJI
        && !scenario_data().before_unit_activation
    return erasmus_preview_activatable_units(hq, groundOnly)
}

function rules_query_preview_hq(hq, card) {
    if (!hq) return true
    const piece = pieces[hq]
    if (!piece || piece.class !== "hq" || piece.faction !== G.active
        || G.location[hq] < 0 || G.location[hq] > LAST_BOARD_HEX
        || (set_has(G.oos, hq) && L.card !== GENERAL_ADACHI)) return false
    if (card && Array.isArray(card.hq) && card.hq.length && !card.hq.includes(hq)) return false
    // choose_hq.choose applies this before activate_units. Once an actual HQ
    // has been chosen, keep the engine's already-applied event modifications.
    if (!G.offensive.active_hq[G.active] && card?.logistic_alt?.[0]?.includes(hq))
        G.offensive.logistic = card.logistic_alt[1]
    G.offensive.active_hq[G.active] = hq
    return true
}

// Own-card preview shared by activation, movement and reaction queries. It
// reproduces activate_card/military_card's public setup, not their discard,
// draw, remove, log or random effects. Authorization precedes all hand access.
function rules_query_prepare_card(ctx) {
    if (!ctx || !ctx.cardId) return !!G.offensive?.active_cards?.[0]
    const c = Number(ctx.cardId), card = cards[c]
    const ownFaction = rules_query_own_faction(ctx)
    if (ownFaction === null || !card || card.faction !== ownFaction || G.active !== ownFaction) return false
    if (G.offensive?.active_cards?.[0] === c) {
        if (ctx.cardMode && ctx.cardMode !== (G.offensive.type === EC ? "event" : "ops")) return false
        const eventCard = G.offensive.type === EC ? card : null
        L.card = eventCard ? c : 0
        return rules_query_preview_hq(ctx.hqId, eventCard)
    }
    const cardMode = ctx.cardMode || "ops"
    if (!G.hand[G.active].includes(c) || !["ops", "event"].includes(cardMode)) return false
    if (cardMode === "event" && !rules_query_event_preview_eligible(card)) return false
    if (!get_allowed_actions(c).includes(cardMode)) return false
    reset_offensive()
    G.offensive.active_cards = [c]
    G.offensive.offensive_card = c
    G.offensive.attacker = G.active
    G.offensive.stage = ATTACK_STAGE
    G.offensive.type = cardMode === "event" ? EC : OC
    G.offensive.logistic = cardMode === "event" && Number.isInteger(card.logistic) ? card.logistic : card.ops
    if (cardMode === "event" && card.intelligence) G.offensive.intelligence = card.intelligence
    G.offensive.naval_move_distance = card.ops * 5
    G.offensive.ground_move_distance = card.ops * 2
    G.offensive.air_move_distance = card.ops
    if (card.faction === JP && card.ops >= 3 && is_event_active(events.BARGES)) G.offensive.barges = 2
    L.card = cardMode === "event" ? c : 0
    // The real choose_hq window refreshes supply before listing legal HQs.
    check_supply()
    return rules_query_preview_hq(ctx.hqId, cardMode === "event" ? card : null)
}

// Exact activation budget for an ordinary OC / hook-free military EC under a
// chosen HQ. `units` optionally supplies the proposed selection for the public
// Bridge over the River Kwai modifier; no future draw or opponent hand is read.
function queryCardPreview(cardId, ctx) {
    ctx = { ...(ctx || {}), cardId }
    const faction = rules_query_own_faction(ctx)
    const empty = reason => ({ eligible: false, reason, cardId, cardMode: ctx.cardMode || "ops",
        hqId: ctx.hqId || null, logistic: 0, hqBonus: 0, activationBudget: 0, units: [] })
    if (faction === null) return empty("unauthorized-faction")
    return rules_query_snapshot(() => {
        if (!rules_query_prepare_card(ctx)) return empty("no-playable-card")
        const card = cards[cardId], isEvent = G.offensive.type === EC
        if (isEvent && !rules_query_event_preview_eligible(card)) return empty("event-hooks-not-previewable")
        const hq = ctx.hqId || G.offensive.active_hq[faction]
        if (hq && !rules_query_preview_hq(hq, isEvent ? card : null)) return empty("illegal-hq")
        const piece = pieces[hq]
        const units = hq ? rules_query_preview_activation_units(hq) : []
        let hqBonus = piece ? Number(piece.cm || 0) : 0
        L.supply = {}
        const jointDisadvantage = !!piece && (piece.service === "joint" || piece.service === "us")
            && !check_hq_in_supply(hq, piece, US_SUPPLIED_HEX)
        if (jointDisadvantage) hqBonus -= 1
        const kwaiModifier = piece ? Number(get_kwai_modifier(piece) || 0) : 0
        const selected = Array.isArray(ctx.units) ? ctx.units : G.offensive.active_units[faction]
        const kwaiApplied = kwaiModifier && selected.some(u => pieces[u]?.faction === faction
            && KWAI_HQ_MOD.includes(get_map_data(G.location[u])?.region)) ? kwaiModifier : 0
        hqBonus += kwaiApplied
        return { eligible: true, reason: null, cardId: Number(cardId), cardMode: isEvent ? "event" : "ops",
            hqId: hq || null, logistic: G.offensive.logistic, hqBonus,
            activationBudget: hq ? Math.max(0, G.offensive.logistic + hqBonus) : null,
            jointDisadvantage, kwaiModifier, kwaiApplied, units,
            intelligence: G.offensive.intelligence,
            skippedOptionalPhase: isEvent && rules_query_optional_paratroopers(card) ? "paratroopers" : null,
            navalMoveDistance: G.offensive.naval_move_distance,
            groundMoveDistance: G.offensive.ground_move_distance,
            airMoveDistance: G.offensive.air_move_distance }
    }, faction)
}

function queryGroupMovementDestinations(units, ctx) {
    const empty = reason => ({ reachableHexes: [], paths: {}, moveMask: 0, reason })
    if (!Array.isArray(units) || !units.length) return empty("no-units")
    const ownFaction = rules_query_own_faction(ctx)
    if (ownFaction === null) return empty("unauthorized-faction")
    return rules_query_snapshot(() => {
        R = G.active
        if (!rules_query_prepare_card(ctx)) return empty("no-playable-card")
        const origin = G.location[units[0]]
        if (units.some(u => !pieces[u] || pieces[u].faction !== G.active || G.location[u] !== origin)) return empty("not-co-located")
        const services = new Set(units.map(u => pieces[u].service).filter(s => s === "army" || s === "navy"))
        if (G.inter_service[G.active] && services.size > 1) return empty("inter-service-rivalry")
        if (ctx && ctx.hqId) {
            const available = rules_query_preview_activation_units(ctx.hqId)
            const selected = (G.offensive.active_units[G.active] || [])
            if (units.some(u => !available.includes(u) && !selected.includes(u)))
                return empty(units.some(u => set_has(G.oos, u)) ? "out-of-supply" : "hq-activation")
        }
        G.active_stack = units.slice()
        L.move_type = ctx?.move_type || ANY_MOVE
        update_move_hex()
        if (L.move_type === AMPH_MOVE && L.move_data.asp_points > get_asp_limit(G.active))
            return { ...empty("insufficient-asp"), aspCost: L.move_data.asp_points }
        const reachableHexes = [], paths = {}
        for (let i = 0; i < (L.allowed_hexes || []).length; i += 2) {
            const hex = L.allowed_hexes[i]
            if (hex === origin) continue
            if (ctx?.move_type && !(L.allowed_hexes[i + 1][0] & ctx.move_type)) continue
            reachableHexes.push(hex)
            paths[hex] = L.allowed_hexes[i + 1].slice()
        }
        return { reachableHexes, paths, moveMask: L.move_data.move_type,
            aspCost: L.move_data.asp_points, reason: reachableHexes.length ? null : "no-legal-path" }
    }, ownFaction)
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
    const cf = set_has(G.reduced,unit) ? (Number(piece.rcf) || Math.ceil((Number(piece.cf) || 0) / 2)) : (Number(piece.cf) || 0)
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
            path: null, usesExtendedRange: !normal && extended, effectiveAttack: normal ? cf : extended ? Math.ceil(cf/2) : 0 }
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
    const cardContext = opts && opts.cardContext
    // The caller may preview its own proposed card before asking about public
    // enemy reactions. Do not allow this to become an enemy-hand probe.
    if (cardContext && rules_query_own_faction(cardContext) === null)
        return { air: [], carrier: [], naval: [], ground: [], hq: [], specialReaction: [] }
    return rules_query_snapshot(() => {
        if (cardContext) {
            G.active = R
            if (!rules_query_prepare_card(cardContext))
                return { air: [], carrier: [], naval: [], ground: [], hq: [], specialReaction: [] }
            // define_intelligence_condition resets the defender's logistics
            // to the offensive card's OPS, including when played as an EC.
            G.offensive.logistic=cards[G.offensive.offensive_card].ops
            G.active = reactionFaction
        }
        if (!G.offensive || !Array.isArray(G.offensive.battle_hexes)) {
            return { air: [], carrier: [], naval: [], ground: [], hq: [], specialReaction: [] }
        }
        const prevR = R
        R = reactionFaction
        if (targetHex !== undefined && targetHex !== null) {
            if (opts.targetOnly) G.offensive.battle_hexes = []
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
        const ground = [], groundOverland = []
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
                if (G.supply_cache[G.location[u]] & HEX_TEMP_FLAG3) groundOverland.push(u)
            }
        })
        // Reactions must be activated under one supplied HQ and share a card's
        // activation limit. Expose public alternatives, not an impossible sum
        // of every fleet and air force that can reach from different HQs.
        const hqOptions = []
        G.offensive.stage = REACTION_STAGE
        L.card = G.offensive.counter_offensive_card > 0 ? G.offensive.counter_offensive_card : 0
        for (const hq of HQ_LIST) {
            const piece = pieces[hq], location = G.location[hq]
            if (piece.faction !== reactionFaction || location > LAST_BOARD_HEX || location < 0
                || set_has(G.oos, hq) || !in_range_on_map(location, piece.cr, G.offensive.battle_hexes, reactionFaction).length) continue
            const units = erasmus_preview_activatable_units(hq).filter(u => pieces[u].faction === reactionFaction)
            L.supply = {}
            const jointDisadvantage = (piece.service === "joint" || piece.service === "us")
                && !check_hq_in_supply(hq, piece, US_SUPPLIED_HEX) ? 1 : 0
            hqOptions.push({ hq, units, budget: Math.max(0, Number(G.offensive.logistic || 0) + Number(piece.cm || 0) - jointDisadvantage) })
        }
        R = prevR
        return { air, carrier, naval, ground, groundOverland, aspGround: L.asp_ground_units.slice(),
            hq: hqOptions.map(x => x.hq), hqOptions, specialReaction: [] }
    }, reactionFaction)
}

// A preparation estimate after one OWN ground unit reaches a friendly hex.
// This does not authorize its transport or its later attack. Both actions
// still require ordinary queries in their actual positions and card windows.
function queryGroundPreparation(unit, originHex, targetHex, ctx) {
    ctx=ctx || {}
    const faction=rules_query_own_faction(ctx), piece=pieces[unit]
    const empty=reason=>({eligible:false,reason,projection:"friendly-ground-arrival",reachable:false})
    if (faction===null || piece?.faction!==faction || piece.class!=="ground"
        || G.location[unit]<0 || G.location[unit]>LAST_BOARD_HEX) return empty("unauthorized-unit")
    if (!Number.isInteger(originHex) || !Number.isInteger(targetHex) || originHex<0 || originHex>LAST_BOARD_HEX
        || targetHex<0 || targetHex>LAST_BOARD_HEX || !is_space_controlled(originHex,faction)) return empty("invalid-friendly-origin")
    return rules_query_snapshot(()=>{
        G.location[unit]=originHex
        const preview=queryCardPreview(ctx.cardId,{...ctx,faction})
        if (!preview.eligible || !preview.units.includes(unit)) return empty(preview.reason || "arrival-not-commandable")
        if (ctx.activationOnly) return {eligible:true,reason:null,projection:"friendly-ground-arrival",hqId:ctx.hqId,cardId:ctx.cardId,
            activationBudget:preview.activationBudget,activationOnly:true,reachable:null,path:null}
        const movement=queryGroupMovementDestinations([unit],{...ctx,faction,move_type:GROUND_MOVE})
        return {eligible:true,reason:null,projection:"friendly-ground-arrival",hqId:ctx.hqId,cardId:ctx.cardId,
            activationBudget:preview.activationBudget,reachable:movement.reachableHexes.includes(targetHex),
            path:movement.paths[targetHex] || null}
    },faction)
}

// A preparation estimate may relocate only public own ground to a currently
// friendly port. Escorts must already be there. The transaction grants no
// action: current transport and eventual assault are checked separately.
function queryAmphibiousPreparation(unitIds,originHex,targetHex,ctx) {
    ctx=ctx || {}
    const faction=rules_query_own_faction(ctx)
    const empty=reason=>({eligible:false,reason,projection:"friendly-ground-arrival-for-AA",reachable:false,units:[]})
    if (faction===null || !Array.isArray(unitIds) || unitIds.length<2 || unitIds.length>9
        || unitIds.some(id=>!Number.isInteger(id)) || new Set(unitIds).size!==unitIds.length) return empty("invalid-own-group")
    if (!Number.isInteger(originHex) || !Number.isInteger(targetHex) || originHex<0 || originHex>LAST_BOARD_HEX
        || targetHex<0 || targetHex>LAST_BOARD_HEX || !get_map_data(originHex)?.port
        || !is_space_controlled(originHex,faction)) return empty("invalid-friendly-port")
    const ground=[]
    for (const id of unitIds) {
        const piece=pieces[id]
        if (!piece || piece.faction!==faction || G.location[id]<0 || G.location[id]>LAST_BOARD_HEX
            || !["ground","naval"].includes(piece.class)) return empty("unauthorized-unit")
        if (piece.class==="ground") ground.push(id)
        else if (G.location[id]!==originHex) return empty("escort-not-at-origin")
    }
    if (!ground.length || ground.length===unitIds.length) return empty("ground-and-escort-required")
    const present=G.location.reduce((count,hex,id)=>count+Number(hex===originHex && pieces[id]?.faction===faction
        && ["ground","air"].includes(pieces[id]?.class)),0)
    if (present+ground.filter(id=>G.location[id]!==originHex).length>3) return empty("arrival-overstack")
    return rules_query_snapshot(()=>{
        for (const id of ground) G.location[id]=originHex
        check_supply()
        const preview=queryCardPreview(ctx.cardId,{...ctx,faction})
        if (!preview.eligible || unitIds.some(id=>!preview.units.includes(id))) return empty(preview.reason || "arrival-not-commandable")
        const movement=queryGroupMovementDestinations(unitIds,{...ctx,faction,move_type:AMPH_MOVE})
        if (!rules_query_prepare_card({...ctx,faction})) return empty("card-preview-unavailable")
        const supportIds=preview.units.filter(id=>!unitIds.includes(id) && (pieces[id]?.class==="air" && !pieces[id].b29
            && queryCombatParticipation(id,targetHex,{}).legal || pieces[id]?.class==="naval" && pieces[id].br>0
            && in_range_on_map(G.location[id],pieces[id].br,[targetHex],faction).length>0))
        return {eligible:true,reason:null,projection:"friendly-ground-arrival-for-AA",units:preview.units,
            supportIds,effectiveSupportCF:Object.fromEntries(supportIds.map(id=>[id,sum_combat_factor([id],targetHex)])),
            activationBudget:preview.activationBudget,reachable:movement.reachableHexes.includes(targetHex),
            path:movement.paths[targetHex] || null,aspCost:Number(movement.aspCost || 0)}
    },faction)
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
    if (reactingFaction!==JP && reactingFaction!==AP) return {eligible:false,reason:"invalid-faction",respondingHq:null,legalUnits:[]}
    return rules_query_snapshot(() => {
        if (target === null || target === undefined || !Number.isInteger(target)) {
            return { eligible: false, reason: "no-target", respondingHq: null, legalUnits: [] }
        }
        const md = get_map_data(target)
        if (!md || !md.named) return { eligible: false, reason: "not-named", respondingHq: null, legalUnits: [] }
        // Match special_reaction._begin: the defending side recomputes supply
        // and ZOI. Pre-card caches can otherwise hide a real reaction trigger.
        check_supply()
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
    }, reactingFaction)
}

// Public baseline only: unknown enemy intelligence/counter cards are never
// read. Unprojected movement can change ZOI, so expose an interval rather than
// claim an exact reaction chance from static target geometry.
function queryPublicReactionChance(target, ctx) {
    ctx=ctx || {}
    const faction=rules_query_own_faction(ctx)
    const empty=reason=>({eligible:false,reason,pTargetReinforcement:null,unknownReasons:[reason]})
    if(faction===null)return empty("unauthorized-faction")
    return rules_query_snapshot(()=>{
        if(!rules_query_prepare_card(ctx))return empty("no-playable-card")
        if(!Number.isInteger(target)||!get_map_data(target))return empty("invalid-target")
        const card=cards[G.offensive.offensive_card],eventMode=G.offensive.type===EC,enemy=1-faction
        check_supply()
        const unknownReasons=["enemy-intelligence-and-counter-cards-unobserved"]
        let modifier=0,unknownModifier=false
        const hookCards=G.offensive.active_cards.filter(c=>c!==G.offensive.offensive_card || eventMode)
        for(const c of hookCards)if(cards[c]?.before_intelligence_roll){
            if(c===find_card(JP,12)){
                let ca=false
                for_each_unit((u,p,loc)=>{if(p.type==="ca"&&p.faction===AP&&p.service==="navy"
                    &&get_distance(FRENCH_FRIGATE_SHOALS,loc)<=3)ca=true})
                if(!(G.supply_cache[FRENCH_FRIGATE_SHOALS]&AP_ZOI)&&!ca)modifier+=4
            }else unknownModifier=true
        }
        if(scenario_data().before_intelligence_roll)unknownModifier=true
        const value=eventMode&&card.ec ? card.ec : card.oc
        const chance=m=>Math.max(0,Math.min(9,Math.floor(Number(value)-m)+1))/10
        const zoiKnown=!!G.offensive.zoi_intelligence_modifier
        if(!zoiKnown)unknownReasons.push("future-movement-zoi-not-projected")
        if(unknownModifier)unknownReasons.push("public-modifier-hook-not-modeled")
        const qRoll=unknownModifier ? {low:0,high:.9} : zoiKnown
            ? {low:chance(modifier-2),high:chance(modifier-2)}
            : {low:chance(modifier),high:chance(modifier-2)}
        const intelligence=eventMode&&card.intelligence ? card.intelligence : null
        const qIntel=intelligence===INTERCEPT||intelligence===AMBUSH ? {low:1,high:1}
            : intelligence===SURPRISE ? {low:0,high:0} : qRoll
        const defended=!!is_faction_units(target,enemy)
        const special=!defended&&ctx.amphibious && querySpecialReaction({target,reactingFaction:enemy}).eligible
        const qSpecial=special?qRoll:{low:1,high:1}
        G.offensive.logistic=card.ops
        const candidates=queryReactionCandidates({reactionFaction:enemy,targetHex:target,targetOnly:true})
        const legal=new Set([...(candidates.air||[]),...(candidates.carrier||[]),...(candidates.naval||[]),...(candidates.ground||[])])
        const hasLegalHqReaction=(candidates.hqOptions||[]).some(h=>h.budget>0&&h.units.some(u=>legal.has(u)))
        const trigger=(defended||special)&&hasLegalHqReaction&&!(eventMode&&card.c===CARRIER_RAID)
        const pTargetReinforcement=trigger ? {low:qIntel.low*qSpecial.low,high:qIntel.high*qSpecial.high} : {low:0,high:0}
        return {eligible:true,reason:null,cardId:card.c,cardMode:eventMode?"event":"ops",qRoll,qIntel,qSpecial,
            pTargetReinforcement,defended,specialReaction:special,hasLegalHqReaction,
            zoiEvidence:zoiKnown?"already-crossed":"future-movement-unknown",modifierEvidence:{value:modifier,unknown:unknownModifier},
            estimate:"public-baseline-bounds",unknownReasons}
    },faction)
}

// 神风攻击标准 (清单 #14)：镜像引擎 set_kamikaze_able_battles + kamikaze_attack._begin 的
// 合法资格，不靠卡牌名/单位名正则。返回 { met, legalCapitalShipTargets, eligibleAirUnits }。
//   legalCapitalShipTargets —— 可被神风命中的盟军已承诺海军单位(BB/CV 等, 在神风战斗格内)。
//   eligibleAirUnits        —— 可承担减损、ebr 能打到神风战斗格的日军航空单位。
// battleHex 注入时只判该格；否则按引擎口径求全部神风战斗格(距东京≤11 且盟军海军已承诺)。
function queryKamikazeStandard(battleHex) {
    return rules_query_snapshot(() => {
        const empty = { met: false, legalCapitalShipTargets: [], eligibleAirUnits: [] }
        if (!G.offensive || !Array.isArray(G.offensive.battle_hexes)) return empty
        const apCommittedNaval = new Set()
        ;(Array.isArray(G.offensive.active_units?.[AP]) ? G.offensive.active_units[AP] : []).forEach(u => {
            const p = pieces[u]
            if (p && p.faction === AP && p.class === "naval" && unit_on_board(u)) {
                apCommittedNaval.add(get_unit_battle_hex(u))
            }
        })
        let battles
        if (battleHex !== undefined && battleHex !== null && Number.isInteger(battleHex)) {
            battles = [battleHex]
        } else {
            battles = G.offensive.battle_hexes.filter(h => get_distance(h, TOKYO) <= 11 && apCommittedNaval.has(h))
        }
        if (!battles.length) return empty
        const eligibleAirUnits = []
        for_each_unit_on_map((u, piece, loc) => {
            if (piece.faction === JP && piece.class === "air" && in_range_on_map(loc, piece.ebr, battles, JP).length) {
                eligibleAirUnits.push(u)
            }
        })
        const legalCapitalShipTargets = []
        ;(Array.isArray(G.offensive.active_units?.[AP]) ? G.offensive.active_units[AP] : []).forEach(u => {
            const p = pieces[u]
            if (!p || p.faction !== AP || p.class !== "naval" || !unit_on_board(u)) return
            if (battles.indexOf(get_unit_battle_hex(u)) >= 0) legalCapitalShipTargets.push(u)
        })
        return { met: legalCapitalShipTargets.length > 0 && eligibleAirUnits.length > 0, legalCapitalShipTargets, eligibleAirUnits }
    })
}

// 潜艇合法目标 (清单 #15)：RTT 给出"能合法受潜艇打击"的敌方海军单位(镜像
// P.submarine_attack._begin 的 allowed_units 口径)，Erasmus 决策层再按 CV→BB→CA→DD 排序。
// 返回 { legalTargets }，每项为 { id, type, lf, cf, name, reduced }。
function querySubmarineTargets(opts) {
    const attackerFaction = (opts && opts.attackerFaction !== undefined)
        ? opts.attackerFaction : (G.offensive ? G.offensive.attacker : 1 - R)
    return rules_query_snapshot(() => {
        const legalTargets = []
        if (!G.offensive || !Array.isArray(G.offensive.active_units)) return { legalTargets }
        ;(G.offensive.active_units[attackerFaction] || []).forEach(u => {
            const p = pieces[u]
            if (!p || p.class !== "naval" || !unit_on_board(u) || set_has(G.reduced, u)) return
            legalTargets.push({ id: u, type: p.type || null, lf: Number(p.lf) || 0, cf: Number(p.cf) || 0, name: p.name || p.id || String(u), reduced: false })
        })
        return { legalTargets }
    })
}

// PBM 合法落点 (清单 #16/#17/#18)：快照内设 active_stack/move_type、暂切 POST_BATTLE_STAGE，
// 跑引擎 update_move_hex() 后收割 L.allowed_hexes。Erasmus 只在这些合法格上做图表优先级排序。
function queryPbmDestinations(unit, ctx) {
    return rules_query_snapshot(() => {
        const piece = pieces[unit]
        const loc = G.location[unit]
        if (!piece || !Number.isInteger(loc) || !G.offensive || !Array.isArray(G.offensive.active_cards) || !G.offensive.active_cards[0]) {
            return []
        }
        G.active_stack = [unit]
        L.move_type = (ctx && ctx.move_type) || (piece.class === "air" ? AIR_MOVE : piece.class === "naval" ? NAVAL_MOVE : ANY_MOVE)
        const stageSaved = G.offensive.stage
        G.offensive.stage = POST_BATTLE_STAGE
        try {
            update_move_hex()
        } finally {
            G.offensive.stage = stageSaved
        }
        const dm = L.allowed_hexes
        const hexes = []
        for (let i = 0; i < dm.length; i += 2) hexes.push(dm[i])
        return hexes
    })
}

// ============================================================================
// 测试/工具分发
// ============================================================================

const RULES_QUERY_FNS = [
    "queryZoi", "queryNonNeutralZoi", "queryGroundMoveCost", "querySupplyStatus", "queryAspRemaining", "queryProjectedStack", "queryPbmStackRecovery",
    "queryPotentialCombatStrength", "queryDefendingGround", "queryBlockadeStatus", "queryBattleTable", "querySpaceControlled",
    "queryFactionUnits", "queryLegalReinforcementHexes", "queryEmergencyRetreatHexes",
    "queryCardPreview", "queryActivationCandidates", "queryGroupMovementDestinations", "queryGroundPreparation", "queryAmphibiousPreparation", "queryGroundReachability", "queryNavalReachability",
    "queryCombatParticipation", "queryReactionCandidates",
    "queryReactionStrength", "querySpecialReaction", "queryPublicReactionChance",
    "queryKamikazeStandard", "querySubmarineTargets", "queryPbmDestinations",
]

function rules_query_dispatch(q) {
    if (!q || typeof q !== "object") return null
    const fn = q.fn || q.query
    const impl = {
        queryZoi, queryNonNeutralZoi, queryGroundMoveCost, querySupplyStatus, queryAspRemaining, queryProjectedStack, queryPbmStackRecovery,
        queryPotentialCombatStrength, queryDefendingGround, queryBlockadeStatus, queryBattleTable, querySpaceControlled,
        queryFactionUnits, queryLegalReinforcementHexes, queryEmergencyRetreatHexes,
        queryCardPreview, queryActivationCandidates, queryGroupMovementDestinations, queryGroundPreparation, queryAmphibiousPreparation, queryGroundReachability, queryNavalReachability,
        queryCombatParticipation, queryReactionCandidates,
        queryReactionStrength, querySpecialReaction, queryPublicReactionChance,
        queryKamikazeStandard, querySubmarineTargets, queryPbmDestinations,
        queryJapanResourceTrace: () => rules_query_snapshot(() => {
            try { return !!check_japan_resource_trace() } catch (e) { return null }
        }),
    }
    if (typeof impl[fn] !== "function") return null
    const args = q.args || q.params
    return impl[fn].apply(null, Array.isArray(args) ? args : [])
}
