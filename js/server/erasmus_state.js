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

// ---- 策略 kind ------------------------------------------------------------
// CONQUEST: 有序夺控目标链（喂 eop 焦点层）; EVENT: 事件战略(选事件牌);
// PASS: 本回合跳; GARRISON/DEFEND: v1 有界近似(按 EVENT 微执行, trace 标注);
// ABSTRACT: 抽象目标(B29/原子弹) -> 无链，按 EVENT/默认轴微执行; 特殊标记在 notes。

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
    const g = { portsWithin8Tokyo: [], airfieldsWithin5: [], deiPorts: [], ngPorts: [], resourceHexes: [], allNamed: {} }
    const isDEI = r => r === "DEI" || r === "Java" || r === "Sumatra" || r === "Borneo" || r === "Celebes"
    for (let i = 0; i <= LAST_BOARD_HEX; i++) {
        const md = get_map_data(i)
        if (!md) continue
        if (md.resource) g.resourceHexes.push(i)
        if (md.port) {
            if (md.region === "Philippines") { /* no op */ }
            if (isDEI(md.region)) g.deiPorts.push(i)
            if (md.region === "Guinea") g.ngPorts.push(i)
            if (md.region !== "China" && get_distance(i, TOKYO) <= 8) g.portsWithin8Tokyo.push(i)
        }
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
function esm_lock(seed) {
    const k = esm_key(seed)
    let e = ESM_LOCKED[k]
    if (!e) { e = { turn: G.turn, role: { Japan: null, Allies: null }, seenOrd: 0, bombFail: false, lastOrdTurn: 0 }; ESM_LOCKED[k] = e }
    // 新对局检测: 回合回退 或 actionOrdinal 回退(多局同进程防串台)。
    if ((G.turn < e.turn && e.turn > 0) || (arguments[1] !== undefined && arguments[1] < e.seenOrd && e.seenOrd > 0)) {
        delete ESM_LOCKED[k]
        e = { turn: G.turn, role: { Japan: null, Allies: null }, seenOrd: arguments[1] || 0, bombFail: false, lastOrdTurn: 0 }
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
    try { return cards[SOVIET_INVADE].can_play() === true } catch (e) { return false }
}

// ===========================================================================
// 决策树自检用纯 ctx 版: 与 py 分支逐字一致(boolean 输入 -> 策略名)
// 供保真自测: 同 ctx 应得同策略名。
// ===========================================================================
function esm_d10_of(seedText) { return erasmus_hash(seedText) % 10 }

// JP 早期 (页1) —— 逐字: py evaluate_early
function esm_jp_eval_early(ctx, d10) {
    const t = () => typeof d10 === "number" ? d10 : esm_d10_of(ctx._seed + ":jp-early")
    if (ctx.jp_A) {
        if (ctx.cards_in_hand >= 3) {
            if (ctx.jp_D_res_lt_13) return "激进的空优战略"
            if (ctx.current_turn >= 3) {
                if (ctx.jp_F_logistics_ge_20) {
                    // E = Res>=13 (D false)
                    return "中太平洋战略"            // py 里 E 分支(Res>=13) 先判 F 后未再判 D
                }
                if ((ctx.jp_H_logistics_le_19 || ctx.jp_I_azoi_covers_dei_ports) && ctx.jp_J_controls_rabaul_guadalcanal) return "中太平洋战略"
                if (ctx.jp_M_perimeter_target_1_complete) return "马绍尔防御"
                return "外围防御战略"
            }
            return "外围防御战略"
        }
        return "激进的南方资源战略"
    }
    if (ctx.jp_B_dei_surrender_hexes_occupied) return "保守的空优战略"
    if (ctx.cards_in_hand >= 3 && ctx.jp_L_mal_phil_dei_not_conquered) {
        const roll = t()
        if (roll <= 2) return "事件战略"
        if (roll <= 6) return "激进的南方资源战略"
        return "外围防御战略"
    }
    return "事件战略"
}
// 保留 py 分支全量字段——以别名封装, 保持与 py 逐字可读
function esm_jp_eval_early_py(ctx, d10) {
    // 别名映射 只用真字段, 实现见上 esm_jp_eval_early
    return esm_jp_eval_early(ctx, d10)
}

// JP 中期 (页2) —— py evaluate_mid
function esm_jp_eval_mid(ctx, d10) {
    if (ctx.cards_in_hand < 3) {
        if (ctx.can_pass) return "PASS"
        return "事件战略"
    }
    if (ctx.jp_D_res_lt_13) return "资源战略"
    if (ctx.jp_F_logistics_ge_20) {
        if (ctx.jp_E_us_will_lt_4) return "中太平洋战略"
        if (ctx.jp_F_burma_surrendered) {
            if ((ctx.jp_H_has_gandhi || ctx.jp_I_more_steps_in_burma) && ctx.jp_J_logistics_ge_18) return "印度战略"
            return "外围防御战略"
        }
        return "中缅印战略"
    }
    if (ctx.jp_G_logistics_ge_15) {
        if (ctx.jp_F_burma_surrendered) {
            if ((ctx.jp_H_has_gandhi || ctx.jp_I_more_steps_in_burma) && ctx.jp_J_logistics_ge_18) return "印度战略"
            return "外围防御战略"
        }
        return "中缅印战略"
    }
    return "外围防御战略"
}

// JP 晚期 (页3) —— py evaluate_late
function esm_jp_eval_late(ctx, d10) {
    if (ctx.cards_in_hand < 3) return "事件战略"
    if (ctx.jp_L_B_garrisons_within_8 && ctx.jp_L_C_airfields_within_5) return "最终国防圈战略"
    if (ctx.can_pass) return "PASS"
    if (ctx.jp_L_E_allied_on_honshu) return "最终防御战略"
    return "事件战略"
}

// AL 早期 (页7) —— py evaluate_early
function esm_al_eval_early(ctx, d10) {
    if (ctx.cards_in_hand < 3) return "事件战略"
    if (!ctx.al_B_hq_supplied_phil) return "撤离菲律宾"
    if (!ctx.al_C_hq_supplied_malaya) return "撤离马来亚"
    if (!ctx.al_D_arcadia_played) return "建立ABDA"
    if (!ctx.al_E_cbi_def_established) return "增强CBI防御"
    if (ctx.al_F_has_passes && ctx.al_G_only_1_card_left) return "PASS"
    if (ctx.al_J_phil_not_surrendered && ctx.al_K_service_agreement && ctx.al_L_has_2_carriers && ctx.al_M_us_corps_near_carrier && ctx.al_N_aus_no_jp_ground) return "橙色计划"
    if (ctx.al_O_dei_not_surrendered && ctx.al_P_abda_hq_supplied) return "DEI防御"
    return "攻势进攻"
}

// AL 中期 (页8) —— py evaluate_mid
function esm_al_eval_mid(ctx, d10) {
    const t = () => typeof d10 === "number" ? d10 : esm_d10_of(ctx._seed + ":al-mid")
    if (ctx.can_pass) return "PASS"
    if (ctx.al_M_B_needs_war_progress) {
        if (ctx.cards_in_hand >= 3 && ctx.al_M_D_jp_controls_counterattack_target) return "反攻战略"
    }
    if (ctx.cards_in_hand < 3) return "事件战略"
    const roll = t()
    if (roll <= 4) return "南太平洋战略"
    if (roll <= 7) return "中太平洋战略"
    if (roll === 8) return "DEI战略"
    return "CBI战略"
}

// AL 晚期 (页9) —— py evaluate_late
function esm_al_eval_late(ctx, d10) {
    const t = () => typeof d10 === "number" ? d10 : esm_d10_of(ctx._seed + ":al-late")
    if (ctx.can_pass) return "PASS"
    if (ctx.al_L_B_is_turn_12 && ctx.cards_in_hand < 3) return "事件战略"
    if (!ctx.al_L_D_has_strategic_bombing_base) return "占领轰炸基地"
    if (!ctx.al_L_E_all_b29_on_base) return "推进B29"
    if (!ctx.al_L_F_controls_hex_within_8_tokyo) {
        const roll = t()
        if (roll <= 2) return "重返菲律宾"
        if (roll <= 5) return "跳岛作战"
        return "轮流战略"
    }
    if (ctx.al_L_G_meets_atomic_bomb_criteria) return "原子弹胜利"
    return "登陆日本"
}

// ===========================================================================
// 引擎真实状态 -> ctx 布尔
// ===========================================================================
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
        ctx.jp_E_us_will_lt_4 = (G.wie !== undefined ? G.wie : 8) < 4
        ctx.jp_F_burma_surrendered = (typeof nations !== "undefined") ? surr(nations.BURMA.id) : false
        ctx.jp_G_logistics_ge_15 = logistics >= 15
        ctx.jp_H_has_gandhi = (() => {
            try { return set_has(G.hand[JP], find_card(JP, 15)) || set_has(G.hand[JP], find_card(JP, 21)) } catch (e) { return false }
        })()
        ctx.jp_I_more_steps_in_burma = esm_count_ground(JP, r => r === "Burma") > esm_count_ground(AP, r => r === "Burma")
        ctx.jp_J_logistics_ge_18 = logistics >= 18
        // 晚期
        ctx.jp_L_B_garrisons_within_8 = esm_geo().portsWithin8Tokyo.every(h => is_space_controlled(h, JP))
        ctx.jp_L_C_airfields_within_5 = esm_geo().airfieldsWithin5.every(h => is_space_controlled(h, JP))
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
        ctx.al_E_cbi_def_established = (() => {
            // 近似: SEAC 在位(非补给场) 且 缅甸有盟军地面单位(防御已就位)。trace 标注近似。
            try {
                const seac = G.location[HQ_SEAC]
                return (seac >= 0 && seac <= LAST_BOARD_HEX) && esm_count_ground(AP, r => r === "Burma") > 0
            } catch (e) { return false }
        })()
        ctx.al_F_has_passes = ctx.can_pass
        ctx.al_G_only_1_card_left = ctx.cards_in_hand <= 1
        ctx.al_J_phil_not_surrendered = (typeof nations !== "undefined") ? !surr(nations.PHILIPPINES.id) : true
        ctx.al_K_service_agreement = !(G.inter_service && G.inter_service[AP] === 1)
        ctx.al_L_has_2_carriers = esm_count_carriers(AP) >= 2
        ctx.al_M_us_corps_near_carrier = (() => {
            // 页7: 1支航母与 1支美陆军军堆叠在己方控菲律宾港口 15 格内(近似, 距离 15)
            try {
                const cars = []
                for (let u = 1; u < pieces.length; u++) { const p = pieces[u]; const loc = G.location[u]; if (p.class === "naval" && p.br && p.faction === AP && loc >= 0 && loc <= LAST_BOARD_HEX) cars.push(loc) }
                if (!cars.length) return false
                for (let u = 1; u < pieces.length; u++) { const p = pieces[u]; const loc = G.location[u]; if (p.faction !== AP || p.class !== "ground" || !(loc >= 0 && loc <= LAST_BOARD_HEX)) continue; for (const c of cars) { if (get_distance(loc, c) <= 15) return true } }
                return false
            } catch (e) { return false }
        })()
        ctx.al_N_aus_no_jp_ground = esm_count_ground(JP, r => r === "Australia") === 0
        ctx.al_O_dei_not_surrendered = (typeof nations !== "undefined") ? !surr(nations.DEI.id) : true
        ctx.al_P_abda_hq_supplied = (() => { const loc = G.location[HQ_ABDA]; return (loc >= 0 && loc <= LAST_BOARD_HEX) && !(G.oos && set_has(G.oos, HQ_ABDA)) })()
        // 中期
        ctx.al_M_B_needs_war_progress = !!G.pow
        ctx.al_M_D_jp_controls_counterattack_target = (() => {
            const list = ["Midway", "Dutch Harbor", "Dacca", "Dimasur", "Jarhat", "Ledo", "Imphal", "Guadalcanal", "Attu", "Port Moresby", "Gili-Gili", "Espiritu Santo"]
            try { return list.some(t => { const h = esm_idx(t); return h != null && is_space_controlled(h, JP) }) } catch (e) { return true }
        })()
        // 晚期
        ctx.al_L_B_is_turn_12 = G.turn === 12
        ctx.al_L_D_has_strategic_bombing_base = (() => {
            try { return esm_geo().portsWithin8Tokyo.some(h => is_space_controlled(h, AP) && get_map_data(h).airfield) } catch (e) { return false }
        })()
        ctx.al_L_E_all_b29_on_base = (() => {
            try {
                const onBase = u => { const loc = G.location[u]; return (loc >= 0 && loc <= LAST_BOARD_HEX && is_space_controlled(loc, AP) && get_map_data(loc).airfield && get_distance(loc, TOKYO) <= 8) || loc === CHINA_BOX }
                // 两机均未被替换(重锤标记按 piece.b29=0/1 分位); 当回合"已投弹"不作为基地判据。
                const replacedAll = !!(G.b29u & B29_REPLACED) || !!(G.b29u & (B29_REPLACED << 1))
                return !replacedAll && onBase(B_29_1) && onBase(B_29_2)
            } catch (e) { return false }
        })()
        ctx.al_L_F_controls_hex_within_8_tokyo = (() => {
            try { return esm_geo().portsWithin8Tokyo.some(h => is_space_controlled(h, AP)) } catch (e) { return false }
        })()
        ctx.al_L_G_meets_atomic_bomb_criteria = esm_atomic_met(lock)
    }
    return ctx
}

// 原子弹判据(口径=图表 09 + 脚注[7] + 规则 16): 逐字三条件。
function esm_atomic_met(lock) {
    try {
        // 1. 无战略轰炸失败: 引擎侧凡"轰炸失败/无单位可炸"都把 STRAT_BOMBING_CAMPAIGN 置 0。
        //    本模块逐回合记录: 观察到置 0 即记一次失败(lock.bombFail)。无失败 = 记录为空。
        if (lock && lock.bombFail) return false
        // 2. 苏联入侵满洲已发生 或 盟军持有且能作事件打出。
        const soviet = esm_soviet_occurred() || esm_soviet_playable()
        if (!soviet) return false
        // 3. 日本控资源格 <= (已打苏联? 3 : 5)
        const jpRes = get_jp_resources()
        return jpRes <= (esm_soviet_occurred() ? 3 : 5)
    } catch (e) { return false }
}

// ===========================================================================
// 策略表(转录 py L169-513; 每项含说明行/notes/可解析目标 token)
// kind: CONQUEST/EVENT/PASS/GARRISON/DEFEND/ABSTRACT
// ===========================================================================
const ESM_STRATEGY = (name, kind, tokens, notes) => ({ name, kind, tokens, notes })

const ESM_JP_LIB = {
    early: {
        "激进的空优战略": ESM_STRATEGY("激进的空优战略", "CONQUEST", ["Jolo", "Makassar", "Teloekbetoeng", "Bandjermasin"], ["压制东印度空优", "攻击覆盖目标的敌方 AZOI 单位(见 py 注4/7)"]),
        "保守的空优战略": ESM_STRATEGY("保守的空优战略", "CONQUEST", ["Jolo", "Makassar", "Teloekbetoeng", "Bandjermasin"], ["压制盟军 HQ(菲律宾/新加坡/ABDA), 再压制东印度"]),
        "激进的南方资源战略": ESM_STRATEGY("激进的南方资源战略", "CONQUEST", ["Balikpapan", "Tarakan", "Batavia", "Tjilatjap", "Soerabaja", "Bangka", "Palembang", "Medan", "Kuantan", "Singapore", "Manila", "Davao"], ["东印度->马来亚->菲律宾投降顺序"]),
        "保守的南方资源战略": ESM_STRATEGY("保守的南方资源战略", "CONQUEST", ["Jolo", "Makassar", "Teloekbetoeng", "Bandjermasin", "Kuantan", "Singapore", "Manila", "Davao"], ["压制东印度后马来亚/菲律宾投降"]),
        "中缅印战略": ESM_STRATEGY("中缅印战略 (CBI)", "CONQUEST", ["Rangoon", "Mandalay", "Lashio", "Myitkyina"], ["缅甸投降链; 中国投降(Lashio/攻势/事件)"]),
        "中太平洋战略": ESM_STRATEGY("中太平洋战略", "CONQUEST", ["Rabaul", "Attu", "Kiska", "Wake", "Tarawa", "Midway"], ["拉包尔(若被盟军控)->阿图/吉斯卡->马绍尔防御->中途岛"]),
        "马绍尔防御": ESM_STRATEGY("马绍尔防御", "CONQUEST", ["Wake", "Tarawa"], ["补全键(页1 M 出口)"]),
        "外围防御战略": ESM_STRATEGY("外围防御战略", "CONQUEST", ["Sarong", "Vogelkop", "Biak", "Guadalcanal", "Port Moresby", "Hollandia", "Lae", "Buna", "Wewak", "Gili-Gili"], ["澳洲委任统治地/新几内亚防御"]),
        "事件战略": ESM_STRATEGY("事件战略", "EVENT", [], ["欧战/ISR/东京玫瑰/补员/天气/东条1OC/放牌(页1 事件战略)"]),
    },
    mid: {
        "资源战略": ESM_STRATEGY("资源战略", "CONQUEST", ["Seoul", "Manila", "Kuantan", "Balikpapan", "Tarakan", "Batavia", "Tjilatjap", "Soerabaja", "Palembang", "Medan", "Rangoon", "Mandalay", "Lashio", "Myitkyina"], ["占资源至>=13; 新几内亚16目标; 缅甸/中国; 加强港口"]),
        "中太平洋战略": ESM_STRATEGY("中太平洋战略", "CONQUEST", ["Attu", "Kiska", "Wake", "Midway"], ["阿图->威克->中途岛->攻击美国舰队"]),
        "中缅印战略": ESM_STRATEGY("中缅印战略 (CBI)", "CONQUEST", ["Rangoon", "Mandalay", "Lashio", "Myitkyina", "Akyab", "Imphal", "Dimasur", "Jarhat", "Ledo", "Dacca"], ["缅甸投降->加强港口->印度投降->事件战略"]),
        "印度战略": ESM_STRATEGY("印度战略", "CONQUEST", ["Akyab", "Imphal", "Dimasur", "Jarhat", "Ledo", "Dacca"], ["印度投降链; 中国; 加强港口"]),
        "外围防御战略": ESM_STRATEGY("外围防御战略", "CONQUEST", ["Biak", "Vogelkop", "Hollandia", "Lae", "Buna", "Buin", "Gili-Gili", "Port Moresby"], ["南太平洋侧翼; 用 AZOI 覆盖后转移"]),
        "事件战略": ESM_STRATEGY("事件战略", "EVENT", [], ["同早期阶段事件战略"]),
        "PASS": ESM_STRATEGY("PASS", "PASS", [], ["跳过本回合行动"]),
    },
    late: {
        "最终国防圈战略": ESM_STRATEGY("最终国防圈战略", "GARRISON", ["Okinawa", "Seoul", "Pusan", "Tainan", "Saipan", "Iwo Jima", "Kyoto", "Sasebo", "Kure", "Tokyo", "Osaka", "Nagoya", "Ominato", "Hakodate"], ["港口驻军: Okinawa/Seoul/Pusan/Tainan/Saipan; 机场驻军 Iwo/Kyoto; 日本港口驻军"]),
        "最终防御战略": ESM_STRATEGY("最终防御战略", "DEFEND", [], ["集结部队; 海空支援; 板载冲锋(v1 近似: 事件微执行)"]),
        "事件战略": ESM_STRATEGY("事件战略", "EVENT", [], ["同早期阶段事件战略"]),
        "PASS": ESM_STRATEGY("PASS", "PASS", [], ["跳过本回合行动"]),
    },
}

const ESM_AL_LIB = {
    early: {
        "撤离菲律宾": ESM_STRATEGY("撤离菲律宾", "EVENT", [], ["P旅->Biak; R军->Kendari; [SL]军->Manila; FEAF->Manila; 19LRB->Timor(已就位视为完成; v1近似事件微执行)"]),
        "撤离马来亚": ESM_STRATEGY("撤离马来亚", "EVENT", [], ["8 Aus->Kendari; MA Air->Palembang"]),
        "建立ABDA": ESM_STRATEGY("建立 ABDA 指挥部", "EVENT", [], ["放置 ABDA HQ 到 Tjilatjap/Kendari/Balikpapan/Soerabaja/Tarakan"]),
        "增强CBI防御": ESM_STRATEGY("增强 CBI 防御", "EVENT", [], ["1Ind->Rangoon; BInd->Akyab; 66/6/5集团军->Lashio/Mandalay/Myitkyina; 1Burma->Imphal"]),
        "DEI防御": ESM_STRATEGY("DEI 防御", "EVENT", [], ["派英联邦或美军前往 ABDA HQ 港口"]),
        "橙色计划": ESM_STRATEGY("橙色计划 (Plan Orange)", "CONQUEST", ["Leyte", "Manila"], ["美国军护航->莱特; 莱特已控->马尼拉"]),
        "攻势进攻": ESM_STRATEGY("攻势进攻", "EVENT", [], ["对最弱日军 1x海空攻击; 脱离航母免被灭"]),
        "事件战略": ESM_STRATEGY("事件战略", "EVENT", [], ["欧战; ISR/FOQ; 杜立特; 巴丹行军; FOQ"]),
    },
    mid: {
        "反攻战略": ESM_STRATEGY("反攻战略", "CONQUEST", ["Midway", "Dutch Harbor", "Dacca", "Dimasur", "Jarhat", "Ledo", "Imphal", "Guadalcanal", "Attu", "Kiska", "Port Moresby", "Gili-Gili", "Espiritu Santo"], ["16 反攻目标顺序(澳洲港/机场等按可达性); 多与激活点攻击日军航空兵"]),
        "南太平洋战略": ESM_STRATEGY("南太平洋战略", "CONQUEST", ["Guadalcanal", "Gili-Gili", "Port Moresby", "Buna", "Lae", "New Georgia", "Bougainville", "Rabaul", "Madang", "Wewak", "Aitape", "Admiralty Islands", "Hollandia", "Biak", "Sarong", "Vogelkop"], ["优先 ANZAC 或 SW Pac HQ"]),
        "中太平洋战略": ESM_STRATEGY("中太平洋战略", "CONQUEST", ["Wake", "Tarawa", "Kwajalein", "Eniwetok", "Palau", "Ulithi", "Saipan"], ["优先 Cen Pac HQ 其次 SW Pac HQ"]),
        "CBI战略": ESM_STRATEGY("CBI 战略", "CONQUEST", ["Dacca", "Akyab", "Dimasur", "Jarhat", "Imphal", "Ledo", "Myitkyina", "Lashio", "Mandalay", "Rangoon"], ["优先 SEAC 或联合 HQ"]),
        "DEI战略": ESM_STRATEGY("DEI 战略", "CONQUEST", ["Timor", "Kendari", "Soerabaja", "Balikpapan", "Tarakan"], ["优先 ANZAC 或 SW Pac HQ"]),
    },
    late: {
        "占领轰炸基地": ESM_STRATEGY("占领战略轰炸基地", "CONQUEST", ["Saipan", "Guam", "Marcus Island", "Iwo Jima", "Okinawa", "Tainan", "Taihoku"], ["使用最大攻势卡占领"]),
        "推进B29": ESM_STRATEGY("推进 B29", "ABSTRACT", [], ["OC 移动 B29 到战略基地; 其余激活点攻击指挥范围内日军航母/空军"]),
        "重返菲律宾": ESM_STRATEGY("重返菲律宾", "CONQUEST", ["Leyte", "Davao", 2912, "Manila"], ["先占 SW Pac HQ 距莱特 4 格基地; 莱特->达沃->2912->马尼拉; 解放 DEI/马来亚"]),
        "跳岛作战": ESM_STRATEGY("跳岛作战", "CONQUEST", ["Kwajalein", "Eniwetok", "Saipan", "Iwo Jima", "Okinawa", "Sasebo", "Tokyo", "Ominato"], ["Cen Pac; 最高优先级目标达成前不执行下一目标"]),
        "原子弹胜利": ESM_STRATEGY("原子弹胜利", "ABSTRACT", [], ["打出苏联入侵满洲; 占领剩余日本资源格"]),
        "登陆日本": ESM_STRATEGY("登陆日本", "CONQUEST", ["Sasebo", "Tokyo", "Ominato", 3606, "Nagoya", "Kyoto", "Kure", "Osaka"], []),
    },
}

function esm_lib(role) { return role === "Japan" ? ESM_JP_LIB : ESM_AL_LIB }
function esm_strategy_entry(role, phase, name) {
    return (esm_lib(role)[phase] || {})[name] || null
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
// 主入口: 每窗口调用; 首卡窗求值并钉住; 其余返回已钉战略(同回合沿用)。
// 返回 null 表示 gate 关(调方走原路径)。strategy: {name,kind,tokens,notes,phase,role,chain,axisTrace}
// ===========================================================================
function esm_pin_strategy(view, context) {
    if (!esm_gate_on()) return null
    const role = context.role
    if (role !== "Japan" && role !== "Allies") return null
    const ord = context.actionOrdinal || 0
    const lock = esm_lock(context.seed, ord)
    if (typeof context.seed !== "undefined" && context.seed !== null) lock.seenOrd = ord

    // 记录战略轰炸失败(引擎把 STRAT_BOMBING_CAMPAIGN 置 0 = 本回合无成功轰炸)。
    // 仅在“曾进入轰炸战役(lastBombActive)”后观测到置 0 才记为失败, 避免与尚未开始混淆。
    if (lock && !lock.bombFail && G.events) {
        try {
            const marker = G.events[events.STRAT_BOMBING_CAMPAIGN.id] || 0
            if (marker > 0) lock.lastBombActive = G.turn
            else if (lock.lastBombActive && G.turn > lock.lastBombActive && lock.lastBombFailCheck !== G.turn) {
                lock.lastBombFailCheck = G.turn
                if ((G.strategic_warfare || 0) > 0 || G.turn >= 10) lock.bombFail = true
            }
        } catch (e) { /* ignore */ }
    }

    const faction = esm_role_faction(role)
    const cached = lock.role[role]
    const thisIsFirstCard = esm_is_card_window(view) && (!cached || cached.turn !== G.turn)
    if (!thisIsFirstCard) {
        // 本回合已钉/或非首卡窗: 直接沿用缓存(没有则 null)。
        return (cached && cached.turn === G.turn) ? cached.strategy : null
    }

    const phase = esm_phase(role)
    const seedText = `${context.seed}:${ord}:${role}:${phase}:${G.turn}`
    const ctx = esm_build_ctx(role, lock, seedText)
    const name = esm_eval(role, phase, ctx, lock)
    const entry = esm_strategy_entry(role, phase, name) || (name === "PASS" ? ESM_STRATEGY("PASS", "PASS", [], ["跳过本回合行动"]) : null)
    let chain = []
    let strategy
    if (entry) {
        strategy = {
            name, kind: entry.kind, tokens: entry.tokens, notes: entry.notes,
            phase, role, seed: seedText, ord,
            pinnedNow: true,
            chain: [],
            ctx, d10Rolls: [],
        }
        for (const t of entry.tokens) {
            const idx = eop_resolve_token(t)
            if (idx !== null && idx >= 0 && idx <= LAST_BOARD_HEX && !strategy.chain.includes(idx)) strategy.chain.push(idx)
        }
    } else {
        strategy = { name, kind: "EVENT", tokens: [], notes: [], phase, role, ord, pinnedNow: true, chain: [], ctx, d10Rolls: [] }
    }
    lock.role[role] = { turn: G.turn, phase, strategyName: name, strategy }
    return strategy
}

// ---- 选牌/选行动窗口的行为 --------------------------------------------------
// 依据已钉战略返回 { action, argument }(未钉或非法时返回 null → 调方走原路径)。
function esm_card_window_action(strategy, view, context) {
    const legal = Object.keys(view.actions || {}).filter(a => { const v = view.actions[a]; return Array.isArray(v) ? v.length > 0 : Boolean(v) })
    const hand = Array.isArray(view.actions.card) ? view.actions.card.slice() : []
    if (!hand.length) return null
    const faction = esm_role_faction(strategy.role)
    const wantOps = strategy.kind === "CONQUEST"
    const wantEvent = strategy.kind === "EVENT" || strategy.kind === "ABSTRACT"
    if (strategy.kind === "PASS" && legal.includes("pass")) return { action: "pass", argument: undefined, via: strategy.name }
    if (strategy.kind === "GARRISON" || strategy.kind === "DEFEND") {
        // v1 有界近似: 国防圈/最终防御 -> 事件微执行(打事件/低值牌), 保留大 OC 卡。
        return esm_choose_card(hand, "event", legal, strategy)
    }
    if (wantOps) {
        const r = esm_choose_card(hand, "ops", legal, strategy)
        if (r) return r
        return esm_choose_card(hand, "event", legal, strategy) || null
    }
    if (wantEvent) {
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
    const allowedOf = c => { try { return get_allowed_actions(c) } catch (e) { return null } }
    const hasIntent = c => { const a = allowedOf(c); return a && a.includes(intent) }
    const ev = intent === "event"
    let pool = hand.filter(hasIntent)
    if (!pool.length) pool = hand.slice()
    if (!pool.length) return null
    const ov = c => Number(cards[c] && cards[c].ops) || 0
    pool.sort((a, b) => { const da = ov(a), db = ov(b); if (ev) return da === db ? a - b : da - db; return da === db ? b - a : db - da })
    const chosen = pool[0]
    const viaAction = hasIntent(chosen) ? intent : (allowedOf(chosen) || []).includes("event") ? "event" : "ops"
    return { action: "card", argument: chosen, via: `${strategy.name}:${viaAction}` }
}

// 选行动窗("C{idx}: Select action."): 按已钉战略选 ops/event 等。
function esm_card_action_window_action(strategy, view, context) {
    const legal = Object.keys(view.actions || {}).filter(a => { const v = view.actions[a]; return Array.isArray(v) ? v.length > 0 : Boolean(v) })
    const wantEvent = strategy.kind === "EVENT" || strategy.kind === "ABSTRACT" || strategy.kind === "GARRISON" || strategy.kind === "DEFEND"
    const wantOps = strategy.kind === "CONQUEST"
    if (wantOps && legal.includes("ops")) return { action: "ops", argument: undefined, via: strategy.name + ":ops" }
    if (wantEvent && legal.includes("event")) return { action: "event", argument: undefined, via: strategy.name + ":event" }
    // 意图不可行时按现图表默认优先级(minimal 兜底)
    return null
}

// 对外 trace: 供 erasmus.js publicTrace 附加
function esm_trace_of(strategy) {
    if (!strategy) return null
    return { axis: strategy.role + "/" + strategy.phase + "/" + strategy.name, kind: strategy.kind, phase: strategy.phase,
        strategy: strategy.name, chainHead: strategy.chain[0] !== undefined ? strategy.chain[0] : null,
        focus: eop_focus(strategy.role), chainLen: strategy.chain.length }
}
