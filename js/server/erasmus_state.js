// 回合级状态机 AI 核心 — erasmus-v2.0-zh.7
//
// 移植自 erasmus_complete_ai_execution_engine.py（同源参考引擎）: 把完整 py 决策
// 树 + 有序目标链 + 事件战略搬到 RTT 真实引擎状态上。选轴时机 = 回合级首卡
// （每方每游戏回合第一张“Select card to play.”窗口求值一次、钉住该回合战略，
// 下回合首卡重评）。仅完整全图剧本（菲律宾/DEI/日本齐全，排除 South Pacific 与
// Burma 子图）启用；gate 关时本模块必须零行为（由 erasmus.js 短路保证）。
//
// 分层:
//   esm_* 状态机      —— gate / 阶段门槛 / 逐(seed,sid,role) 缓存 / 首卡检测
//   esm_build_ctx()   —— 引擎真实状态 -> py 同名字段(布尔 ctx)，供决策树消费
//   esm_jp_* esm_al_* —— 决策树求值（分支/阈值逐字照抄 py L583-743）
//   ESM_JP_LIB/AL     —— py 策略表(L169-513) -> JS（名称/说明逐字；token=可解析目标）
//   esm_pin_strategy()—— 供 erasmus.js 在每个窗口调用；首卡窗才求值，其余沿用缓存
//
// 确定性: 不进引擎 RNG(绝不碰 G.seed)。随机分支(d10) 用 erasmus_hash 派生。

// ---- 策略 kind(策略级: 驱动选牌窗/微执行) --------------------------------
// CONQUEST: 有序夺控/作战目标链(喂 eop 焦点层); EVENT: 事件战略(选事件牌);
// PASS: 本回合跳; GARRISON: 只向日本仍控制但缺指定兵种的国防圈格调动;
// DEFEND: 围绕本州盟军地面部队集结、支援并反击，禁止回落到南方资源轴;
// ABSTRACT: 抽象目标(B29/原子弹)。D4 起不再按 EVENT 空打事件 —— 用 OC 打攻势把
// 抽象目标落成可执行链(推进B29=前推轰炸基地链/使 B29 可达; 原子弹胜利=资源夺回链),
// 选牌窗意图 = OPS(原子弹胜利持苏联牌时优先事件)。
//
// ---- 目标级 kind(每行 parse_goals, 忠实 py L801-943) ----------------------
// CONQUEST 夺取/投降名单; SUPPRESS 压制AZOI(不夺控); GARRISON 驻军(需己控);
// PORTS 加强港口; INVADE_JAPAN 登陆日本本土(预案 marker 或带城市名单);
// B29/NAVAL/ADMIN 行政/舰队/事件 —— 无 hex 或交事件窗。
// chain(喂 eop 焦点层) = parse_goals 全部 hex 去重保序(py execute 的 target_chain)。

var ESM_GATE_CACHE = {}
var ESM_LOCKED = {}          // key `${seed}|${sid}` -> { turn, role: {Japan:{...},Allies:{...}}, seenOrd, bombFail, lastTurn }
var ESM_PREP = {}            // key sid -> 预计算地理清单(一次性)

// ===========================================================================
// Gate / 剧本门槛
// ===========================================================================
function esm_gate_on() {
    if (typeof G === "undefined" || !G) return false
    const sid = G.sid
    if (sid in ESM_GATE_CACHE) return ESM_GATE_CACHE[sid]
    let on = true
    if (sid === SOUTH_PACIFIC_SCENARIO || sid === BURMA_SCENARIO) on = false
    if (on && typeof get_map_data === "function") {
        // 内容级自检: 主图应含 菲律宾 / 东印度 / 日本 区域(即完整全图剧本)。
        let has = { Philippines: false, DEI: false, Japan: false }
        for (let i = 0; i <= LAST_BOARD_HEX && !(has.Philippines && has.DEI && has.Japan); i++) {
            const md = get_map_data(i)
            if (!md || !md.region) continue
            if (md.region === "Philippines") has.Philippines = true
            else if (md.region === "DEI" || md.region === "Java" || md.region === "Sumatra" || md.region === "Borneo" || md.region === "Celebes") has.DEI = true
            else if (md.region === "Japan") has.Japan = true
        }
        if (!(has.Philippines && has.DEI && has.Japan)) on = false
    }
    ESM_GATE_CACHE[sid] = on
    return on
}

// 阶段门槛（图表页脚原文；非纯回合, 由真实地图状态触发）。
function esm_region(hex) {
    try { const md = get_map_data(hex); return md ? md.region : null } catch (e) { return null }
}
function esm_jp_port_within_8_tokyo_ap_controlled() {
    const list = esm_geo().portsWithin8Tokyo
    for (const h of list) if (is_space_controlled(h, AP)) return true
    return false
}
function esm_phase(role) {
    const turn = G.turn
    const s = n => (G.surrender && G.surrender[n] ? true : false)
    if (role === "Japan") {
        if (esm_jp_port_within_8_tokyo_ap_controlled()) return "late"
        const malPhilDei = (typeof nations !== "undefined") &&
            s(nations.MALAYA.id) && s(nations.DEI.id) && s(nations.PHILIPPINES.id)
        if (malPhilDei || turn >= 4) return "mid"
        return "early"
    }
    // Allies
    const saipanAP = is_space_controlled(esm_idx("Saipan"), AP)
    if (saipanAP || turn >= 9) return "late"
    if (turn >= 4) return "mid"
    return "early"
}

// ---- 地理/索引一次性预计算 -------------------------------------------------
function esm_idx(token) {
    return eop_resolve_token(token)
}
function esm_geo() {
    const sid = G.sid
    if (ESM_PREP[sid]) return ESM_PREP[sid]
    const g = { portsWithin8Tokyo: [], controlledHexesWithin8Tokyo: [], airfieldsWithin8Tokyo: [], airfieldsWithin5: [], deiPorts: [], ngPorts: [], resourceHexes: [], allNamed: {} }
    const isDEI = r => r === "DEI" || r === "Java" || r === "Sumatra" || r === "Borneo" || r === "Celebes"
    for (let i = 0; i <= LAST_BOARD_HEX; i++) {
        const md = get_map_data(i)
        if (!md) continue
        if (md.resource) g.resourceHexes.push(i)
        if (is_controllable_hex(i) && md.region !== "China" && get_distance(i, TOKYO) <= 8) g.controlledHexesWithin8Tokyo.push(i)
        if (md.port) {
            if (md.region === "Philippines") { /* no op */ }
            if (isDEI(md.region)) g.deiPorts.push(i)
            if (md.region === "Guinea") g.ngPorts.push(i)
            if (md.region !== "China" && get_distance(i, TOKYO) <= 8) g.portsWithin8Tokyo.push(i)
        }
        if (md.airfield && md.region !== "China" && get_distance(i, TOKYO) <= 8) g.airfieldsWithin8Tokyo.push(i)
        if (md.airfield && !md.port && md.region !== "China" && get_distance(i, TOKYO) <= 5) g.airfieldsWithin5.push(i)
        if (md.name) g.allNamed[String(md.name).toLowerCase()] = i
    }
    ESM_PREP[sid] = g
    return g
}

// ===========================================================================
// 状态机缓存
// ===========================================================================
function esm_key(seed) { return `${seed}|${G.sid}` }
// D1: 新对局出现时, 把 erasmus_ops 的外部链覆盖(EOP_OVERRIDE)一并清掉。
// gate 开路径的 erasmus.js 只在 gate 关/异常时清链, 多局同进程下第 2 局起会沿用
// 上一局末的链(实测: 同种子单局=T10、批内第2局=T12) —— 这里在新局边界统一清。
function esm_clear_cross_game() {
    if (typeof eop_clear_all_chains === "function") { try { eop_clear_all_chains() } catch (e) { /* ignore */ } }
}
function esm_new_lock(seed, ord) {
    const e = { turn: G.turn, role: { Japan: null, Allies: null }, seenOrd: ord || 0, lastOrdTurn: 0 }
    esm_clear_cross_game()
    return e
}
function esm_lock(seed) {
    const k = esm_key(seed)
    let e = ESM_LOCKED[k]
    if (!e) { e = esm_new_lock(seed, arguments[1]); ESM_LOCKED[k] = e }
    // 新对局检测: 回合回退 或 actionOrdinal 回退(多局同进程防串台)。
    if ((G.turn < e.turn && e.turn > 0) || (arguments[1] !== undefined && arguments[1] < e.seenOrd && e.seenOrd > 0)) {
        delete ESM_LOCKED[k]
        e = esm_new_lock(seed, arguments[1])
        ESM_LOCKED[k] = e
        ESM_PREP = {} // 清一次地理缓存（保险, 通常同 sid 不变）
    }
    e.turn = G.turn
    return e
}
function esm_is_card_window(view) {
    const a = view && view.actions || {}
    return (typeof a.card !== "undefined" || (Array.isArray(a.card))) && /select card to play/i.test(String(view.prompt || ""))
}
function esm_is_card_action_window(view) {
    const a = view && view.actions || {}
    return /select action/i.test(String(view.prompt || "")) && ["ops", "event", "discard", "future_offensive", "inter_service"].some(x => a[x] !== undefined)
}
function esm_role_faction(role) { return role === "Japan" ? JP : AP }

// ===========================================================================
// 日志字段(手牌 LV 合计 —— 用户选定口径) 与 通用谓词
// ===========================================================================
function esm_jp_logistics() {
    let sum = 0
    for (const c of (G.hand && G.hand[JP]) || []) {
        const lv = cards[c] && cards[c].logistic
        if (typeof lv === "number") sum += lv
    }
    return sum
}
function esm_count_carriers(faction) {
    let n = 0
    for (let u = 1; u < pieces.length; u++) {
        if (pieces[u].class !== "naval" || pieces[u].faction !== faction || !pieces[u].br) continue
        const loc = G.location[u]
        if (loc >= 0 && loc <= LAST_BOARD_HEX) n++
    }
    return n
}
function esm_count_ground(faction, regionPred) {
    let n = 0
    for (let u = 1; u < pieces.length; u++) {
        const p = pieces[u]
        if (p.faction !== faction || p.class !== "ground") continue
        const loc = G.location[u]
        if (!(loc >= 0 && loc <= LAST_BOARD_HEX)) continue
        if (regionPred(esm_region(loc))) n++
    }
    return n
}
// AP HQ 是否存在某区域且断补
function esm_ap_hq_oos_in(regionPred) {
    const hqs = [HQ_SOUTH_WEST, HQ_MALAYA, HQ_ABDA, HQ_SEAC, HQ_ANZAC, HQ_CENTRAL_PACIFIC]
    for (const u of hqs) {
        const loc = G.location[u]
        if (!(loc >= 0 && loc <= LAST_BOARD_HEX)) continue
        if (regionPred(esm_region(loc)) && (G.oos ? set_has(G.oos, u) : false)) return true
    }
    return false
}
function esm_ap_hq_supplied_at(regionPred) {
    const hqs = [HQ_SOUTH_WEST, HQ_MALAYA, HQ_ABDA]
    for (const u of hqs) {
        const loc = G.location[u]
        if (!(loc >= 0 && loc <= LAST_BOARD_HEX)) continue
        if (regionPred(esm_region(loc)) && !(G.oos ? set_has(G.oos, u) : false)) return true
    }
    return false
}
function esm_card_removed(card) {
    return (G.removed && G.removed[AP]) ? set_has(G.removed[AP], card) : false
}
function esm_soviet_occurred() {
    return (G.removed && G.removed[AP]) ? set_has(G.removed[AP], SOVIET_INVADE) : false
}
function esm_soviet_playable() {
    if (!(G.hand && G.hand[AP]) || !set_has(G.hand[AP], SOVIET_INVADE)) return false
    try { return !!cards[SOVIET_INVADE].can_play() } catch (e) { return false }
}

// ===========================================================================
// 决策树自检用纯 ctx 版: 与 py 分支逐字一致(boolean 输入 -> 策略名)
// 供保真自测: 同 ctx 应得同策略名。
// ===========================================================================
function esm_d10_of(seedText) { return erasmus_hash(seedText) % 10 }

// JP 早期 (页1) —— 逐字: py evaluate_early
function esm_trace_pred(ctx, node, predicate, value) {
    if (!ctx._nodePath) ctx._nodePath = []
    if (!ctx._conditions) ctx._conditions = []
    ctx._nodePath.push(node)
    ctx._conditions.push({ nodeId: node, predicate, result: !!value })
    return !!value
}
function esm_has_class_at(hex, faction, cls) {
    if (!(hex >= 0 && hex <= LAST_BOARD_HEX)) return false
    for (let u = 1; u < pieces.length; ++u)
        if (pieces[u].faction === faction && pieces[u].class === cls && G.location[u] === hex) return true
    return false
}

// 第3页脚注[2]：驻军全称量词只覆盖“日本仍控制”的格。盟军已经占领的港口/机场
// 不属于最终国防圈的驻军对象；把它们纳入 every() 会让 BC 永久为假，进而永远无法
// 进入 E“盟军地面单位在本州？”与最终防御战略。
function esm_jp_final_perimeter_status() {
    const ports = esm_geo().portsWithin8Tokyo.filter(h => is_space_controlled(h, JP))
    const airfields = esm_geo().airfieldsWithin5.filter(h => is_space_controlled(h, JP))
    return {
        portsGarrisoned: ports.every(h => esm_has_class_at(h, JP, "ground")),
        airfieldsGarrisoned: airfields.every(h => esm_has_class_at(h, JP, "air")),
        consideredPorts: ports,
        consideredAirfields: airfields,
    }
}
function esm_large_ground_steps(faction, regionPred) {
    let steps = 0
    for (let u = 1; u < pieces.length; ++u) {
        const p = pieces[u], loc = G.location[u]
        if (!p || p.faction !== faction || p.class !== "ground" || Number(p.lf || 0) < 12) continue
        if (!(loc >= 0 && loc <= LAST_BOARD_HEX) || !regionPred(esm_region(loc))) continue
        steps += G.reduced && set_has(G.reduced, u) ? 1 : 2
    }
    return steps
}
function esm_cbi_defense_complete() {
    const requirements = [
        ["army_ap_1_ind", "Rangoon"], ["army_ap_b_ind", "Akyab"],
        ["army_ap_66_cn", "Lashio"], ["army_ap_6_cn", "Mandalay"],
        ["army_ap_5_cn", "Myitkyina"], ["army_ap_1_bu", "Imphal"],
    ]
    return requirements.every(([id, place]) => {
        const u = find_piece(id), loc = G.location[u]
        if (loc === ELIMINATED_BOX || loc === PERM_ELIMINATED) return true
        const target = esm_idx(place)
        return target !== null && loc === target
    })
}
function esm_trace_action(ctx, node, strategy) {
    if (!ctx._nodePath) ctx._nodePath = []
    ctx._nodePath.push(node)
    ctx._strategyNode = node
    return strategy
}
function esm_trace_d10(ctx, node, d10, salt) {
    const roll = typeof d10 === "number" ? d10 : esm_d10_of(ctx._seed + salt)
    if (!ctx._nodePath) ctx._nodePath = []
    if (!ctx._dice) ctx._dice = []
    ctx._nodePath.push(node)
    ctx._dice.push({ nodeId: node, sides: 10, result: roll, range: "0-9" })
    return roll
}

// 第1页实际箭头。组合框保持为单一节点，证据仍逐项写入 conditions。
function esm_jp_eval_early(ctx, d10) {
    ctx._nodePath = ["JP01-START"]; ctx._conditions = []; ctx._dice = []
    const A = esm_trace_pred(ctx, "JP01-A", "AP_HQ_OOS_PHI_DEI_MALAYA", ctx.jp_A)
    if (!A) {
        const cd = esm_trace_pred(ctx, "JP01-CD", "JP_HAND_GE_3_AND_RES_LT_13", ctx.cards_in_hand >= 3 && ctx.jp_D_res_lt_13)
        if (!cd) return esm_trace_action(ctx, "JP01-S-CONSERVATIVE-AIR", "保守的空优战略")
        const f = esm_trace_pred(ctx, "JP01-F", "JP_LOGISTICS_GTE_20", ctx.jp_F_logistics_ge_20)
        return esm_trace_action(ctx, f ? "JP01-S-AGGRESSIVE-AIR" : "JP01-S-CONSERVATIVE-AIR", f ? "激进的空优战略" : "保守的空优战略")
    }
    const B = esm_trace_pred(ctx, "JP01-B", "DEI_SURRENDER_HEXES_ALL_OCCUPIED", ctx.jp_B_dei_surrender_hexes_occupied)
    if (!B) {
        const g = esm_trace_pred(ctx, "JP01-G", "TURN_GE_3", ctx.current_turn >= 3)
        if (g) return esm_trace_action(ctx, "JP01-S-AGGRESSIVE-RESOURCE", "激进的南方资源战略")
        const acd = esm_trace_pred(ctx, "JP01-ACD", "A_AND_HAND_GE_3_AND_RES_LT_13", ctx.cards_in_hand >= 3 && ctx.jp_D_res_lt_13)
        return esm_trace_action(ctx, acd ? "JP01-S-AGGRESSIVE-RESOURCE" : "JP01-S-EVENT", acd ? "激进的南方资源战略" : "事件战略")
    }
    const cehi = esm_trace_pred(ctx, "JP01-CEHI", "HAND_GE_3_AND_RES_GE_13_OR_LOGISTICS_LE_19_AND_DEI_AZOI", ctx.cards_in_hand >= 3 && (!ctx.jp_D_res_lt_13 || (ctx.jp_H_logistics_le_19 && ctx.jp_I_azoi_covers_dei_ports)))
    if (cehi) return esm_trace_action(ctx, "JP01-S-PERIMETER", "外围防御战略")
    const cjebik = esm_trace_pred(ctx, "JP01-CJEBIK", "HAND_GE_3_AND_RABAUL_GUADALCANAL_AND_RES_GE_13_AND_DEI_OR_NG", ctx.cards_in_hand >= 3 && ctx.jp_J_controls_rabaul_guadalcanal && !ctx.jp_D_res_lt_13 && (ctx.jp_B_dei_surrender_hexes_occupied || ctx.jp_I_azoi_covers_dei_ports || ctx.jp_K_controls_4_to_6_ng_ports))
    if (!cjebik) {
        const cl = esm_trace_pred(ctx, "JP01-CL", "HAND_GE_3_AND_MAL_PHI_DEI_INCOMPLETE", ctx.cards_in_hand >= 3 && ctx.jp_L_mal_phil_dei_not_conquered)
        if (cl) return esm_trace_action(ctx, "JP01-S-AGGRESSIVE-RESOURCE", "激进的南方资源战略")
        const m = esm_trace_pred(ctx, "JP01-M", "PERIMETER_TARGET_1_COMPLETE", ctx.jp_M_perimeter_target_1_complete)
        if (!m) return esm_trace_action(ctx, "JP01-S-PERIMETER", "外围防御战略")
    }
    const roll = esm_trace_d10(ctx, "JP01-D10", d10, ":jp-early")
    if (roll <= 2) return esm_trace_action(ctx, "JP01-S-EVENT", "事件战略")
    if (roll <= 6) return esm_trace_action(ctx, "JP01-S-AGGRESSIVE-RESOURCE", "激进的南方资源战略")
    return esm_trace_action(ctx, "JP01-S-CENTRAL-PACIFIC", "中太平洋战略")
}
// 保留 py 分支全量字段——以别名封装, 保持与 py 逐字可读
function esm_jp_eval_early_py(ctx, d10) {
    // 别名映射 只用真字段, 实现见上 esm_jp_eval_early
    return esm_jp_eval_early(ctx, d10)
}

// JP 中期 (页2) —— py evaluate_mid
function esm_jp_eval_mid(ctx, d10) {
    ctx._nodePath = ["JP02-START"]; ctx._conditions = []; ctx._dice = []
    if (!esm_trace_pred(ctx, "JP02-A", "JP_HAND_GE_3", ctx.cards_in_hand >= 3)) {
        if (esm_trace_pred(ctx, "JP02-B", "JP_CAN_PASS", ctx.can_pass)) return esm_trace_action(ctx, "JP02-S-PASS", "PASS")
        return esm_trace_action(ctx, "JP02-S-EVENT", "事件战略")
    }
    if (esm_trace_pred(ctx, "JP02-C", "JP_RESOURCE_COUNT_LT_13", ctx.jp_D_res_lt_13)) return esm_trace_action(ctx, "JP02-S-RESOURCE", "资源战略")
    const hi = esm_trace_pred(ctx, "JP02-D", "JP_LOGISTICS_GTE_20", ctx.jp_F_logistics_ge_20)
    if (hi && esm_trace_pred(ctx, "JP02-E", "US_POLITICAL_WILL_LT_4", ctx.jp_E_us_will_lt_4)) return esm_trace_action(ctx, "JP02-S-CENTRAL-PACIFIC", "中太平洋战略")
    if (!hi && !esm_trace_pred(ctx, "JP02-G", "JP_LOGISTICS_GTE_15", ctx.jp_G_logistics_ge_15)) return esm_trace_action(ctx, "JP02-S-PERIMETER", "外围防御战略")
    if (!esm_trace_pred(ctx, "JP02-F", "BURMA_SURRENDERED", ctx.jp_F_burma_surrendered)) return esm_trace_action(ctx, "JP02-S-CBI", "中缅印战略")
    const hij = esm_trace_pred(ctx, "JP02-HIJ", "GANDHI_OR_MORE_LARGE_STEPS_AND_LOGISTICS_GTE_18", (ctx.jp_H_has_gandhi || ctx.jp_I_more_steps_in_burma) && ctx.jp_J_logistics_ge_18)
    return esm_trace_action(ctx, hij ? "JP02-S-INDIA" : "JP02-S-PERIMETER", hij ? "印度战略" : "外围防御战略")
}

// JP 晚期 (页3) —— py evaluate_late
function esm_jp_eval_late(ctx, d10) {
    ctx._nodePath = ["JP03-START"]; ctx._conditions = []; ctx._dice = []
    if (!esm_trace_pred(ctx, "JP03-A", "JP_HAND_GE_3", ctx.cards_in_hand >= 3)) return esm_trace_action(ctx, "JP03-S-EVENT", "事件战略")
    const bc = esm_trace_pred(ctx, "JP03-BC", "TOKYO_8_PORTS_AND_TOKYO_5_AIRFIELDS_GARRISONED", ctx.jp_L_B_garrisons_within_8 && ctx.jp_L_C_airfields_within_5)
    if (!bc) return esm_trace_action(ctx, "JP03-S-FINAL-PERIMETER", "最终国防圈战略")
    if (esm_trace_pred(ctx, "JP03-D", "JP_CAN_PASS", ctx.can_pass)) return esm_trace_action(ctx, "JP03-S-PASS", "PASS")
    if (esm_trace_pred(ctx, "JP03-E", "ALLIED_GROUND_ON_HONSHU", ctx.jp_L_E_allied_on_honshu)) return esm_trace_action(ctx, "JP03-S-FINAL-DEFENSE", "最终防御战略")
    return esm_trace_action(ctx, "JP03-S-EVENT", "事件战略")
}

// AL 早期 (页7) —— py evaluate_early
function esm_al_eval_early(ctx, d10) {
    ctx._nodePath = ["AP07-START"]; ctx._conditions = []; ctx._dice = []
    if (!esm_trace_pred(ctx, "AP07-A", "AP_HAND_GE_3", ctx.cards_in_hand >= 3)) return esm_trace_action(ctx, "AP07-S-EVENT", "事件战略")
    if (esm_trace_pred(ctx, "AP07-B", "SUPPLIED_HQ_IN_PHILIPPINES", ctx.al_B_hq_supplied_phil)) return esm_trace_action(ctx, "AP07-S-EVAC-PHILIPPINES", "撤离菲律宾")
    if (esm_trace_pred(ctx, "AP07-C", "SUPPLIED_HQ_IN_MALAYA", ctx.al_C_hq_supplied_malaya)) return esm_trace_action(ctx, "AP07-S-EVAC-MALAYA", "撤离马来亚")
    if (!esm_trace_pred(ctx, "AP07-D", "ARCADIA_PLAYED", ctx.al_D_arcadia_played)) return esm_trace_action(ctx, "AP07-S-ABDA", "建立ABDA")
    if (!esm_trace_pred(ctx, "AP07-E", "CBI_DEFENSE_COMPLETE", ctx.al_E_cbi_def_established)) return esm_trace_action(ctx, "AP07-S-CBI", "增强CBI防御")
    if (esm_trace_pred(ctx, "AP07-FG", "HAS_PASS_AND_ONE_CARD_LEFT", ctx.al_F_has_passes && ctx.al_G_only_1_card_left)) return esm_trace_action(ctx, "AP07-S-PASS", "PASS")
    const orange = esm_trace_pred(ctx, "AP07-JKLMN", "ORANGE_PLAN_CRITERIA", ctx.al_J_phil_not_surrendered && ctx.al_K_service_agreement && ctx.al_L_has_2_carriers && ctx.al_M_us_corps_near_carrier && ctx.al_N_aus_no_jp_ground)
    if (orange) return esm_trace_action(ctx, "AP07-S-ORANGE", "橙色计划")
    const dei = esm_trace_pred(ctx, "AP07-OP", "DEI_NOT_SURRENDERED_AND_ABDA_SUPPLIED", ctx.al_O_dei_not_surrendered && ctx.al_P_abda_hq_supplied)
    return esm_trace_action(ctx, dei ? "AP07-S-DEI" : "AP07-S-OFFENSIVE", dei ? "DEI防御" : "攻势进攻")
}

// AL 中期 (页8) —— py evaluate_mid
function esm_al_eval_mid(ctx, d10) {
    ctx._nodePath = ["AP08-START"]; ctx._conditions = []; ctx._dice = []
    if (esm_trace_pred(ctx, "AP08-A", "AP_CAN_PASS", ctx.can_pass)) return esm_trace_action(ctx, "AP08-S-PASS", "PASS")
    const pow = esm_trace_pred(ctx, "AP08-B", "AP_NEEDS_PROGRESS_OF_WAR", ctx.al_M_B_needs_war_progress)
    const cards3 = esm_trace_pred(ctx, "AP08-C", "AP_HAND_GE_3", ctx.cards_in_hand >= 3)
    if (pow && cards3 && esm_trace_pred(ctx, "AP08-D", "JP_CONTROLS_COUNTERATTACK_TARGET", ctx.al_M_D_jp_controls_counterattack_target)) return esm_trace_action(ctx, "AP08-S-COUNTEROFFENSIVE", "反攻战略")
    if (!cards3) return esm_trace_action(ctx, "AP08-S-EVENT", "事件战略")
    const roll = esm_trace_d10(ctx, "AP08-D10", d10, ":al-mid")
    if (roll <= 4) return esm_trace_action(ctx, "AP08-S-SOUTH-PACIFIC", "南太平洋战略")
    if (roll <= 7) return esm_trace_action(ctx, "AP08-S-CENTRAL-PACIFIC", "中太平洋战略")
    if (roll === 8) return esm_trace_action(ctx, "AP08-S-DEI", "DEI战略")
    return esm_trace_action(ctx, "AP08-S-CBI", "CBI战略")
}

// AL 晚期 (页9) —— py evaluate_late
function esm_al_eval_late(ctx, d10) {
    ctx._nodePath = ["AP09-START"]; ctx._conditions = []; ctx._dice = []
    if (esm_trace_pred(ctx, "AP09-A", "AP_CAN_PASS", ctx.can_pass)) return esm_trace_action(ctx, "AP09-S-PASS", "PASS")
    const finalTurn = esm_trace_pred(ctx, "AP09-B", "TURN_12", ctx.al_L_B_is_turn_12)
    // 图表第9页：B=YES 直接进入 F。最后一回合跳过手牌数、基地和 B29 就位检查，
    // 也与脚注[1]“第12回合永远不要把卡牌作为 FO”一致。
    if (!finalTurn) {
        if (!esm_trace_pred(ctx, "AP09-C", "AP_HAND_GE_3", ctx.cards_in_hand >= 3)) return esm_trace_action(ctx, "AP09-S-EVENT", "事件战略")
        if (!esm_trace_pred(ctx, "AP09-D", "AP_HAS_STRATEGIC_BOMBING_BASE", ctx.al_L_D_has_strategic_bombing_base)) return esm_trace_action(ctx, "AP09-S-CAPTURE-BOMBING-BASE", "占领轰炸基地")
        if (!esm_trace_pred(ctx, "AP09-E", "ALL_MAP_B29_ON_BASE", ctx.al_L_E_all_b29_on_base)) return esm_trace_action(ctx, "AP09-S-PUSH-B29", "推进B29")
    }
    if (!esm_trace_pred(ctx, "AP09-F", "AP_CONTROLS_HEX_WITHIN_TOKYO_8", ctx.al_L_F_controls_hex_within_8_tokyo)) {
        const roll = esm_trace_d10(ctx, "AP09-D10", d10, ":al-late")
        if (roll <= 2) return esm_trace_action(ctx, "AP09-S-RETURN-PHILIPPINES", "重返菲律宾")
        if (roll <= 5) return esm_trace_action(ctx, "AP09-S-ISLAND-HOPPING", "跳岛作战")
        return esm_trace_action(ctx, "AP09-S-ALTERNATE", "轮流战略")
    }
    if (esm_trace_pred(ctx, "AP09-G", "AP_MEETS_ATOMIC_BOMB_STRATEGY_CRITERIA", ctx.al_L_G_meets_atomic_bomb_criteria)) return esm_trace_action(ctx, "AP09-S-ATOMIC", "原子弹胜利")
    return esm_trace_action(ctx, "AP09-S-INVADE-JAPAN", "登陆日本")
}

// ===========================================================================
// 引擎真实状态 -> ctx 布尔
// ===========================================================================
// D3: 引擎口径的 PoW 银行 —— G.capture 中当前仍由 AP 控制的格数(= cycle.js
// check_progress_of_war 的 pow_count)。政治阶段据此判是否 -1 PW, 盟军在首卡窗应据此
// 知道"本回合是否必须靠夺格把银行补回 ≥G.pow"。
function esm_pow_bank() {
    try {
        let n = 0
        for (const h of (G.capture || [])) {
            if (h >= 0 && h <= LAST_BOARD_HEX && is_space_controlled(h, AP)) n++
        }
        return n
    } catch (e) { return 0 }
}
// D5: 引擎 victory_1945 的日本控制资源格(get_jp_resources() 同源计数, 剧本 RESOURCE_HEX)。
function esm_jp_resource_hexes() {
    try {
        if (typeof RESOURCE_HEX === "undefined" || typeof G === "undefined") return []
        return RESOURCE_HEX.filter(h => h >= 0 && h <= LAST_BOARD_HEX && is_space_controlled(h, JP))
    } catch (e) { return [] }
}
function esm_hex_trace(h, role) {
    try {
        const md = get_map_data(h) || {}
        return {
            hex: h,
            id: md.id,
            name: md.name || null,
            region: md.region || null,
            resource: !!md.resource,
            controlledBy: is_space_controlled(h, AP) ? "Allies" : "Japan",
            achieved: is_space_controlled(h, esm_role_faction(role)),
            distanceToTokyo: get_distance(h, TOKYO),
        }
    } catch (e) { return { hex: h } }
}
function esm_advance_metrics() {
    try {
        let unit = null, controlled = null, b29 = null
        for (let u = 1; u < pieces.length; ++u) {
            const p = pieces[u], h = G.location[u]
            if (!p || p.faction !== AP || !(h >= 0 && h <= LAST_BOARD_HEX)) continue
            const d = get_distance(h, TOKYO)
            if (!unit || d < unit.distance || d === unit.distance && h < unit.hex) unit = { unit: u, hex: h, distance: d }
            if (p.b29 !== undefined && (!b29 || d < b29.distance)) b29 = { unit: u, hex: h, distance: d }
        }
        for (let h = 0; h <= LAST_BOARD_HEX; ++h) {
            if (!is_controllable_hex(h) || !is_space_controlled(h, AP)) continue
            const d = get_distance(h, TOKYO)
            if (!controlled || d < controlled.distance || d === controlled.distance && h < controlled.hex)
                controlled = { hex: h, distance: d, name: (get_map_data(h) || {}).name || null }
        }
        return { closestAlliedUnit: unit, closestAlliedControlledHex: controlled, closestB29: b29 }
    } catch (e) { return {} }
}
function esm_strategy_targets(strategy) {
    const chain = strategy && Array.isArray(strategy.chain) ? strategy.chain : []
    const targetMeta = strategy && Array.isArray(strategy.targetMeta) ? strategy.targetMeta : []
    const byHex = new Map(targetMeta.map(target => [target.hex, target]))
    return chain.slice(0, 12).map((h, index) => {
        const meta = byHex.get(h) || {}
        const target = Object.assign({ priority: index + 1 }, esm_hex_trace(h, strategy.role), meta)
        if (meta.kind === "SUPPRESS" || meta.kind === "SUPPRESS_HQ") {
            const mine = esm_role_faction(strategy.role)
            try { target.achieved = !has_zoi(h, 1 - mine) } catch (e) { target.achieved = false }
        } else if (meta.kind === "GARRISON") {
            const mine = esm_role_faction(strategy.role)
            try {
                const controlled = is_space_controlled(h, mine)
                target.ignored = !controlled
                target.achieved = !controlled || esm_has_class_at(h, mine, meta.garrisonClass || "ground")
            } catch (e) { target.achieved = false }
        }
        return target
    })
}

// 第5/11页编队器需要知道一个地图目标究竟是“压制”还是“夺占”。此前仅动态 HQ
// 带元数据，普通目标全部退化为无类型 hex，导致敌控岛屿也可能被一架飞机视为完成。
function esm_goal_target_meta(goals) {
    const out = [], seen = new Set()
    for (const goal of goals || []) {
        for (const hex of goal.hexes || []) {
            if (seen.has(hex)) continue
            seen.add(hex)
            const suppress = goal.kind === "SUPPRESS"
            const garrisonClass = goal.kind === "GARRISON" ? (/机场/.test(goal.text) ? "air" : "ground") : null
            out.push({ hex, kind: goal.kind, objective: goal.text, garrisonClass,
                damageLevel: suppress ? 0.5 : 1,
                requiresOccupation: goal.kind === "CONQUEST" || goal.kind === "INVADE_JAPAN" })
        }
    }
    return out
}

// 第3页最终防御[4]-[8]：实际作战焦点是本州上的盟军地面单位，而不是资源轴。
// 目标位置按距东京、hex 稳定排序；操作层随后只从日本区域选集结/支援单位。
function esm_jp_final_defense_targets() {
    const found = new Map()
    for (let u = 1; u < pieces.length; ++u) {
        const p = pieces[u], h = G.location[u]
        if (!p || p.faction !== AP || p.class !== "ground" || !(h >= 0 && h <= LAST_BOARD_HEX)) continue
        const md = get_map_data(h)
        if (!md || md.region !== "Japan") continue
        if (!found.has(h)) found.set(h, {
            hex: h, kind: "DEFEND_HONSHU", objective: "最终防御：集结、海空支援、板载冲锋",
            damageLevel: 1, requiresOccupation: true, homeDefense: true,
        })
    }
    return [...found.values()].sort((a, b) => get_distance(a.hex, TOKYO) - get_distance(b.hex, TOKYO) || a.hex - b.hex)
}

// 图表第1页的“压制盟军HQ”不是固定地图地名，而是三个会移动的 HQ 当前所在格。
// 仅仍在地图且有补给的 HQ 是待压制目标；已经断补或离图即视为该项完成。
function esm_jp_hq_suppression_targets() {
    const specs = [
        // 开局菲律宾 HQ 位于马尼拉。图表脚注允许通过占领基地来切断/覆盖 HQ；
        // 若只把它当作一次空袭，地面军会在同一攻势里改去次要目标，菲律宾守军
        // 随后反复获得反应机会。第2回合因此把马尼拉标为“压制且优先夺占”。
        { unit: HQ_SOUTH_WEST, objective: "压制菲律宾HQ（开局优先夺占马尼拉）", damageLevel: 0.25, openingCapture: true },
        { unit: HQ_MALAYA, objective: "压制新加坡HQ", damageLevel: 0.5 },
        { unit: HQ_ABDA, objective: "压制ABDA HQ", damageLevel: 0.5 },
    ]
    const targets = []
    for (const spec of specs) {
        const h = G.location[spec.unit]
        if (!(h >= 0 && h <= LAST_BOARD_HEX)) continue
        if (G.oos && set_has(G.oos, spec.unit)) continue
        targets.push({ hex: h, unit: spec.unit, objective: spec.objective, damageLevel: spec.damageLevel,
            kind: "SUPPRESS_HQ", rangedSupport: true,
            requiresOccupation: !!(spec.openingCapture && G.turn === 2) })
    }
    return targets
}

function esm_front_distance(hex, faction) {
    let best = 99
    for (let u = 1; u < pieces.length; ++u) {
        const p = pieces[u], loc = G.location[u]
        if (!p || p.faction !== faction || p.class !== "ground" || !(loc >= 0 && loc <= LAST_BOARD_HEX)) continue
        best = Math.min(best, get_distance(loc, hex))
    }
    return best
}

// 日本本土连续三个国势阶段无法向资源格追溯路径时，盟军按基础规则封锁获胜。
// 这是第9页 G=NO 后的规则胜利约束，不伪装成图表节点。海路追溯由 supply.js 的
// check_japan_resource_trace() 判定；夺港后仍需航空驻军产生未被中和的盟军 AZOI。
function esm_ap_blockade_targets() {
    const specs = [
        ["Shanghai", "北方资源线：占领上海并建立航空封锁"],
        ["Tsingtao", "北方资源线：占领青岛并建立航空封锁"],
        ["Port Arthur", "北方资源线：占领旅顺并建立航空封锁"],
        ["Tainan", "南方资源线：夺取台南机场并建立AZOI"],
        ["Taihoku", "南方资源线：夺取台北机场并建立AZOI"],
        ["Okinawa", "南方资源线：夺取冲绳并建立AZOI"],
        ["Iwo Jima", "南方资源线：夺取硫磺岛并建立AZOI"],
        ["Saipan", "南方资源线：夺取塞班并建立AZOI"],
        ["Guam", "南方资源线：夺取关岛并建立AZOI"],
    ]
    const targets = []
    for (const [name, objective] of specs) {
        const hex = esm_idx(name)
        if (!(hex >= 0 && hex <= LAST_BOARD_HEX)) continue
        if (is_space_controlled(hex, JP)) {
            targets.push({ hex, kind: "CONQUEST", objective, damageLevel: 1,
                requiresOccupation: true, victoryConstraint: "JAPAN_RESOURCE_BLOCKADE" })
        } else if (is_space_controlled(hex, AP) && get_map_data(hex).airfield && !esm_has_class_at(hex, AP, "air")) {
            targets.push({ hex, kind: "GARRISON", garrisonClass: "air",
                objective: `${objective}：部署盟军航空兵`,
                victoryConstraint: "JAPAN_RESOURCE_BLOCKADE_AZOI" })
        }
    }
    return targets
}

// 规则 16.47 是盟军每回合必须满足的生存条件。图表决定战区，本函数只把该战区
// 内能计入 G.capture 的未占目标提到前面；不足时再补入最近、守军较弱的合法计分格。
// 它不改变控制权或战力，只防止 AI 有可夺目标却把整手牌耗在不计 PoW 的移动上。
function esm_ap_progress_targets(existingChain, existingMeta) {
    const deficit = Math.max(0, Number(G.pow || 0) - esm_pow_bank())
    if (G.turn < 4 || deficit <= 0) return []
    const byHex = new Map((existingMeta || []).map(x => [x.hex, x]))
    const eligible = h => {
        const md = get_map_data(h)
        return h >= 0 && h <= LAST_BOARD_HEX && is_space_controlled(h, JP) && is_controllable_hex(h) &&
            !!(md && (md.name || md.resource || md.port || md.airfield))
    }
    const candidates = []
    for (const h of existingChain || []) if (eligible(h)) candidates.push(h)
    for (let h = 0; h <= LAST_BOARD_HEX; ++h) if (eligible(h) && !candidates.includes(h)) candidates.push(h)
    const defense = h => {
        let n = 0
        for (let u = 1; u < pieces.length; ++u) if (pieces[u] && pieces[u].faction === JP && G.location[u] === h)
            n += Number((G.reduced && set_has(G.reduced, u) ? pieces[u].rcf : pieces[u].cf) || 0)
        return n
    }
    const chainSet = new Set(existingChain || [])
    candidates.sort((a, b) =>
        // 胜利前置链可能包含尚距前线十余格的塞班/上海。PoW 已亏空时必须先夺本牌
        // 可到达的近程计分格，否则“高优先级但不可达”会连续耗牌并导致条约谈判败。
        Number(esm_front_distance(a, AP) > 6) - Number(esm_front_distance(b, AP) > 6)
        || (G.turn >= 9 ? Number(!get_map_data(a).resource) - Number(!get_map_data(b).resource) : 0)
        // PoW 生存前视只能在当前决策轴内重排可执行目标；旧排序先挑全图最弱空岛，
        // 把中太平洋/DEI/CBI 主攻群拆散。图表链目标必须先于补充计分格。
        || Number(!chainSet.has(a)) - Number(!chainSet.has(b))
        || defense(a) - defense(b)
        || esm_front_distance(a, AP) - esm_front_distance(b, AP) || a - b)
    return candidates.slice(0, Math.max(deficit + 2, 4)).map((hex, i) => ({
        ...(byHex.get(hex) || {}), hex, kind: "CONQUEST", requiresOccupation: true,
        damageLevel: (byHex.get(hex) || {}).damageLevel || 1,
        objective: (byHex.get(hex) || {}).objective || `战争进程计分目标 ${i + 1}`,
        victoryConstraint: "PROGRESS_OF_WAR",
    }))
}
function esm_build_ctx(role, lock, seedText) {
    const ctx = {
        cards_in_hand: (G.hand && G.hand[esm_role_faction(role)]) ? G.hand[esm_role_faction(role)].length : 5,
        can_pass: !!(G.passes && G.passes[esm_role_faction(role)] > 0),
        current_turn: G.turn,
        _seed: seedText || "",
        notes: [],
    }
    const jpRes = (typeof get_jp_resources === "function") ? get_jp_resources() : 13
    if (role === "Japan") {
        const surr = n => (G.surrender && G.surrender[n] ? true : false)
        const ngIn = r => r === "Guinea"
        const deiR = r => r === "DEI" || r === "Java" || r === "Sumatra" || r === "Borneo" || r === "Celebes"
        const philIn = r => r === "Philippines"
        ctx.jp_A = esm_ap_hq_oos_in(r => philIn(r) || deiR(r) || r === "Malaya")
        ctx.jp_B_dei_surrender_hexes_occupied = (typeof nations !== "undefined") ? nations.DEI.keys.every(k => is_space_controlled(hex_to_int(k), JP)) : false
        ctx.jp_D_res_lt_13 = jpRes < 13
        const logistics = esm_jp_logistics()
        ctx.jp_F_logistics_ge_20 = logistics >= 20
        ctx.jp_H_logistics_le_19 = logistics <= 19
        ctx.jp_I_azoi_covers_dei_ports = (() => {
            try { return esm_geo().deiPorts.every(h => has_zoi(h, JP)) } catch (e) { return false }
        })()
        ctx.jp_J_controls_rabaul_guadalcanal = is_space_controlled(esm_idx("Rabaul"), JP) && is_space_controlled(esm_idx("Guadalcanal"), JP)
        ctx.jp_K_controls_4_to_6_ng_ports = (() => {
            const n = esm_geo().ngPorts.filter(h => is_space_controlled(h, JP)).length
            return n >= 4 && n <= 6
        })()
        ctx.jp_L_mal_phil_dei_not_conquered = !(surr(nations.MALAYA.id) && surr(nations.DEI.id) && surr(nations.PHILIPPINES.id))
        // M 外围防御目标1完成: 早期南方/外围首步 Sarong/Vogelkop/Biak/Guadalcanal/PortMoresby 均由 JP 控制(近似, trace 标注)
        ctx.jp_M_perimeter_target_1_complete = (() => {
            try {
                const h = ["Sarong", "Vogelkop", "Biak", "Guadalcanal", "Port Moresby"].map(t => esm_idx(t)).filter(x => x != null)
                return h.length > 0 && h.every(x => is_space_controlled(x, JP))
            } catch (e) { return false }
        })()
        // 中期
        // JP02-E 原文是“美国政治意志<4”，不是欧洲战事状态。
        ctx.jp_E_us_will_lt_4 = Number(G.political_will) < 4
        ctx.jp_F_burma_surrendered = (typeof nations !== "undefined") ? surr(nations.BURMA.id) : false
        ctx.jp_G_logistics_ge_15 = logistics >= 15
        ctx.jp_H_has_gandhi = (() => {
            try { return set_has(G.hand[JP], find_card(JP, 15)) || set_has(G.hand[JP], find_card(JP, 21)) } catch (e) { return false }
        })()
        ctx.jp_I_more_steps_in_burma = esm_large_ground_steps(JP, r => r === "Burma") > esm_large_ground_steps(AP, r => r === "Burma")
        ctx.jp_J_logistics_ge_18 = logistics >= 18
        // 晚期
        const perimeter = esm_jp_final_perimeter_status()
        ctx.jp_L_B_garrisons_within_8 = perimeter.portsGarrisoned
        ctx.jp_L_C_airfields_within_5 = perimeter.airfieldsGarrisoned
        ctx.jp_L_E_allied_on_honshu = esm_count_ground(AP, r => r === "Japan") > 0
    } else {
        const surr = n => (G.surrender && G.surrender[n] ? true : false)
        const philIn = r => r === "Philippines"
        const malIn = r => r === "Malaya"
        const deiR = r => r === "DEI" || r === "Java" || r === "Sumatra" || r === "Borneo" || r === "Celebes"
        ctx.al_B_hq_supplied_phil = esm_ap_hq_supplied_at(philIn)
        ctx.al_C_hq_supplied_malaya = esm_ap_hq_supplied_at(malIn)
        ctx.al_D_arcadia_played = (() => {
            try { return esm_card_removed(find_card(AP, 4)) || G.location[HQ_ABDA] >= 0 && G.location[HQ_ABDA] <= LAST_BOARD_HEX } catch (e) { return false }
        })()
        ctx.al_E_cbi_def_established = (() => { try { return esm_cbi_defense_complete() } catch (e) { return false } })()
        ctx.al_F_has_passes = ctx.can_pass
        ctx.al_G_only_1_card_left = ctx.cards_in_hand <= 1
        ctx.al_J_phil_not_surrendered = (typeof nations !== "undefined") ? !surr(nations.PHILIPPINES.id) : true
        ctx.al_K_service_agreement = !(G.inter_service && G.inter_service[AP] === 1)
        ctx.al_L_has_2_carriers = esm_count_carriers(AP) >= 2
        ctx.al_M_us_corps_near_carrier = (() => {
            // 橙色计划：美陆军军与航母同格；该格距一个盟军控制的菲律宾港口不超过15格。
            try {
                const philPorts = []
                for (let h = 0; h <= LAST_BOARD_HEX; ++h) {
                    const md = get_map_data(h)
                    if (md && md.region === "Philippines" && md.port && is_space_controlled(h, AP)) philPorts.push(h)
                }
                for (let u = 1; u < pieces.length; ++u) {
                    const p = pieces[u], loc = G.location[u]
                    if (!p || p.faction !== AP || p.class !== "naval" || !p.br || !(loc >= 0 && loc <= LAST_BOARD_HEX)) continue
                    let usCorps = false
                    for (let g = 1; g < pieces.length; ++g) {
                        const q = pieces[g]
                        if (q && q.faction === AP && q.class === "ground" && q.service === "army" && G.location[g] === loc) { usCorps = true; break }
                    }
                    if (usCorps && philPorts.some(h => get_distance(loc, h) <= 15)) return true
                }
                return false
            } catch (e) { return false }
        })()
        ctx.al_N_aus_no_jp_ground = esm_count_ground(JP, r => r === "Australia") === 0
        ctx.al_O_dei_not_surrendered = (typeof nations !== "undefined") ? !surr(nations.DEI.id) : true
        ctx.al_P_abda_hq_supplied = (() => { const loc = G.location[HQ_ABDA]; return (loc >= 0 && loc <= LAST_BOARD_HEX) && !(G.oos && set_has(G.oos, HQ_ABDA)) })()
        // 中期
        ctx.al_M_B_needs_war_progress = (() => {
            // D3: 真实"战争进程亏空" —— 引擎口径 pow_count(=G.capture 中当前 AP 仍控的 named 格)
            // < G.pow。原 !!G.pow 只在 t≥4 后恒真, 无法表达"银行已达标/未达标", 更不会在
            // 银行耗尽时催动夺格 —— 而 PoW 亏空正是条约败主因(每次政治阶段 pow_count<pow 即 -1 PW)。
            if (!(G.pow > 0)) return false
            try { return esm_pow_bank() < G.pow } catch (e) { return false }
        })()
        ctx.al_M_D_jp_controls_counterattack_target = (() => {
            // D3: 反攻战略门槛 = py 中期树 "D 日本控制≥1反攻目标"(页8 原文), 目标集与反攻
            // 执行链同源 = 图表 16 行清单(中途岛→努美阿)解析出的同一份 hex 链。此前的
            // front-scan(任何 JP 控 named 格距 AP ≤3)把谓词与执行链解耦: 1942 马来亚前线使
            // D 恒真 → 反攻连钉, 但 16 个清单目标几乎全在盟军手中, eop 焦点 null、攻势空转。
            // 忠实语义: D 为真 恰等价于 链上存在日本实际控制的清单目标 → 钉反攻必有真实焦点。
            try {
                const entry = esm_strategy_entry("Allies", "mid", "反攻战略")
                if (!entry) return false
                const chain = esm_chain_of(esm_parse_entry(entry, "Allies", "mid"))
                for (const h of chain) {
                    if (h >= 0 && h <= LAST_BOARD_HEX && is_space_controlled(h, JP)) return true
                }
                return false
            } catch (e) { return false }
        })()
        // 晚期
        ctx.al_L_B_is_turn_12 = G.turn === 12
        ctx.al_L_D_has_strategic_bombing_base = (() => {
            try { return esm_geo().airfieldsWithin8Tokyo.some(h => is_space_controlled(h, AP)) } catch (e) { return false }
        })()
        ctx.al_L_E_all_b29_on_base = (() => {
            try {
                const onMap = [B_29_1, B_29_2].filter(u => G.location[u] >= 0 && G.location[u] <= LAST_BOARD_HEX)
                const onBase = u => { const loc = G.location[u]; return is_space_controlled(loc, AP) && get_map_data(loc).airfield && get_distance(loc, TOKYO) <= 8 }
                // 图表原文是“地图上所有的 B29”：尚未增援/已进补员轨的 B29 不参与全称判断；
                // 中国空军盒虽可执行规则 12.3 轰炸，但不是图表定义的“东京 8 格内盟军机场”。
                return onMap.length > 0 && onMap.every(onBase)
            } catch (e) { return false }
        })()
        ctx.al_L_F_controls_hex_within_8_tokyo = (() => {
            try { return esm_geo().controlledHexesWithin8Tokyo.some(h => is_space_controlled(h, AP)) } catch (e) { return false }
        })()
        ctx.al_L_G_meets_atomic_bomb_criteria = esm_atomic_met()
    }
    // D5 诊断(仅 trace 用, 不进决策): 钉选时刻的引擎权威账本 —— PoW 银行/G.pow/JP 资源/
    // 轰炸战役标记/JP 手里的资源格 —— 供审计"为何条约败/离胜利线多远"。
    try {
        ctx._diag = {
            turn: G.turn, pow: G.pow, bank: esm_pow_bank(),
            jpRes: (typeof get_jp_resources === "function") ? get_jp_resources() : -1,
            marker: (G.events && events && events.STRAT_BOMBING_CAMPAIGN) ? (G.events[events.STRAT_BOMBING_CAMPAIGN.id] || 0) : -1,
            resHexes: (typeof RESOURCE_HEX !== "undefined") ? RESOURCE_HEX.filter(h => h >= 0 && h <= LAST_BOARD_HEX && is_space_controlled(h, JP)) : [],
            advance: esm_advance_metrics(),
            atomic: (typeof atomic_bomb_strategy_status === "function") ? atomic_bomb_strategy_status() : null,
            openingSurrender: (typeof nations !== "undefined") ? {
                philippines: !!G.surrender[nations.PHILIPPINES.id],
                dei: !!G.surrender[nations.DEI.id],
                philippinesKeysHeld: nations.PHILIPPINES.keys.filter(k => is_space_controlled(hex_to_int(k), JP)).length,
                philippinesKeysRequired: nations.PHILIPPINES.keys.length,
                deiKeysHeld: nations.DEI.keys.filter(k => is_space_controlled(hex_to_int(k), JP)).length,
                deiKeysRequired: nations.DEI.keys.length,
            } : undefined,
        }
    } catch (e) { /* 无 G 时不设 */ }
    return ctx
}

// 原子弹判据(口径=图表 09 + 脚注[7] + 规则 16): 逐字三条件。
function esm_atomic_met() {
    try {
        return atomic_bomb_strategy_status().met
    } catch (e) { return false }
}

// ===========================================================================
// parse_goals 移植(py L101-116/L801-943): 把“有序分步目标”每行解析成 Goal
// (kind + 有序 hex + region + 抽象项), 供计划审计与 chain(喂 eop) 使用。
// 逐字复刻 py: 分类关键字/指针(见X)/区域资源展开/落底 region 命名格 全保留。
// 地图注册表 = engine get_map_data(与 py 一次性导出 data/erasmus/map_names.json
// 同源); 解析只在 gate 开时运行(短路的引擎函数取不到也不炸)。
// ===========================================================================
var ESM_PARSE_REG = null            // 单次 parse 期间的注册表(指针递归共用)

function esm_reg_from_entries(land, namedMap) {
    // land: Map<idx,{region}>; namedMap: Map<idx,{name,region,resource}> —— py HEXES/LAND
    const named = [], namedIdx = new Set(), regionNamed = new Map(), regionResource = new Map()
    const push = (m, region, idx) => { if (!m.has(region)) m.set(region, []); m.get(region).push(idx) }
    const idxs = Array.from(new Set([...land.keys(), ...namedMap.keys()])).sort((a, b) => a - b)
    for (const idx of idxs) {
        const lr = land.get(idx), ne = namedMap.get(idx)
        const region = ne ? ne.region : (lr ? lr.region : null)
        if (region) push(regionNamed, region, idx)
        if (ne) {
            named.push({ idx, name: ne.name, region: ne.region, resource: !!ne.resource })
            namedIdx.add(idx)
            if (ne.resource && ne.region) push(regionResource, ne.region, idx)
        }
    }
    return { named, namedIdx, regionNamed, regionResource }
}

function esm_reg_build() {
    if (ESM_PARSE_REG) return ESM_PARSE_REG
    if (typeof get_map_data !== "function" || typeof LAST_BOARD_HEX === "undefined") return null
    const sid = (typeof G !== "undefined" && G) ? G.sid : "?"
    if (ESM_PREP._reg && ESM_PREP._reg.sid === sid) return ESM_PREP._reg
    const land = new Map(), namedMap = new Map()
    for (let i = 0; i <= LAST_BOARD_HEX; i++) {
        let md = null
        try { md = get_map_data(i) } catch (e) { md = null }
        if (!md) continue
        if (md.region) land.set(i, { region: md.region })
        if (md.name) namedMap.set(i, { name: String(md.name), region: md.region, resource: !!md.resource })
    }
    ESM_PREP._reg = esm_reg_from_entries(land, namedMap)
    ESM_PREP._reg.sid = sid
    return ESM_PREP._reg
}

// ---- 目标词 -> hex(逐字 py L63-116) ---------------------------------------
const ESM_NAME_ALIASES = { "uluthi": "Ulithi", "uluth": "Ulithi", "timor": "Koepang",
    "gili-gili": "Gili Gili", "marcus island": "Marcus", "marshalls": "Kwajalein",
    "saipan/tinian": "Saipan", "dutch harbor": "Dutch Harbor", "attukiska": "Attu/Kiska",
    "sasebo": "Kynshu" }
function esm_norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "") }
function esm_name_hexes(token) {
    const reg = esm_reg_build()
    let t = esm_norm(token)
    if (Object.prototype.hasOwnProperty.call(ESM_NAME_ALIASES, t)) t = esm_norm(ESM_NAME_ALIASES[t])
    if (!t || t.length < 3 || !reg) return []
    // Exact normalized names must win before fuzzy abbreviation matching. Without
    // this guard, "Balikpapan" also matched the shorter map name "Bali" and put
    // a non-chart target at the head of the DEI surrender objective.
    const exact = []
    for (const e of reg.named) if (esm_norm(e.name) === t) exact.push(e.idx)
    if (exact.length) return exact
    // 斜线表示两个备选地点时两者都保留（Gasmata/Rabaul）；地图本身确有同名组合格
    // （Attu/Kiska、Saipan/Tinian）已在上面的 exact 分支命中，不会被拆开。
    if(String(token).includes("/")){
        const split=[]
        for(const part of String(token).split("/"))for(const idx of esm_name_hexes(part))if(!split.includes(idx))split.push(idx)
        if(split.length)return split
    }
    const fuzzy = []
    for (const e of reg.named) {
        const n = esm_norm(e.name)
        if (t.includes(n) || n.includes(t)) fuzzy.push({ idx: e.idx, delta: Math.abs(n.length - t.length) })
    }
    if (!fuzzy.length) return []
    const best = Math.min(...fuzzy.map(e => e.delta))
    return fuzzy.filter(e => e.delta === best).map(e => e.idx)
}
function esm_line_hexes(text) {
    const hexes = []
    let m
    const idRe = /\d{4}/g
    while ((m = idRe.exec(text))) {                     // 4-digit hex id 先取(py 顺序)
        const id = +m[0], idx = (Math.floor(id / 100) - 10) * 29 + (id % 100)
        if (hexes.indexOf(idx) < 0) hexes.push(idx)
    }
    const runRe = /[A-Za-z][A-Za-z\-/\. ]{1,30}[A-Za-z]/g   // 英文名按出现序(py 同)
    while ((m = runRe.exec(text))) {
        for (const idx of esm_name_hexes(m[0])) if (hexes.indexOf(idx) < 0) hexes.push(idx)
    }
    return hexes
}

// ---- 行分类(逐字 py _classify L874-897) ------------------------------------
const ESM_ADMIN_KW = ["Roll", "1d10", "切换", "放牌", "跳过", "PASS", "FOQ", "按顺序",
    "整理手牌", "同早期", "事件战略", "其他放牌", "如果已控制则加固", "欧战为正打欧战牌"]
function esm_classify(text) {
    if (ESM_ADMIN_KW.some(k => text.includes(k))) return "ADMIN"
    if (text.includes("压制")) return "SUPPRESS"
    if (text.includes("登陆日本") || text.includes("板载冲锋")) return "INVADE_JAPAN"
    if (text.includes("攻击美国舰队") || text.includes("脱离") || text.includes("护航") ||
        (text.includes("航母") && text.includes("攻击"))) return "NAVAL"
    if (text.includes("B29") || text.includes("轰炸")) return "B29"
    if (text.includes("驻军") || text.includes("加固")) return "GARRISON"
    if (text.includes("加强港口")) return "PORTS"
    if (["投降", "占领", "夺", "攻占", "推进", "登陆", "进军"].some(k => text.includes(k))) return "CONQUEST"
    return esm_line_hexes(text).length ? "CONQUEST" : "ADMIN"
}

const ESM_CN_REGION = { "东印度": "DEI", "菲律宾": "Philippines", "马来亚": "Malaya", "缅甸": "Burma",
    "中国": "China", "印度": "India", "新几内亚": "Guinea", "日本": "Japan", "中太平洋": "Marshall",
    "澳洲": "Australia", "塞班": null, "硫磺岛": null, "冲绳": null, "台湾": null }
function esm_region_of(text) {
    for (const cn of Object.keys(ESM_CN_REGION)) {
        const reg = ESM_CN_REGION[cn]
        if (reg && text.includes(cn) && !text.includes(reg)) return reg
    }
    return null
}

// ---- 指针 / 区域资源 / 落底(py _resolve_pointer/_resource_hexes) -----------
function esm_pointer_hexes(token, visiting) {
    // 按 py _resolve_pointer(L857-871): 检索顺序 JP_MID,JP_EARLY,JP_LATE,AL_MID,
    // AL_LATE,AL_EARLY; 每命中库键(或名)含 token 即把被指向战略的目标链
    // 扁平化(跨 Goal 不去重, 与 py `[h for g in parse_goals(s) for h in g.hexes]`
    // 一致), 取链长最长者返回。e.g. "见外围防御": JP_MID 外围(7格) vs JP_EARLY
    // 外围(13格,含瓜岛) → 取 EARLY 13 格链(与 py 金标一致)。
    const order = [["Japan", "mid"], ["Japan", "early"], ["Japan", "late"],
                   ["Allies", "mid"], ["Allies", "late"], ["Allies", "early"]]
    let best = []
    for (const [role, phase] of order) {
        const lib = esm_lib(role)[phase] || {}
        for (const key of Object.keys(lib)) {
            const e = lib[key]
            if (!(key.includes(token) || token.includes(key) || (e.name || "").includes(token))) continue
            const cand = esm_goal_hexes_of(role, phase, key, visiting)
            if (cand.length > best.length) best = cand
        }
    }
    return best
}
function esm_goal_hexes_of(role, phase, key, visiting) {
    const entry = esm_strategy_entry(role, phase, key)
    if (!entry) return []
    const tag = role + "|" + phase + "|" + key
    if (visiting.has(tag)) return []
    visiting.add(tag)
    const goals = esm_parse_goals_inner(entry, role, phase, visiting)
    visiting.delete(tag)
    // 跨 Goal 扁平化不去重(py _resolve_pointer 口径); 去重仅属执行链 esm_chain_of。
    const chain = []
    for (const g of goals) for (const h of g.hexes) chain.push(h)
    return chain
}

// ---- 主解析(py parse_goals L907-943) ----------------------------------------
function esm_parse_goals_inner(entry, role, phase, visiting) {
    const reg = esm_reg_build()
    const goals = []
    const targets = (entry && entry.targets) || []
    for (let i = 0; i < targets.length; i++) {
        const text = String(targets[i]).trim()
        if (!text) continue
        const kind = esm_classify(text)
        let hexes = esm_line_hexes(text)
        const region = esm_region_of(text)
        if (kind === "CONQUEST" && !hexes.length) {
            const pm = text.match(/见\s*([一-鿿]+)/)          // “见外围防御”跨战略指针
            if (pm) hexes = esm_pointer_hexes(pm[1], visiting)
            if (!hexes.length && region) {
                const rm = text.match(/所有[一-鿿]{0,8}资源/)   // “所有X资源”区域资源格
                if (rm && reg && reg.regionResource.has(region)) {
                    hexes = reg.regionResource.get(region).slice().sort((a, b) => a - b)
                }
            }
            if (!hexes.length && region && reg) {            // 落底: region 命名格
                const list = reg.regionNamed.get(region) || []
                hexes = list.filter(h => reg.namedIdx.has(h)).sort((a, b) => a - b)
            }
        }
        goals.push({ priority: i + 1, kind, text, hexes, region })
    }
    return goals
}
function esm_parse_entry(entry, role, phase, reg) {
    const visiting = new Set()
    const prev = ESM_PARSE_REG
    ESM_PARSE_REG = reg || esm_reg_build()
    try { return esm_parse_goals_inner(entry, role, phase, visiting) }
    finally { ESM_PARSE_REG = prev }
}
function esm_chain_of(goals) {
    const chain = []
    for (const g of goals || []) for (const h of g.hexes) if (chain.indexOf(h) < 0) chain.push(h)
    return chain
}

// ===========================================================================
// 策略表(转录 py L169-513 原文): 键 = 决策树返回名; 每项 = {name(全称), kind
// (策略级驱动), targets(逐字 py 目标行), notes}. targets 经 parse_goals 解析成
// 有序 Goal(逐字分类/顺序/指针/资源展开) —— 与 py 同源可对拍。
// ===========================================================================
const ESM_JP_LIB = {
    early: {
        "激进的空优战略": { name: "激进的空优战略", kind: "CONQUEST", targets: ["1. 压制东印度: Jolo [4], Makassar [4], Teloekbetoeng [4], Bandjermasin [4]"], notes: ["[4].如有可能,战后移动一个空中单位到目标格,不然移动一个航母过去。", "[7].以足够的力量,按伤害等级消灭覆盖目标的敌方AZOI单位的力量进行空中/海上攻击..."] },
        "保守的空优战略": { name: "保守的空优战略", kind: "CONQUEST", targets: ["1. 压制盟军HQ: 菲律宾(0.25x), 新加坡(0.5x), ABDA(0.5x)", "2. 压制东印度: Jolo, Makassar, Teloekbetoeng, Bandjermasin"], notes: ["[1].激活必须使盟军HQ断补。"] },
        "激进的南方资源战略": { name: "激进的南方资源战略", kind: "CONQUEST", targets: ["1. 压制盟军HQ: 菲律宾(0.25x), 新加坡(0.5x), ABDA(0.5x)", "2. 东印度投降: Balikpapan, Tarakan, Batavia(若无日军则占领), Tjilatjap, Soerabaja, Bangka, Palembang, Medan", "3. 马来亚投降: Kuantan关丹, Singapore新加坡", "4. 菲律宾投降: Manila马尼拉, Davao达沃", "5. Roll 1d10 分配"], notes: ["[1].激活必须使盟军HQ断补。"] },
        "保守的南方资源战略": { name: "保守的南方资源战略", kind: "CONQUEST", targets: ["1. 压制东印度: Jolo, Makassar, Teloekbetoeng, Bandjermasin", "2. 马来亚投降: Kuantan, Singapore", "3. 菲律宾投降: Manila, Davao", "4. Roll 1d10 分配"], notes: [] },
        "中缅印战略": { name: "中缅印战略 (CBI)", kind: "CONQUEST", targets: ["1. 缅甸投降: Rangoon仰光, Mandalay曼德勒, Lashio腊戍, Myitkyina密支那", "2. 中国投降: Lashio腊戍, 中国攻势, 中国事件"], notes: [] },
        "中太平洋战略": { name: "中太平洋战略", kind: "CONQUEST", targets: ["1. 拉包尔 Rabaul (若被盟军控制)", "2. 阿图/吉斯卡 Attu/Kiska [6]", "3. 马绍尔防御: Wake威克岛, Tarawa塔拉瓦", "4. 中途岛 Midway"], notes: ["[6].如果已经控制,则用至少3step的地面单位加固这里,其他情况则忽视该条。"] },
        "马绍尔防御": { name: "马绍尔防御", kind: "CONQUEST", targets: ["1. Wake威克岛", "2. Tarawa塔拉瓦"], notes: ["[6].如果已经控制,则用至少3step的地面单位加固这里,其他情况则忽视该条。"] },
        "外围防御战略": { name: "外围防御战略", kind: "CONQUEST", targets: ["1. 澳洲委任统治地: 西北新几内亚(Sarong, Vogelkop, Biak), Guadalcanal瓜岛, Port Moresby莫尔茨比", "2. 新几内亚: Hollandia, Lae, Buna, Biak, Vogelkop, Wewak, Gili-Gili, Port Moresby"], notes: [] },
        "事件战略": { name: "事件战略", kind: "EVENT", targets: ["1. 欧战为正打欧战牌,否则FOQ", "2. 结束日本ISR", "3. 造成美国ISR", "4. 东京玫瑰", "5. 补员牌", "6. 天气牌", "7. 东条作为1OC", "8. 其他放牌"], notes: ["[3].如果卡牌条件允许,按照策略指示使用卡牌。", "[5].如果欧洲战事为正数,则打出可用的欧战牌,否则按指示投骰。"] },
    },
    mid: {
        "资源战略": { name: "资源战略", kind: "CONQUEST", targets: ["1. 占领资源: Seoul首尔, Manila马尼拉, Kuantan关丹, 所有东印度资源", "2. 新几内亚投降: 16个目标顺序推进 (见外围防御)", "3. 缅甸投降: Rangoon, Mandalay, Lashio, Myitkyina", "4. 中国投降: Lashio, 中国攻势, 中国事件", "5. 加强港口: Truk, Rabaul, Saipan, Davao, Saigon, Eniwetok, Kwajalein, Palau"], notes: ["[3].占领尽可能多的资源格,直到日本控制至少13个(优先无敌军、弱敌军)。", "[5].在指定位置放置至少3step地面或1step空中单位。"] },
        "中太平洋战略": { name: "中太平洋战略", kind: "CONQUEST", targets: ["1. Attu/Kiska阿图", "2. Wake威克岛", "3. Midway中途岛", "4. 攻击美国舰队"], notes: [] },
        "中缅印战略": { name: "中缅印战略 (CBI)", kind: "CONQUEST", targets: ["1. 缅甸投降: Rangoon, Mandalay, Lashio, Myitkyina", "2. 中国投降: Lashio, 中国攻势, 中国事件", "3. 加强港口", "4. 印度投降: Akyab, Imphal, Dimasur, Jarhat, Ledo, Dacca", "5. 事件战略"], notes: ["[1].如果卡牌条件允许,按照策略指示使用卡牌。"] },
        "印度战略": { name: "印度战略", kind: "CONQUEST", targets: ["1. 印度投降: Akyab, Imphal, Dimasur, Jarhat, Ledo, Dacca", "2. 中国投降: Lashio, 中国攻势, 中国事件", "3. 加强港口"], notes: [] },
        "外围防御战略": { name: "外围防御战略", kind: "CONQUEST", targets: ["1. 南太平洋侧翼: Biak, Vogelkop, Hollandia, Lae, Buna, Buin, Gili-Gili, Port Moresby", "2. 加强港口"], notes: ["[4].如果可能的话,用AZOI覆盖这些目标,否则转移到下一个目标。", "[5].在指定位置放置至少3step地面或1step空中单位。"] },
        "事件战略": { name: "事件战略", kind: "EVENT", targets: ["同早期阶段事件战略"], notes: ["[1].如果卡牌条件允许,按照策略指示使用卡牌。"] },
        "PASS": { name: "PASS", kind: "PASS", targets: ["跳过本回合行动"], notes: [] },
    },
    late: {
        "最终国防圈战略": { name: "最终国防圈战略", kind: "GARRISON", targets: ["1. 港口驻军: Okinawa冲绳, Seoul首尔, Pusan釜山, Tainan台南, Saipan/Tinian塞班", "2. 机场驻军: Iwo Jima硫磺岛, Kyoto京都", "3. 日本港口驻军: Sasebo佐世保, Kure吴, Tokyo东京, Osaka大阪, Nagoya名古屋, Ominato大凑, Hakodate函馆"], notes: ["[3].将任意空中/海上补员用于本州岛，维持到资源格的AZOI。"] },
        "最终防御战略": { name: "最终防御战略", kind: "DEFEND", targets: ["1. 集结部队", "2. 海空支援", "3. 板载冲锋"], notes: ["[4].移动地面单位填满盟军占据格的相邻格。", "[5].尽可能在本州岛每个六角格放置空中/海上单位。", "[6].如果相邻格被占据满，用最大战力进攻盟军。", "[7].所有本州岛战斗派空中/海上单位支援。", "[8].战斗到最后一step地面单位。"] },
        "事件战略": { name: "事件战略", kind: "EVENT", targets: ["同早期阶段事件战略"], notes: ["[1].如果满足条件按顺序执行。第12回合绝不把牌作为FOQ。"] },
        "PASS": { name: "PASS", kind: "PASS", targets: ["跳过本回合行动"], notes: [] },
    },
}

const ESM_AL_LIB = {
    early: {
        "撤离菲律宾": { name: "撤离菲律宾", kind: "EVENT", targets: ["1. P旅到Biak", "2. R军到Kendari", "3. [SL]军到Manila", "4. [FEAF]到Manila", "5. [19 LRB]到Timor"], notes: ["如果单位已就位则视为完成"] },
        "撤离马来亚": { name: "撤离马来亚", kind: "EVENT", targets: ["1. 8 Aus到Kendari", "2. MA Air到Palembang"], notes: [] },
        "建立ABDA": { name: "建立 ABDA 指挥部", kind: "EVENT", targets: ["放置ABDA HQ到: 1. Tjilatjap, 2. Kendari, 3. Balikpapan, 4. Soerabaja, 5. Tarakan"], notes: [] },
        "增强CBI防御": { name: "增强 CBI 防御", kind: "EVENT", targets: ["1. 1 Ind到Rangoon", "2. B Ind师到Akyab", "3. 66集团军到Lashio", "4. 6集团军到Mandalay", "5. 5集团军到Myitkyina", "6. 1 Burma到Imphal"], notes: ["所有单位就位视作建立完成"] },
        "DEI防御": { name: "DEI 防御", kind: "EVENT", targets: ["派英联邦或美军前往ABDA HQ港口 (Tjilatjap, Kendari, Balikpapan, Soerabaja, Tarakan)"], notes: [] },
        "橙色计划": { name: "橙色计划 (Plan Orange)", kind: "CONQUEST", targets: ["1. 美国军护航派往莱特岛(Leyte)", "2. 若莱特被控，派往马尼拉(Manila)"], notes: [] },
        "攻势进攻": { name: "攻势进攻", kind: "EVENT", targets: ["1. 对最弱日本单位发起1x海空攻击", "2. 脱离最后一支航母避免被灭"], notes: [] },
        "事件战略": { name: "事件战略", kind: "EVENT", targets: ["1. 欧战事件", "2. 结束ISR或FOQ", "3. 造成日本ISR", "4. 杜立特空袭", "5. 巴丹行军", "6. FOQ"], notes: [] },
    },
    mid: {
        "反攻战略": { name: "反攻战略", kind: "CONQUEST", targets: ["1. Midway中途岛", "2. Dutch Harbor荷兰港", "3. Dacca达卡(仅地面推进)", "4. Dimasur迪马布尔", "5. Jarhat乔尔哈特", "6. Ledo雷多", "7. Imphal/Kohima英帕尔", "8. 澳洲港口(优先地面,其次AA)", "9. 澳洲机场(优先地面,其次AA)", "10. Guadalcanal瓜岛", "11. Attu/Kiska阿图岛", "12. Port Moresby莫尔茨比(仅地面推进)", "13. Gili-Gili吉里吉里(仅地面推进)", "14. New Hebrides新赫布里底(通过AA)", "15. Noumea努美阿(优先AA,其次地面)", "16. Roll 1d10 切换其他战略"], notes: ["按顺序占领, 无法攻击则向前移动基地", "多余激活点攻击日军航空兵"] },
        "南太平洋战略": { name: "南太平洋战略", kind: "CONQUEST", targets: ["1. Guadalcanal", "2. Gili-Gili", "3. Port Moresby", "4. Buna", "5. Lae", "6. New Georgia", "7. Bougainville", "8. Gasmata/Rabaul", "9. Madang", "10. Wewak", "11. Aitape", "12. Admiralty Islands", "13. Hollandia", "14. Biak", "15. Sarong", "16. Vogelkop"], notes: ["优先ANZAC或SW Pac HQ"] },
        "中太平洋战略": { name: "中太平洋战略", kind: "CONQUEST", targets: ["1. Wake威克岛", "2. Tarawa塔拉瓦", "3. Kwajalein夸贾林", "4. Eniwetok恩尼威托克", "5. Palau帕劳", "6. Uluthi乌利西", "7. Saipan塞班"], notes: ["优先Cen Pac HQ，其次SW Pac HQ"] },
        "CBI战略": { name: "CBI 战略", kind: "CONQUEST", targets: ["1. Dacca", "2. Akyab", "3. Dimasur", "4. Jarhat", "5. Imphal/Kohima", "6. Ledo", "7. Myitkyina", "8. Lashio", "9. Mandalay", "10. Rangoon"], notes: ["优先SEAC HQ或联合HQ"] },
        "DEI战略": { name: "DEI 战略", kind: "CONQUEST", targets: ["1. Timor", "2. Kendari", "3. Soerabaja", "4. Balikpapan", "5. Tarakan"], notes: ["优先ANZAC或SW Pac HQ"] },
    },
    late: {
        "占领轰炸基地": { name: "占领战略轰炸基地", kind: "CONQUEST", targets: ["1. Saipan塞班", "2. Guam关岛", "3. Marcus Island南鸟岛", "4. Iwo Jima硫磺岛", "5. Okinawa冲绳", "6. Tainan台南", "7. Taihoku台北"], notes: ["使用最大攻势卡占领"] },
        "推进B29": { name: "推进 B29", kind: "ABSTRACT", targets: ["使用OC移动B29到战略基地", "剩余激活点攻击指挥范围内日军航母/空军"], notes: [] },
        "重返菲律宾": { name: "重返菲律宾", kind: "CONQUEST", targets: ["1. 占领连接SW Pac HQ距莱特4格基地", "2. Leyte莱特", "3. Davao达沃", "4. 2912六角格(与马尼拉相邻)", "5. Manila马尼拉", "6. 解放 DEI", "7. 解放马来亚"], notes: ["优先SW Pacific HQ"] },
        "跳岛作战": { name: "跳岛作战", kind: "CONQUEST", targets: ["1. Kwajalein夸贾林", "2. Eniwetok恩尼威托克", "3. Saipan塞班", "4. Iwo Jima硫磺岛", "5. Okinawa冲绳", "6. 登陆日本"], notes: ["优先Cen Pacific HQ", "在最高优先级目标达成前，不要执行下一个目标"] },
        "原子弹胜利": { name: "原子弹胜利", kind: "ABSTRACT", targets: ["1. 打出苏联入侵满洲", "2. 占领剩下的日本资源格"], notes: ["需无战略轰炸失败且日本资源<=3 (未打出苏联入侵时<=5)"] },
        "登陆日本": { name: "登陆日本", kind: "CONQUEST", targets: ["1. Sasebo佐世保", "2. Tokyo东京", "3. Ominato大凑", "4. 3606格", "5. Nagoya名古屋", "6. Kyoto京都", "7. Kure吴", "8. Osaka大阪"], notes: [] },
    },
}

function esm_lib(role) { return role === "Japan" ? ESM_JP_LIB : ESM_AL_LIB }
function esm_strategy_entry(role, phase, name) {
    return (esm_lib(role)[phase] || {})[name] || null
}
// C: 决策树输出名 -> 本次钉住应绑定的库条目。
//   • 事件战略: 任何阶段都绑定【早期】条目 —— py 中/晚期 JP 表目标 = “同早期阶段事件战略”,
//     AL mid/late 决策树直接 return AL_EARLY_STRATEGIES["事件战略"], 早期条目即完整清单。
//   • PASS: 库中无条目, 给字面条目。
//   • 其余: 本阶段精确命中; 无则跨阶段回找(防御, 避免静默空钉)。
function esm_bind_strategy_entry(role, phase, name) {
    const earlyEvt = name === "事件战略" ? esm_strategy_entry(role, "early", name) : null
    if (earlyEvt) return earlyEvt
    if (name === "PASS") return { name: "PASS", kind: "PASS", targets: ["跳过本回合行动"], notes: [] }
    const hit = esm_strategy_entry(role, phase, name)
    if (hit) return hit
    for (const p of ["early", "mid", "late"]) {
        if (p === phase) continue
        const h = esm_strategy_entry(role, p, name)
        if (h) return h
    }
    return null
}
// "轮流战略": 上次重返->跳岛; 上次跳岛->重返。
function esm_resolve_alternate(lock, role) {
    const last = lock && lock.role && lock.role[role] && lock.role[role].strategyName
    return last === "重返菲律宾" ? "跳岛作战" : "重返菲律宾"
}
function esm_eval(role, phase, ctx, lock) {
    let name
    if (role === "Japan") {
        if (phase === "early") name = esm_jp_eval_early(ctx)
        else if (phase === "mid") name = esm_jp_eval_mid(ctx)
        else name = esm_jp_eval_late(ctx)
    } else {
        if (phase === "early") name = esm_al_eval_early(ctx)
        else if (phase === "mid") name = esm_al_eval_mid(ctx)
        else name = esm_al_eval_late(ctx)
    }
    if (name === "轮流战略") name = esm_resolve_alternate(lock, role)
    return name
}

// ===========================================================================
// D2: 跨回合同轴延续(pin 层驱动, 不改 esm_eval 纯树/保真测试)。
// py 参考 demo 的语义是“一条战略执行到目标达成或阶段切换”; zh.7 逐回合首卡独立
// 重掷, 使中太平洋/CBI 这类 d10 轮换轴每回合对翻、链首格(如 Kwajalein)始终夺不下。
// 规则: 仅当“旧轴与新掷都是同阶段 d10 轮换轴”时, 若旧轴仍具未夺目标且尚未停滞,
// 则延续旧轴(override 本次重掷); 旧轴连钉 ≥2 回合仍无链上推进则放行换轴(停滞出口,
// 避免死守无产出轴)。树的确定性优先分支(can_pass/事件/反攻/占领轰炸基地/推进B29/
// 原子弹/登陆日本 等)不是轮换轴, 照常打断延续。
// ===========================================================================
const ESM_ROLL_AXES = {
    mid: { "南太平洋战略": 1, "中太平洋战略": 1, "DEI战略": 1, "CBI战略": 1 },
    late: { "重返菲律宾": 1, "跳岛作战": 1 },
}
function esm_is_roll_axis(phase, name) {
    return !!(phase === "mid" || phase === "late") && (ESM_ROLL_AXES[phase] || {})[name]
}
function esm_chain_focus(chain, faction) {
    for (const h of chain || []) {
        if (!(h >= 0 && h <= LAST_BOARD_HEX)) continue
        if (!is_space_controlled(h, faction)) return h
    }
    return null
}
function esm_chain_held_count(chain, faction) {
    let n = 0
    for (const h of chain || []) {
        if (h >= 0 && h <= LAST_BOARD_HEX && is_space_controlled(h, faction)) n++
    }
    return n
}
function esm_pin_axis_continuity(lock, role, phase, freshName) {
    const c = lock.role[role]
    if (!c || !c.strategy) return freshName
    if (c.phase !== phase) return freshName
    const prevName = c.strategyName
    if (!esm_is_roll_axis(phase, prevName) || !esm_is_roll_axis(phase, freshName)) return freshName
    if (freshName === prevName) return freshName
    const chain = c.strategy.chain
    if (!Array.isArray(chain) || !chain.length) return freshName
    const faction = esm_role_faction(role)
    if (esm_chain_focus(chain, faction) === null) return freshName            // 链目标全达成 -> 允许重掷
    const elapsed = G.turn - (c.runStart || G.turn)
    if (elapsed >= 2 && esm_chain_held_count(chain, faction) <= (c.runHeld === undefined ? 0 : c.runHeld)) return freshName // 停滞 -> 放行
    return prevName
}

// ===========================================================================
// 主入口: 每窗口调用；每次选牌都重新走决策轴，随后只缓存到该牌的动作/执行窗口。
// 返回 null 表示 gate 关(调方走原路径)。strategy: {name,kind,tokens,notes,phase,role,chain,axisTrace}
// ===========================================================================
function esm_pin_strategy(view, context) {
    if (!esm_gate_on()) return null
    const role = context.role
    if (role !== "Japan" && role !== "Allies") return null
    const ord = context.actionOrdinal || 0
    const lock = esm_lock(context.seed, ord)
    if (typeof context.seed !== "undefined" && context.seed !== null) lock.seenOrd = ord

    const faction = esm_role_faction(role)
    const cached = lock.role[role]
    const thisIsCardDecision = esm_is_card_window(view)
    if (!thisIsCardDecision) {
        // 非选牌窗只沿用最近一次选牌形成的战略，以保证该张牌的后续窗口一致。
        return (cached && cached.turn === G.turn) ? cached.strategy : null
    }

    const phase = esm_phase(role)
    const seedText = `${context.seed}:${ord}:${role}:${phase}:${G.turn}`
    const ctx = esm_build_ctx(role, lock, seedText)
    let name = esm_eval(role, phase, ctx, lock)
    // 事件战略: 钉住内容统一展开到【早期】事件清单(py 三处口径殊途同归):
    //   (a) JP 表中/晚期目标 = "同早期阶段事件战略"(指针);
    //   (b) AL mid/late 决策树直接 return AL_EARLY_STRATEGIES["事件战略"](py 共用早期条目,
    //       且 JS AL mid/late 库无此键 —— 原实现静默落空 EVENT);
    //   (c) 早期条目自身即完整 8/6 行清单。
    // 故无论哪阶段选中事件战略, 都按【早期】清单整回合执行(C: 事件战略顺序化)。
    // 事件战略 -> 早期条目(见 esm_bind_strategy_entry 注释)。
    const isEventStrat = name === "事件战略"
    const entry = esm_bind_strategy_entry(role, phase, name)
    const contentPhase = isEventStrat ? "early" : phase
    let goals = [], chain = [], dynamicTargets = [], targetMeta = []
    if (entry) {
        // 忠实 parse_goals: 有序 Goal(kind+hex+region) + 指针/资源/落底展开。
        try { goals = esm_parse_entry(entry, role, contentPhase) } catch (e) { goals = [] }
        chain = esm_chain_of(goals)
        targetMeta = esm_goal_target_meta(goals)
    }
    if (role === "Japan" && (name === "保守的空优战略" || name === "激进的南方资源战略")) {
        dynamicTargets = esm_jp_hq_suppression_targets()
        chain = dynamicTargets.map(target => target.hex).concat(chain.filter(h => !dynamicTargets.some(target => target.hex === h)))
        const dynamicHexes = new Set(dynamicTargets.map(target => target.hex))
        targetMeta = dynamicTargets.concat(targetMeta.filter(target => !dynamicHexes.has(target.hex)))
    }
    // 投降完成度只做审计，不覆盖第1页实际选出的空优、资源或事件战略。
    const openingSurrenderPlan = role === "Japan" && G.turn <= 4 ? {
        philippinesComplete: !!G.surrender[nations.PHILIPPINES.id],
        deiComplete: !!G.surrender[nations.DEI.id], diagnosticOnly: true,
    } : null
    if (role === "Japan" && name === "最终防御战略") {
        dynamicTargets = esm_jp_final_defense_targets()
        chain = dynamicTargets.map(target => target.hex)
        targetMeta = dynamicTargets.slice()
    }
    // D4: ABSTRACT 自身无 hex 链(纯文本目标), 落到可执行回退链, 让 eop 焦点层在"推进B29/
    // 原子弹胜利"钉住期间仍有可打的主攻方向:
    //   推进B29   -> 占领轰炸基地(把基地前推到距东京 ≤8, B29 才谈得上就位/轰炸);
    //   原子弹胜利 -> 精确选择两个仍由日本控制的资源格。
    if (entry && entry.kind === "ABSTRACT" && !chain.length) {
        const fbName = name === "推进B29" ? "占领轰炸基地" : null
        if (fbName) {
            const fb = esm_strategy_entry(role, "late", fbName)
            if (fb) {
                try {
                    const fbGoals = esm_parse_entry(fb, role, "late")
                    goals = fbGoals
                    chain = esm_chain_of(fbGoals)
                    targetMeta = esm_goal_target_meta(fbGoals)
                } catch (e) { /* 保持空链 */ }
            }
        }
        if (name === "原子弹胜利" && typeof atomic_bomb_strategy_status === "function") {
            const atomic = atomic_bomb_strategy_status()
            const resourceTargets = atomic.jpResourceHexes.map(hex => ({ hex, kind: "CONQUEST",
                objective: "原子弹胜利：占领两个剩余日本资源格", damageLevel: 1,
                requiresOccupation: true, victoryConstraint: "ATOMIC_CAPTURE_TWO_RESOURCES" }))
                .sort((a, b) => esm_front_distance(a.hex, AP) - esm_front_distance(b.hex, AP) || a.hex - b.hex)
                .slice(0, 2)
            chain = resourceTargets.map(x => x.hex)
            targetMeta = resourceTargets
            dynamicTargets = resourceTargets
        }
    }
    // B29 在第9回合进入；若到第9回合才开始找基地，战略轰炸链必然滞后。中期后半段
    // 仍保留决策轴选出的战区/战略名称，但以明确的规则胜利前视把图表已有“占领战略
    // 轰炸基地”链放到执行队首。PoW 亏空会在下一段再次前插，故政治意志生存仍优先。
    let victoryApproach = null
    if (role === "Allies" && phase === "mid" && G.turn >= 6) {
        const bombingEntry = esm_strategy_entry("Allies", "late", "占领轰炸基地")
        if (bombingEntry) {
            let approach = []
            try { approach = esm_goal_target_meta(esm_parse_entry(bombingEntry, "Allies", "late")) } catch (e) { approach = [] }
            approach = approach.filter(x => x.hex >= 0 && x.hex <= LAST_BOARD_HEX && !is_space_controlled(x.hex, AP))
                .map(x => ({ ...x, kind: "CONQUEST", requiresOccupation: true,
                    objective: `B29前置夺岛：${get_map_data(x.hex).name || x.hex}`,
                    victoryConstraint: "B29_BASE_APPROACH" }))
            if (approach.length) {
                const hs = new Set(approach.map(x => x.hex))
                chain = approach.map(x => x.hex).concat(chain.filter(h => !hs.has(h)))
                targetMeta = approach.concat(targetMeta.filter(x => !hs.has(x.hex)))
                dynamicTargets = approach.concat(dynamicTargets.filter(x => !hs.has(x.hex)))
                victoryApproach = { type: "B29_BASE_APPROACH", source: "RULE_VICTORY_OVERLAY",
                    turn: G.turn, remaining: approach.map(x => x.hex) }
            }
        }
    }
    let progressPlan = null
    if (role === "Allies") {
        const progress = esm_ap_progress_targets(chain, targetMeta)
        if (progress.length) {
            const progressHexes = new Set(progress.map(x => x.hex))
            chain = progress.map(x => x.hex).concat(chain.filter(h => !progressHexes.has(h)))
            targetMeta = progress.concat(targetMeta.filter(x => !progressHexes.has(x.hex)))
            dynamicTargets = progress.concat(dynamicTargets.filter(x => !progressHexes.has(x.hex)))
            progressPlan = { required: Number(G.pow || 0), bank: esm_pow_bank(), remaining: progress.map(x => x.hex) }
        }
    }
    let victoryPreparation = victoryApproach
    if (role === "Allies" && phase === "late" && name === "登陆日本" && typeof atomic_bomb_strategy_status === "function") {
        const atomic = atomic_bomb_strategy_status()
        if (atomic.noStrategicBombingFailure && atomic.sovietReady && !atomic.resourcesSatisfied) {
            const resourceTargets = atomic.jpResourceHexes.map(hex => ({ hex, kind: "CONQUEST",
                objective: "原子弹战略准备：夺取剩余日本资源格", damageLevel: 1,
                requiresOccupation: true, victoryConstraint: "ATOMIC_RESOURCE_LIMIT" }))
                .sort((a, b) => esm_front_distance(a.hex, AP) - esm_front_distance(b.hex, AP) || a.hex - b.hex)
            const resourceHexes = new Set(resourceTargets.map(x => x.hex))
            chain = resourceTargets.map(x => x.hex).concat(chain.filter(h => !resourceHexes.has(h)))
            targetMeta = resourceTargets.concat(targetMeta.filter(x => !resourceHexes.has(x.hex)))
            dynamicTargets = resourceTargets.concat(dynamicTargets.filter(x => !resourceHexes.has(x.hex)))
            victoryPreparation = { type: "ATOMIC_RESOURCE_LIMIT", current: atomic.jpResources,
                limit: atomic.resourceLimit, remaining: resourceTargets.map(x => x.hex) }
        } else {
            const blockadeTargets = esm_ap_blockade_targets()
            const blockadeHexes = new Set(blockadeTargets.map(x => x.hex))
            chain = blockadeTargets.map(x => x.hex).concat(chain.filter(h => !blockadeHexes.has(h)))
            targetMeta = blockadeTargets.concat(targetMeta.filter(x => !blockadeHexes.has(x.hex)))
            dynamicTargets = blockadeTargets.concat(dynamicTargets.filter(x => !blockadeHexes.has(x.hex)))
            let connected = null
            try { connected = !!check_japan_resource_trace() } catch (e) { /* 仅诊断 */ }
            victoryPreparation = { type: "JAPAN_RESOURCE_BLOCKADE", source: "RULE_VICTORY_OVERLAY",
                connected, timerStart: is_event_active(events.JAPAN_TRACE_RESOURCES) || 0,
                remaining: blockadeTargets.map(x => x.hex),
                note: "夺取北方港口与南方岛链机场，部署航空AZOI并清除日军航空，维持连续三个国势阶段断线" }
        }
    }
    const strategy = entry ? {
        name, nameFull: entry.name, kind: entry.kind, notes: entry.notes, targets: entry.targets,
        phase, role, seed: seedText, ord, pinnedNow: true, goals, chain, dynamicTargets, targetMeta, ctx,
        nodePath: (ctx._nodePath || []).slice(), conditions: (ctx._conditions || []).slice(), d10Rolls: (ctx._dice || []).slice(),
        eventPhase: isEventStrat ? "early" : undefined,
        openingSurrenderPlan, progressPlan, victoryPreparation,
    } : {
        name, nameFull: name, kind: "EVENT", notes: [], targets: [], phase, role, ord,
        pinnedNow: true, goals: [], chain: [], targetMeta: [], ctx,
        nodePath: (ctx._nodePath || []).slice(), conditions: (ctx._conditions || []).slice(), d10Rolls: (ctx._dice || []).slice(),
    }
    // D2: 记录本轴连续运行起点的回合与链上控格数(供下一回合的延续/停滞判定)。
    const prevCache = lock.role[role]
    const sameRun = !!(prevCache && prevCache.strategyName === name)
    const runStart = (sameRun && prevCache.runStart) ? prevCache.runStart : G.turn
    const runHeld = (sameRun && prevCache.runHeld !== undefined) ? prevCache.runHeld : esm_chain_held_count(chain, faction)
    lock.role[role] = { turn: G.turn, phase, strategyName: name, strategy, runStart, runHeld }
    return strategy
}

// ---- 选牌/选行动窗口的行为 --------------------------------------------------
// 依据已钉战略返回 { action, argument }(未钉或非法时返回 null → 调方走原路径)。
function esm_card_window_action(strategy, view, context) {
    const legal = Object.keys(view.actions || {}).filter(a => { const v = view.actions[a]; return Array.isArray(v) ? v.length > 0 : Boolean(v) })
    const hand = Array.isArray(view.actions.card) ? view.actions.card.slice() : []
    if (!hand.length) return null
    const faction = esm_role_faction(strategy.role)
    const wantOps = strategy.kind === "CONQUEST" || strategy.kind === "ABSTRACT"
    const wantEvent = strategy.kind === "EVENT"
    if (strategy.kind === "PASS" && legal.includes("pass")) return { action: "pass", argument: undefined, via: strategy.name }

    // 原子弹标准把“苏联入侵已发生，或持有且可作为事件打出”列为硬条件。
    // 旧选牌树会在晚期把 AP#79 当普通高 OC 消耗（历史复盘 seed 20260903 即如此），
    // 随后整局再也无法满足该条件。只要事件当前合法就立即执行；否则由下方选牌树
    // 在仍有其他牌时保留它。
    if (strategy.role === "Allies" && typeof SOVIET_INVADE !== "undefined" && hand.includes(SOVIET_INVADE)) {
        const classified = classifyCards(hand, strategy.role)
        const soviet = classified.find(x => x.id === SOVIET_INVADE)
        if (soviet && soviet.eventPlayable) {
            return esm_set_card_pick(strategy, soviet, "event", "AP10-S-EVENT", "盟军胜利条件：苏联入侵满洲事件")
        }
    }

    // AP09 注释：占领战略轰炸基地必须使用当前最大的有效攻势卡。
    // 先选可作为 EC 的军事事件（按 LV），没有时才选最大 OC。
    if(strategy.role==="Allies"&&strategy.name==="占领战略轰炸基地"){
        const classified=classifyCards(hand,strategy.role)
        const ec=classified.filter(c=>c.military&&c.eventPlayable).sort((a,b)=>b.lv-a.lv||b.ops-a.ops||a.id-b.id)
        const oc=classified.filter(c=>c.opsPlayable).sort((a,b)=>b.ops-a.ops||a.id-b.id)
        const chosen=ec[0]||oc[0]
        if(chosen){
            const node=ec[0]?(chosen.restricted?"AP10-S-RESTRICTED-EC":"AP10-S-UNRESTRICTED-EC")
                :(chosen.military&&chosen.restricted?"AP10-S-RESTRICTED-OC":"AP10-S-NONMIL-OC")
            return esm_set_card_pick(strategy,chosen,ec[0]?"event":"ops",node,"占领战略轰炸基地:最大有效攻势卡")
        }
    }

    // 条约谈判生存约束：PoW 是每回合结算的硬门槛；只要尚未达标，设置 FO、PASS
    // 或低优先事件都会减少本回合补足夺格数的机会。因此从第一张可用牌起就用最大
    // 有效攻势执行 progressPlan；达标后立刻恢复第10页正常选牌树。
    // 这是对胜负规则的前视约束，不凭空增加目标、战力或合法动作。
    const powDeficit = Math.max(0, Number(G.pow || 0) - esm_pow_bank())
    if (strategy.role === "Allies" && powDeficit > 0) {
        const classified = classifyCards(hand, strategy.role)
        const ec = classified.filter(c => c.military && c.eventPlayable)
            .sort((a,b)=>b.lv-a.lv||b.ops-a.ops||a.id-b.id)
        const oc = classified.filter(c => c.opsPlayable)
            .sort((a,b)=>b.ops-a.ops||Number(a.military)-Number(b.military)||a.id-b.id)
        const chosen = ec[0] || oc[0]
        if (chosen) {
            strategy.powEmergency = { politicalWill: Number(G.political_will), required: Number(G.pow), bank: esm_pow_bank() }
            const node=ec[0]?(chosen.restricted?"AP10-S-RESTRICTED-EC":"AP10-S-UNRESTRICTED-EC")
                :(chosen.military&&chosen.restricted?"AP10-S-RESTRICTED-OC":"AP10-S-NONMIL-OC")
            return esm_set_card_pick(strategy, chosen, ec[0] ? "event" : "ops", node,
                `盟军PoW紧急攻势:${esm_pow_bank()}/${G.pow}，余牌${hand.length}，政治意志${G.political_will}`)
        }
    }

    // 第4/10页是每次出牌都必须重走的独立决策树，不能被当前决策轴的 CONQUEST/EVENT
    // 类型短路。返回 null 才表示图表没有给出可执行牌，继续使用战略轴的事件清单。
    const chartPick = esm_card_selection_tree(strategy, hand)
    if (chartPick) return chartPick

    // 日本第4页：手牌多于2张时，C/D 未命中后先检查 E“可执行的无限制军事事件”。
    // 旧实现按决策轴战略类型直接挑 OC，完全绕过本页，因而会把反应牌当 OC，同时留下
    // 高后勤军事事件。命中 E 时按图表的 EC 选择标准取后勤值最高者，并把用途意图带到
    // 下一“Select action”窗口。
    if (strategy.role === "Japan") {
        const classified = classifyCards(hand, strategy.role)
        if (classified.length > 2) {
            const unrestricted = classified.filter(c => c.unrestricted && c.eventPlayable)
            if (unrestricted.length) {
                unrestricted.sort((a, b) => b.lv - a.lv || b.ops - a.ops || a.id - b.id)
                const chosen = unrestricted[0]
                strategy.cardIntent = "event"
                strategy.selectedCard = chosen.id
                strategy.cardTreeNode = "JP04-S-UNRESTRICTED-EC"
                return { action: "card", argument: chosen.id, via: `日本卡牌选择:E→无限制军事事件EC(LV ${chosen.lv})` }
            }
        }
    }
    if (strategy.kind === "GARRISON" || strategy.kind === "DEFEND") {
        // 国防圈与最终防御都需要实际激活、移动和会战。第4页若已经选中可执行
        // 军事事件，chartPick 会在上方返回并保留 event 意图；其余情况必须选 OC，
        // 不能用低值事件把整个防御行动窗口耗掉。
        return esm_choose_card(hand, "ops", legal, strategy)
            || esm_choose_card(hand, "event", legal, strategy)
    }
    if (strategy.kind === "ABSTRACT") {
        // D4: 推进B29/原子弹胜利 = 打 OC 攻势把基地/资源链推向完成(而非当事件空耗)。
        // 原子弹胜利: 手中持"苏联入侵满洲"(AP#79)且可作事件时优先事件打出。
        const at = esm_atomic_event_pick(strategy, hand)
        if (at) return at
        const r = esm_choose_card(hand, "ops", legal, strategy)
        if (r) return r
        return esm_choose_card(hand, "event", legal, strategy) || null
    }
    if (wantOps) {
        const r = esm_choose_card(hand, "ops", legal, strategy)
        if (r) return r
        return esm_choose_card(hand, "event", legal, strategy) || null
    }
    if (wantEvent) {
        // C: 事件战略按早期事件清单顺序定向选牌; 清单无可执行行 -> 退化为通用选牌。
        const dl = esm_event_strategy_card_pick(strategy, hand)
        if (dl) return dl
        const r = esm_choose_card(hand, "event", legal, strategy)
        if (r) return r
        return esm_choose_card(hand, "ops", legal, strategy) || null
    }
    return null
}

// 在 hand 中选一张可作 action 意图(经 get_allowed_actions 验证)的牌:
//   ops   -> 行动值(OV)最高的可打 OC 的牌
//   event -> 可作事件中最小的 OV(保住大 OC 牌; 事件效益已含在己方牌组)
// 验证失败退化(不抛错): 选任一手牌(仍由上层确保合法 action)。
function esm_choose_card(hand, intent, legal, strategy) {
    const classified = classifyCards(hand, strategy.role)
    const byId = new Map(classified.map(c => [c.id, c]))
    const hasIntent = c => (byId.get(c)?.allowed || []).includes(intent)
    const ev = intent === "event"
    let pool = hand.filter(hasIntent)
    if (!pool.length) pool = hand.slice()
    if (!pool.length) return null
    const score = c => byId.get(c) || { ops:0, military:false, eventRank:99 }
    pool.sort((a, b) => {
        const x=score(a), y=score(b)
        if (ev) return x.eventRank-y.eventRank || x.ops-y.ops || a-b
        // 图表 OC：先用非军事牌；只有没有非军事牌时才进入军事牌池。
        return Number(x.military)-Number(y.military) || y.ops-x.ops || a-b
    })
    const chosen = pool[0]
    const viaAction = hasIntent(chosen) ? intent : (byId.get(chosen)?.allowed || []).includes("event") ? "event" : "ops"
    return { action: "card", argument: chosen, via: `${strategy.name}:${viaAction}` }
}

function esm_set_card_pick(strategy, card, intent, node, label) {
    strategy.cardIntent=intent
    strategy.selectedCard=card.id
    strategy.cardTreeNode=node
    return {action:"card",argument:card.id,via:label}
}

function esm_card_selection_tree(strategy, hand) {
    const side=strategy.role==="Japan"?"JP":"AP", prefix=side==="JP"?"JP04":"AP10"
    let c=classifyCards(hand,strategy.role)
    if(!c.length)return null
    if(side==="AP"&&c.length>1&&typeof SOVIET_INVADE!=="undefined"){
        const withoutSoviet=c.filter(x=>x.id!==SOVIET_INVADE)
        if(withoutSoviet.length)c=withoutSoviet
    }
    // JP04 注释：Operation MI 除非仍在早期且执行中太平洋/外围防御，或它是唯一可用牌，否则不纳入评估。
    if(side==="JP"&&c.length>1&&!(strategy.phase==="early"&&/中太平洋|外围防御/.test(strategy.name)))
        c=c.filter(x=>!/^operation mi$/i.test(x.name))
    const bonusRank=x=>x.reinforcementBonus?0:x.otherBonus?1:2
    const sortEvent=(a,b)=>b.lv-a.lv||bonusRank(a)-bonusRank(b)||b.ops-a.ops||a.id-b.id
    const sortOps=(a,b)=>Number(a.military)-Number(b.military)||b.ops-a.ops||a.id-b.id
    // 第5页注释要求“为每个目标编成任务部队”。开局菲律宾/东印度是夺占
    // 目标：EC 若限定在错误 HQ，或事件过滤掉地面/海军之一，就不能形成
    // 地面占领 + 海军护航（航空/航母可从格外参战）的完整编成。这样的牌
    // 保留 OC 用法，不能因牌面 LV 高就浪费为无效事件。
    const openingOccupation=side==="JP"&&Number(G.turn)===2&&
        (strategy.targetMeta||[]).some(t=>t&&t.requiresOccupation)
    const event=c.filter(x=>x.eventPlayable&&(!openingOccupation||x.openingOccupationCompatible))
    const ops=c.filter(x=>x.opsPlayable)
    const unres=event.filter(x=>x.unrestricted), restricted=c.filter(x=>x.restricted)
    const eligibleEventIds=new Set(event.map(x=>x.id))
    const restrictedEvent=restricted.filter(x=>eligibleEventIds.has(x.id))
    const nonMilitaryOps=ops.filter(x=>!x.military)
    const played=!!(G.offensive&&G.offensive.active_cards&&G.offensive.active_cards.length)
    // AP L+M：每次非首张攻势牌前，若中国距投降≤2且有可用中国事件，立即打出。
    if(side==="AP"&&played&&G.surrender&&G.surrender[nations.CHINA.id]>=3){
        const china=event.filter(x=>cards[x.id]&&cards[x.id].china)
        if(china.length)return esm_set_card_pick(strategy,china.sort(sortEvent)[0],"event",`${prefix}-S-CHINA`,"盟军卡牌选择:L+M→中国事件")
    }
    // 图中 B 以下只在手牌>2时进入先发/军事事件链。
    if(c.length>2){
        const firstGame=!(G.discard?.[JP]?.length||G.discard?.[AP]?.length||played)
        if(firstGame){
            const re=side==="JP"?/i.?go|second operational phase|第二阶段作战/i:/flintlock|shoestring|燧发枪|脚指甲/i
            const first=event.filter(x=>re.test(x.name))
            if(first.length)return esm_set_card_pick(strategy,first.sort(sortEvent)[0],"event",`${prefix}-S-FIRST`,`${strategy.role}卡牌选择:C+D→先发打击EC`)
        }
        if(unres.length)return esm_set_card_pick(strategy,unres.sort(sortEvent)[0],"event",`${prefix}-S-UNRESTRICTED-EC`,`${strategy.role}卡牌选择:E→无限制军事事件EC`)
        if(restricted.length){
            if(restrictedEvent.length)return esm_set_card_pick(strategy,restrictedEvent.sort(sortEvent)[0],"event",`${prefix}-S-RESTRICTED-EC`,`${strategy.role}卡牌选择:F+G→有限制军事事件EC`)
            const pool=nonMilitaryOps.length?nonMilitaryOps:ops
            if(pool.length)return esm_set_card_pick(strategy,pool.sort(sortOps)[0],"ops",`${prefix}-S-RESTRICTED-OC`,`${strategy.role}卡牌选择:F+G→受限事件OC`)
        }
        if(ops.length)return esm_set_card_pick(strategy,(nonMilitaryOps.length?nonMilitaryOps:ops).sort(sortOps)[0],"ops",`${prefix}-S-NONMIL-OC`,`${strategy.role}卡牌选择:F→无军事事件OC`)
    }
    // H：本回合已有 FO 时打非军事 OC。J：仅剩一牌且非第12回合，设置 FO。
    const mine=esm_role_faction(strategy.role)
    if(G.future_offensive&&G.future_offensive[mine]>0&&ops.length)
        return esm_set_card_pick(strategy,(nonMilitaryOps.length?nonMilitaryOps:ops).sort(sortOps)[0],"ops",`${prefix}-S-NONMIL-OC`,`${strategy.role}卡牌选择:H→无军事事件OC`)
    if(c.length===1&&G.turn!==12&&c[0].futurePlayable)
        return esm_set_card_pick(strategy,c[0],"future_offensive",`${prefix}-S-FO`,`${strategy.role}卡牌选择:J→未来攻势`)
    // K：最后可用事件是反应牌时不浪费其事件能力，按 OC；否则进入事件战略。
    const usableEvents=event.filter(x=>!cards[x.id]?.reaction)
    if(!usableEvents.length&&ops.length)
        return esm_set_card_pick(strategy,(nonMilitaryOps.length?nonMilitaryOps:ops).sort(sortOps)[0],"ops",`${prefix}-S-NONMIL-OC`,`${strategy.role}卡牌选择:K→保留反应牌`)
    return null
}

// 在真正打牌前做一次只读的启动能力预检。引擎的精确启动区由
// get_activatable_units() 在攻势建立后计算；此处不能调用它（会改写 L 与
// supply_cache），所以按牌面限定 HQ、HQ 指挥范围、补给类型和 OOS 排除
// 明显的“事件可点击、但选完 HQ 后没有任何单位可启动”的空攻势。
// null 表示测试沙箱缺少地图对象，此时保持原有行为，避免把未知当作零。
function esm_card_activation_classes(card) {
    const source=String(card?.before_unit_activation||"")
    let ground=true,naval=true,air=true
    if(/piece\.class\s*===\s*["']air["']/.test(source)){ground=false;naval=false}
    if(/piece\.class\s*===\s*["']naval["']/.test(source)){ground=false;air=false}
    if(/piece\.class\s*===\s*["']ground["']/.test(source)){naval=false;air=false}
    if(/piece\.class\s*!==\s*["']ground["']/.test(source)&&
        !/piece\.class\s*!==\s*["']ground["']\s*\|\|/.test(source))ground=false
    if(/piece\.class\s*!==\s*["']naval["']/.test(source))naval=false
    return {ground,naval,air}
}

function esm_card_activation_capacity(card, role, useEventHq) {
    if (typeof pieces === "undefined" || typeof HQ_LIST === "undefined" ||
        !G || !Array.isArray(G.location) || typeof get_distance !== "function") return null
    const mine=esm_role_faction(role)
    let hqs=(useEventHq&&Array.isArray(card?.hq)&&card.hq.length?card.hq:HQ_LIST).filter(id=>{
        const h=pieces[id],loc=G.location[id]
        return h&&h.class==="hq"&&h.faction===mine&&Number.isFinite(loc)&&
            (typeof LAST_BOARD_HEX==="undefined"||loc<=LAST_BOARD_HEX)&&
            (!(G.oos&&set_has(G.oos,id))||card===cards[GENERAL_ADACHI])
    })
    if(!hqs.length)return 0
    const classes=useEventHq?esm_card_activation_classes(card):{ground:true,naval:true,air:true}
    const source=String(card?.before_unit_activation||"")
    // Operation Z 一类事件显式重建全图候选，不受普通 HQ 启动区预检约束。
    if(useEventHq&&/for_each_unit_on_map/.test(source))
        return pieces.filter((u,id)=>id>0&&u&&u.faction===mine&&u.class!=="hq"&&G.location[id]<=LAST_BOARD_HEX).length
    let best=0
    const exact=typeof mark_activation_zone==="function"&&typeof HEX_TEMP_FLAG3!=="undefined"&&Array.isArray(G.supply_cache)
    const savedCache=exact?G.supply_cache.slice():null
    const hadLSupply=typeof L!=="undefined"&&Object.prototype.hasOwnProperty.call(L,"supply")
    const savedLSupply=typeof L!=="undefined"?L.supply:undefined
    try{
        if(exact&&typeof check_supply==="function")check_supply()
        for(const hqId of hqs){
            const hq=pieces[hqId],range=Math.max(0,Number(hq.cr)||0),supply=Number(hq.supply)||0
            if(exact)mark_activation_zone(hqId)
            let count=0
            for(let id=1;id<pieces.length;id++){
                const u=pieces[id],loc=G.location[id]
                if(!u||u.faction!==mine||u.class==="hq"||!Number.isFinite(loc))continue
                if(classes[u.class]===false)continue
                if(typeof LAST_BOARD_HEX!=="undefined"&&loc>LAST_BOARD_HEX)continue
                if(supply&&Number(u.supply)&&!(Number(u.supply)&supply))continue
                if(G.oos&&set_has(G.oos,id)&&card!==cards[GENERAL_ADACHI])continue
                if(exact?!!(G.supply_cache[loc]&HEX_TEMP_FLAG3):get_distance(G.location[hqId],loc)<=range)count++
            }
            if(count>best)best=count
        }
    }finally{
        if(savedCache)G.supply_cache=savedCache
        if(typeof L!=="undefined"){
            if(hadLSupply)L.supply=savedLSupply
            else delete L.supply
        }
    }
    return best
}

// 第4/10页共用卡牌分类器。只读取己方手牌；allowed 是引擎对当前
// 状态计算出的可用方式。牌面限定 HQ 也是“受限军事事件”，不能只检查
// 回调字段，否则会把限定舰队/HQ 的牌误列进无限制军事事件池。
function classifyCards(ownHand, role) {
    const mine = esm_role_faction(role)
    const ownRivalry = !!(G.inter_service && G.inter_service[mine])
    const foeRivalry = !!(G.inter_service && G.inter_service[1-mine])
    return (ownHand || []).map(id => {
        const card = cards[id] || {}
        let allowed=[]
        try { allowed=get_allowed_actions(id)||[] } catch(e) { allowed=[] }
        const military=card.type===MILITARY
        const restricted=military && (!!card.before_unit_activation || !!card.before_commit_offensive ||
            (Array.isArray(card.hq)&&card.hq.length>0))
        const eventActivationCapacity=military?esm_card_activation_capacity(card,role,true):null
        const opsActivationCapacity=esm_card_activation_capacity(card,role,false)
        // 开局占领战至少要求能启动两个单位；仅一单位的军事攻势既无法组成
        // 地面+护航，也无法落实格外航空/航母支援，留作 OC/FO 比空耗 EC 合理。
        const openingMin=role==="Japan"&&Number(G.turn)===2?2:1
        const eventHasForce=eventActivationCapacity===null||eventActivationCapacity>=openingMin
        const opsHasForce=opsActivationCapacity===null||opsActivationCapacity>=openingMin
        const activationClasses=esm_card_activation_classes(card)
        const supportsGround=activationClasses.ground,supportsNaval=activationClasses.naval
        const southIds=[]
        if(typeof HQ_JP_SOUTH!=="undefined")southIds.push(HQ_JP_SOUTH)
        if(typeof HQ_SOUTH_SEAS!=="undefined")southIds.push(HQ_SOUTH_SEAS)
        const openingHqCompatible=!Array.isArray(card.hq)||!card.hq.length||card.hq.some(id=>southIds.includes(id))
        const openingOccupationCompatible=openingHqCompatible&&supportsGround&&supportsNaval
        const name=String(card.name||"")
        let eventRank=50
        if (card.wie) eventRank=1
        else if (/replacement|reinforcement/i.test(name)) eventRank=2
        else if (ownRivalry && card.isr_agreement) eventRank=3
        else if (!foeRivalry && card.isr_rivalry) eventRank=4
        else if (card.china) eventRank=5
        const reinforcementBonus=!!(card.reinforcements||card.replacements||/reinforcement|replacement/i.test(name))
        const otherBonus=!!(card.draw||card.logistic_alt||card.bonus)
        return {id,name,type:card.type,ops:Number(card.ops)||0,lv:Number(card.logistic)||0,
            military,restricted,unrestricted:military&&!restricted,allowed,
            eventPlayable:allowed.includes("event")&&eventHasForce,
            opsPlayable:allowed.includes("ops")&&opsHasForce,
            eventActivationCapacity,opsActivationCapacity,
            supportsGround,supportsNaval,openingOccupationCompatible,
            futurePlayable:G.turn!==12&&allowed.includes("future_offensive"),eventRank,
            reinforcementBonus,otherBonus}
    })
}

// ---- C: 事件战略顺序化 ------------------------------------------------------
// 把已钉早期事件清单(JP 8 行 / AL 6 行)逐行译成“手牌/引擎状态”条件, 按清单顺序取
// 首个可执行行:
//   • 结束己方ISR(JP 行2 / AL 行2 前半) — 己方 ISR 激活时, 取【己方阵营】ISR 和解牌
//     (isr_agreement; 引擎 default_event 按 card.faction 清除该方 ISR);
//   • 造成敌方ISR(JP 行3 / AL 行3)         — 敌方尚未 ISR 时, 取【己方阵营】ISR 竞争牌
//     (isr_rivalry; 引擎 default_event 对 1-faction 施加竞争);
//   • 点名事件牌: 东京玫瑰 / 杜立特空袭 / 巴丹行军 / 天气牌(JP 行4,6 / AL 行4,5);
//   • 其余行(欧战正负 / 补员牌 / 东条1OC / FOQ / 其他放牌): 引擎无可稳定判定的执行信号,
//     顺延该行 —— 通用选牌(esm_choose_card)即覆盖“其他放牌/补员”等兜底。
// 命中行的意图子集内选最小 OV(事件意图下保住大 OC 牌)。确定性: 只读引擎当前状态
// (G.inter_service) 与牌面 meta, 不触碰引擎 RNG。行级条件不满足则顺延, 故为真“顺序化”。
// 全行不可行 -> null, 调方退化为现通用行为。
function esm_event_strategy_card_pick(strategy, hand) {
    if (!strategy || strategy.kind !== "EVENT" || strategy.name !== "事件战略") return null
    const list = (strategy.targets || []).map(t => String(t).replace(/^\d+\s*[.、)]?\s*/, "")).filter(Boolean)
    if (!list.length) return null
    const mine = esm_role_faction(strategy.role)
    const foe = 1 - mine
    const ownRiv = (G.inter_service && G.inter_service[mine]) === 1
    const foeRiv = (G.inter_service && G.inter_service[foe]) === 1
    const meta = c => cards[c] || {}
    const eventCapable = c => { try { return (get_allowed_actions(c) || []).includes("event") } catch (e) { return false } }
    const all = (hand || []).map(id=>({id,card:meta(id),allowed:(()=>{try{return get_allowed_actions(id)||[]}catch(e){return[]}})()}))
    const pool = all.filter(x=>x.allowed.includes("event")).map(x=>x.id)
    if (!all.length) return null
    const own = f => pool.filter(c => meta(c).faction === mine && f(meta(c)))
    const choose=(ids,intent,line,i)=>{
        if(!ids||!ids.length)return null
        const sorted=ids.slice().sort((a,b)=>(Number(meta(a).ops)||0)-(Number(meta(b).ops)||0)||a-b)
        return {action:"card",argument:sorted[0],intent,via:`${strategy.name}:清单#${i+1}「${line}」:${intent}`}
    }
    for (let i = 0; i < list.length; i++) {
        const line = list[i]
        let hit = null
        let intent="event"
        if (/欧战|欧洲战事|War in Europe/i.test(line)) {
            const ids=all.filter(x=>x.card.wie).map(x=>x.id)
            intent=Number(G.wie)>0?"event":"future_offensive"
            hit=ids.filter(id=>all.find(x=>x.id===id)?.allowed.includes(intent))
        } else if (/补员|增援|replacement|reinforcement/i.test(line)) {
            hit=pool.filter(c=>/replacement|reinforcement/i.test(String(meta(c).name||""))||meta(c).replacements||meta(c).reinforcements)
        } else if (/结束.*ISR|ISR.*(?:结束|清除|消除)/.test(line)) {
            if (ownRiv) hit = own(m => m.isr_agreement)            // 己方 ISR 激活时才值得打和解牌
            else { intent="future_offensive"; hit=all.filter(x=>x.card.faction===mine&&x.card.isr_agreement&&x.allowed.includes(intent)).map(x=>x.id) }
        } else if (/造成.*ISR|引发.*ISR/.test(line)) {
            if (!foeRiv) hit = own(m => m.isr_rivalry)             // 敌方已 ISR 则重复施加无效
        } else if (/东京玫瑰|Tokyo Rose/i.test(line)) {
            hit = pool.filter(c => /tokyo rose/i.test(meta(c).name))
        } else if (/杜立特|Doolittle Raid/i.test(line)) {
            hit = pool.filter(c => /^doolittle raid$/i.test(meta(c).name))
        } else if (/巴丹|Bataan|Battan/i.test(line)) {
            hit = pool.filter(c => /battan death march|bataan death march/i.test(meta(c).name))
        } else if (/天气|weather/i.test(line)) {
            const wx=all.filter(x=>/^weather$/i.test(x.card.name||""))
            intent="future_offensive";hit=wx.filter(x=>x.allowed.includes(intent)).map(x=>x.id)
        } else if (/东条.*1OC/i.test(line)) {
            const tj=all.filter(x=>/tojo/i.test(x.card.name||"")); intent="ops"; hit=tj.filter(x=>x.allowed.includes(intent)).map(x=>x.id)
        } else if (/其他.*(?:未来攻势|FOQ)|其他放牌/i.test(line)) {
            intent="future_offensive";hit=all.filter(x=>x.allowed.includes(intent)).map(x=>x.id)
        } else {
            hit = null
        }
        if (!hit || !hit.length) continue
        const picked=choose(hit,intent,line,i)
        strategy.cardIntent=intent;strategy.selectedCard=picked.argument;strategy.cardTreeNode=strategy.role==="Japan"?"JP04-S-EVENT":"AP10-S-EVENT"
        return picked
    }
    return null
}

// 选行动窗("C{idx}: Select action."): 按已钉战略选 ops/event 等。
function esm_card_action_window_action(strategy, view, context) {
    const legal = Object.keys(view.actions || {}).filter(a => { const v = view.actions[a]; return Array.isArray(v) ? v.length > 0 : Boolean(v) })
    if (strategy.cardIntent && legal.includes(strategy.cardIntent)) {
        const intent = strategy.cardIntent
        strategy.cardIntent = null
        return { action: intent, argument: undefined, via: `${strategy.cardTreeNode || strategy.name}:${intent}` }
    }
    const wantEvent = strategy.kind === "EVENT"
    const wantOps = strategy.kind === "CONQUEST" || strategy.kind === "ABSTRACT"
        || strategy.kind === "GARRISON" || strategy.kind === "DEFEND"
    if (wantOps && legal.includes("ops")) return { action: "ops", argument: undefined, via: strategy.name + ":ops" }
    if (wantEvent && legal.includes("event")) return { action: "event", argument: undefined, via: strategy.name + ":event" }
    // 所选牌的受限事件/OC不可用时，按第4/10页的其余合法用途继续；
    // 第12回合禁止设置未来攻势。
    if (G.turn !== 12 && legal.includes("future_offensive")) return {action:"future_offensive",argument:undefined,via:strategy.name+":future-offensive"}
    for (const action of ["inter_service","china_offensive","jarhat","imphal","ledo","return_hq","displace_hq","discard"])
        if (legal.includes(action)) return {action,argument:undefined,via:strategy.name+":"+action}
    return null
}

// D4: 原子弹胜利 —— 手牌含"苏联入侵满洲"(AP#79)且可作事件时, 优先事件打出(触发 esm_atomic_met
// 的苏联条件); 否则返回 null 让调用方走 OPS 攻势。
function esm_atomic_event_pick(strategy, hand) {
    if (!strategy || strategy.kind !== "ABSTRACT" || strategy.name !== "原子弹胜利") return null
    if (typeof SOVIET_INVADE === "undefined" || !hand || hand.indexOf(SOVIET_INVADE) === -1) return null
    const allowed = (() => { try { return get_allowed_actions(SOVIET_INVADE) } catch (e) { return null } })()
    if (allowed && allowed.indexOf("event") !== -1) {
        return { action: "card", argument: SOVIET_INVADE, via: strategy.name + ":soviet" }
    }
    return null
}

// 对外 trace: 供 erasmus.js publicTrace 附加
function esm_trace_of(strategy, privateDetails) {
    if (!strategy) return null
    const goalKinds = (strategy.goals || []).map(g => g.kind)
    let diag = strategy.ctx && strategy.ctx._diag ? JSON.parse(JSON.stringify(strategy.ctx._diag)) : undefined
    if (diag && diag.atomic && !privateDetails) {
        delete diag.atomic.sovietInHand
        delete diag.atomic.sovietPlayable
        delete diag.atomic.sovietReady
        delete diag.atomic.met
    }
    return { axis: strategy.role + "/" + strategy.phase + "/" + strategy.name, kind: strategy.kind, phase: strategy.phase,
        strategy: strategy.name, chainHead: strategy.chain[0] !== undefined ? strategy.chain[0] : null,
        focus: eop_focus(strategy.role), chainLen: strategy.chain.length,
        priorityTargets: esm_strategy_targets(strategy),
        goals: goalKinds.length ? goalKinds : undefined,
        ...(strategy.powEmergency ? { powEmergency: strategy.powEmergency } : {}),
        ...(strategy.openingSurrenderPlan ? { openingSurrenderPlan: strategy.openingSurrenderPlan } : {}),
        ...(strategy.progressPlan ? { progressPlan: strategy.progressPlan } : {}),
        ...(strategy.victoryPreparation ? { victoryPreparation: strategy.victoryPreparation } : {}),
        ...(strategy.eventPhase ? { eventPhase: strategy.eventPhase } : {}),
        ...(diag ? { diag } : {}) }
}

// ===========================================================================
// CDSS「增援或补员阶段」落位 (顺序 L157-187) —— zh.7 补全
// 此前增援/补员落位走通用 action_hex/unit 散打(就近焦点或随机散打), 未实现 CDSS
// 优先级, 是盟军迟迟无法集中兵力/把 B29 摆进轰炸基地的主因之一。核心原则(L159):
// 单位"尽可能靠近敌人"; 指挥部有指定母港; B29 有专门基地规则(L187)。
// 本区只读引擎状态(G/pieces/map), 不触碰 RNG, 纯确定性打分。
// ===========================================================================

// 增援/补员窗口识别 -> "reinf"(增援落位) | "repl_unit"(选补员单位) | "repl_place"(补员落位) | null
function esm_reinf_window(view) {
    const p = String((view && view.prompt) || "")
    if (/as a reinforcement/i.test(p)) return "reinf"
    if (/choose unit to reinforce/i.test(p)) return "repl_unit"
    if (/choose hex to place/i.test(p)) return "repl_place"
    return null
}

// 一次性收集"敌方单位落点"(地面/任意), 供就近打分; for_each_unit_on_map 不可用时回空。
function esm_enemy_locs(faction) {
    const enemy = 1 - faction
    const ground = [], any = []
    try {
        for_each_unit_on_map((u, piece, loc) => {
            if (piece.faction === enemy) {
                any.push(loc)
                if (piece.class === "ground") ground.push(loc)
            }
        })
    } catch (e) { /* 引擎未提供该迭代器时退化为无敌方信息 */ }
    return { ground, any }
}

function esm_min_dist(hex, locs) {
    let best = 999
    for (let i = 0; i < locs.length; i++) {
        const d = get_distance(hex, locs[i])
        if (d < best) best = d
    }
    return best
}

// 在 candidates 内取 scoreFn 最小者(并列取小 hex), 无候选回 undefined。
function esm_pick_nearest(candidates, scoreFn) {
    let best = null, bestS = Infinity
    for (let i = 0; i < candidates.length; i++) {
        const h = candidates[i]
        const s = scoreFn(h)
        if (s < bestS || (s === bestS && (best === null || h < best))) { bestS = s; best = h }
    }
    return best
}

// 盟军指挥部 CDSS 母港(L179): SWPac->澳大利亚, CPac->瓦胡岛, ANZAC->莫尔兹比港/澳,
// SPac( Ghormley/Halsey )->新几内亚/肯达里/努美阿, SEAC->加尔各答。日军回 null(用最近东京)。
// 马来亚/ABDA 不在此列(notreplaceable 原地)。
function esm_hq_home(piece) {
    const homes = {
        hq_ap_c: ["Oahu"],
        hq_ap_sw: ["Townsville", "Darwin"],            // 澳大利亚(东北澳港)
        hq_ap_sg: ["Port Moresby", "Kendari"],         // 南太平洋(新几内亚/肯达里)
        hq_ap_sh: ["Port Moresby", "Kendari"],
        hq_ap_anzac: ["Port Moresby", "Townsville"],   // 莫尔兹比港/澳大利亚
        hq_ap_seac: ["Calcutta"],
    }
    const names = homes[piece.id]
    if (!names) return null
    for (let i = 0; i < names.length; i++) {
        const idx = eop_resolve_token(names[i])
        if (idx !== null) return idx
    }
    return null
}

// CDSS 落位打分: 对候选格 h 给越小越优的分值。
function esm_placement_score(h, piece, enemy) {
    const md = get_map_data(h)
    const isPort = !!(md && md.port)
    const isAirfield = !!(md && md.airfield)
    if (piece.class === "ground") {
        // L171/184: 地面 -> 离敌人(地面)最近的港口(候选已被引擎滤成港口)。
        const d = enemy.ground.length ? esm_min_dist(h, enemy.ground) : (enemy.any.length ? esm_min_dist(h, enemy.any) : 0)
        return (isPort ? 0 : 50) * 1000 + d * 10
    }
    if (piece.class === "air") {
        // L169/183: 空中 -> 离敌 AZOI(用离敌任意单位近似)最近的港口, 后机场。
        const d = enemy.any.length ? esm_min_dist(h, enemy.any) : 0
        return (isPort ? 0 : isAirfield ? 1 : 50) * 1000 + d * 10
    }
    if (piece.class === "naval") {
        // L182: 海军 -> 港口, 靠近指挥部(用离敌最近近似 = 前线)。
        const d = enemy.any.length ? esm_min_dist(h, enemy.any) : 0
        return (isPort ? 0 : 50) * 1000 + d * 10
    }
    const d = enemy.any.length ? esm_min_dist(h, enemy.any) : 0
    return d * 10
}

// CDSS 增援/补员落位入口: 在 candidates(引擎已滤成合法落点)内挑 CDSS 优先级最优者。
function esm_pick_placement(candidates, role, unit, piece) {
    if (!Array.isArray(candidates) || !candidates.length) return undefined
    if (!piece) return esm_pick_nearest(candidates, h => h)   // 无单位信息: 回最小 hex(稳定)
    const faction = piece.faction === JP ? JP : AP

    // B29 (盟军优先#5 / L187): 距东京<=8 港口/机场 -> 中国盒 -> 最近东京港口/机场。
    if (piece.b29) {
        return esm_pick_nearest(candidates, h => {
            if (h === CHINA_BOX) return 100
            const md = get_map_data(h)
            const base = !!(md && (md.airfield || md.port))
            const d = get_distance(h, TOKYO)
            if (base && d <= 8) return d          // 最优: 距东京<=8 基地
            if (base) return 200 + d               // 次优: 最近基地
            return 400 + d                         // 兜底: 无基地
        })
    }

    // 指挥部: 盟军 -> 指定母港; 日军 -> 最近东京(初始位置近似)。
    if (piece.class === "hq") {
        const home = esm_hq_home(piece)
        const ref = home !== null ? home : TOKYO
        return esm_pick_nearest(candidates, h => get_distance(h, ref))
    }

    const enemy = esm_enemy_locs(faction)
    return esm_pick_nearest(candidates, h => esm_placement_score(h, piece, enemy))
}

// CDSS 补员选择(L161,185-186): 优先恢复被消灭部队(放回地图), 再翻正减损; 同类选最强战力。
function esm_pick_replacement_unit(candidates, role) {
    if (!Array.isArray(candidates) || !candidates.length) return undefined
    const cf = u => { try { const p = pieces[u]; return Number((p && (p.cf || p.lf || p.rcf)) || 0) } catch (e) { return 0 } }
    const isElim = u => { try { return G.location[u] === ELIMINATED_BOX } catch (e) { return false } }
    const isReduced = u => { try { return set_has(G.reduced, u) } catch (e) { return false } }
    const score = u => {
        const cat = isElim(u) ? 0 : isReduced(u) ? 1 : 2
        return cat * 100000 - cf(u) * 100 + u   // 类别优先; 同类内战力高(负号→大到小), u 作稳定 tie
    }
    return candidates.slice().sort((a, b) => score(a) - score(b))[0]
}
