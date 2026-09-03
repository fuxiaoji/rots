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
// PASS: 本回合跳; GARRISON/DEFEND: v1 有界近似(按 EVENT 微执行, trace 标注);
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
// D1: 新对局出现时, 把 erasmus_ops 的外部链覆盖(EOP_OVERRIDE)一并清掉。
// gate 开路径的 erasmus.js 只在 gate 关/异常时清链, 多局同进程下第 2 局起会沿用
// 上一局末的链(实测: 同种子单局=T10、批内第2局=T12) —— 这里在新局边界统一清。
function esm_clear_cross_game() {
    if (typeof eop_clear_all_chains === "function") { try { eop_clear_all_chains() } catch (e) { /* ignore */ } }
}
function esm_new_lock(seed, ord) {
    const e = { turn: G.turn, role: { Japan: null, Allies: null }, seenOrd: ord || 0, bombFail: false, lastOrdTurn: 0 }
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
    // D5 诊断(仅 trace 用, 不进决策): 钉选时刻的引擎权威账本 —— PoW 银行/G.pow/JP 资源/
    // 轰炸战役标记/JP 手里的资源格 —— 供审计"为何条约败/离胜利线多远"。
    try {
        ctx._diag = {
            turn: G.turn, pow: G.pow, bank: esm_pow_bank(),
            jpRes: (typeof get_jp_resources === "function") ? get_jp_resources() : -1,
            marker: (G.events && events && events.STRAT_BOMBING_CAMPAIGN) ? (G.events[events.STRAT_BOMBING_CAMPAIGN.id] || 0) : -1,
            resHexes: (typeof RESOURCE_HEX !== "undefined") ? RESOURCE_HEX.filter(h => h >= 0 && h <= LAST_BOARD_HEX && is_space_controlled(h, JP)) : [],
        }
    } catch (e) { /* 无 G 时不设 */ }
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
    const hits = []
    for (const e of reg.named) { const n = esm_norm(e.name); if (t.includes(n) || n.includes(t)) hits.push(e.idx) }
    return hits
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
    let name = esm_eval(role, phase, ctx, lock)
    // D2: 同轴延续(仅影响“同阶段 d10 轮换轴”之间的选择; 纯树结果 freshName 仍是求值真值)。
    name = esm_pin_axis_continuity(lock, role, phase, name)
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
    let goals = [], chain = []
    if (entry) {
        // 忠实 parse_goals: 有序 Goal(kind+hex+region) + 指针/资源/落底展开。
        try { goals = esm_parse_entry(entry, role, contentPhase) } catch (e) { goals = [] }
        chain = esm_chain_of(goals)
    }
    // D4: ABSTRACT 自身无 hex 链(纯文本目标), 落到可执行回退链, 让 eop 焦点层在"推进B29/
    // 原子弹胜利"钉住期间仍有可打的主攻方向:
    //   推进B29   -> 占领轰炸基地(把基地前推到距东京 ≤8, B29 才谈得上就位/轰炸);
    //   原子弹胜利 -> 重返菲律宾(夺回莱特/马尼拉/DEI/马来亚, 压低 get_jp_resources)。
    if (entry && entry.kind === "ABSTRACT" && !chain.length) {
        const fbName = name === "推进B29" ? "占领轰炸基地" : (name === "原子弹胜利" ? "重返菲律宾" : null)
        if (fbName) {
            const fb = esm_strategy_entry(role, "late", fbName)
            if (fb) {
                try {
                    const fbGoals = esm_parse_entry(fb, role, "late")
                    goals = fbGoals
                    chain = esm_chain_of(fbGoals)
                } catch (e) { /* 保持空链 */ }
            }
        }
    }
    // D5: 资源剥夺入链 —— 引擎 victory_1945 要 get_jp_resources() ≤ 1; 决策树"原子弹胜利"
    // 的 res≤(苏联已打?3:5)只是"选择原子弹战略"的门槛, 不足以致胜, 且 登陆日本 的链目标是
    // 本土格、不覆盖日本手里的资源格(实测多种子终局 res 停在 3-6)。故只在【终局冲刺轴】——
    // 登陆日本 / 原子弹胜利(此时轰炸基地与 B29 就绪、前方正是本土/朝鲜/满洲)——钉住时,
    // 把"仍在日本手里的资源格"按距链首近者前置进链: 本土线先清韩国/满洲(Seoul/Harbin/Mukden),
    // 南方残留资源随前线就近先取 —— 让 eop 焦点把资源真正打到 ≤1。
    // 门必须窄: 若用 al_L_F(=控塞班即真)会过早(如 T5 拿下塞班就转入夺资源), 反而饿死中期
    // 夺格攒 PoW 银行的主线 —— 实测把 seed20260924 从 T11 拖回 T8 条约败。
    if ((name === "登陆日本" || name === "原子弹胜利") && chain.length) {
        try {
            const rem = esm_jp_resource_hexes()
            if (rem.length) {
                const jpRes = (typeof get_jp_resources === "function") ? get_jp_resources() : rem.length
                if (jpRes > 1) {
                    const head = chain[0]
                    if (typeof get_distance === "function") rem.sort((a, b) => get_distance(a, head) - get_distance(b, head) || a - b)
                    const have = new Set(chain)
                    const add = rem.filter(h => !have.has(h))
                    if (add.length) chain = add.concat(chain)
                }
            }
        } catch (e) { /* 保守: 不动链 */ }
    }
    const strategy = entry ? {
        name, nameFull: entry.name, kind: entry.kind, notes: entry.notes, targets: entry.targets,
        phase, role, seed: seedText, ord, pinnedNow: true, goals, chain, ctx, d10Rolls: [],
        eventPhase: isEventStrat ? "early" : undefined,
    } : {
        name, nameFull: name, kind: "EVENT", notes: [], targets: [], phase, role, ord,
        pinnedNow: true, goals: [], chain: [], ctx, d10Rolls: [],
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
    if (strategy.kind === "GARRISON" || strategy.kind === "DEFEND") {
        // v1 有界近似: 国防圈/最终防御 -> 事件微执行(打事件/低值牌), 保留大 OC 卡。
        return esm_choose_card(hand, "event", legal, strategy)
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
    const pool = (hand || []).filter(eventCapable)
    if (!pool.length) return null
    const own = f => pool.filter(c => meta(c).faction === mine && f(meta(c)))
    for (let i = 0; i < list.length; i++) {
        const line = list[i]
        let hit = null
        if (/结束.*ISR|ISR.*(?:结束|清除|消除)/.test(line)) {
            if (ownRiv) hit = own(m => m.isr_agreement)            // 己方 ISR 激活时才值得打和解牌
        } else if (/造成.*ISR|引发.*ISR/.test(line)) {
            if (!foeRiv) hit = own(m => m.isr_rivalry)             // 敌方已 ISR 则重复施加无效
        } else if (/东京玫瑰|Tokyo Rose/i.test(line)) {
            hit = pool.filter(c => /tokyo rose/i.test(meta(c).name))
        } else if (/杜立特|Doolittle Raid/i.test(line)) {
            hit = pool.filter(c => /^doolittle raid$/i.test(meta(c).name))
        } else if (/巴丹|Bataan|Battan/i.test(line)) {
            hit = pool.filter(c => /battan death march|bataan death march/i.test(meta(c).name))
        } else if (/天气|weather/i.test(line)) {
            hit = pool.filter(c => /^weather$/i.test(meta(c).name))
        } else {
            hit = null    // 无可稳定判定的执行信号 -> 顺延(其他放牌等由通用兜底覆盖)
        }
        if (!hit || !hit.length) continue
        const ov = c => Number(meta(c).ops) || 0
        const best = hit.slice().sort((a, b) => { const d = ov(a) - ov(b); return d === 0 ? a - b : d })[0]
        return { action: "card", argument: best, via: `${strategy.name}:清单#${i + 1}「${line}」` }
    }
    return null
}

// 选行动窗("C{idx}: Select action."): 按已钉战略选 ops/event 等。
function esm_card_action_window_action(strategy, view, context) {
    const legal = Object.keys(view.actions || {}).filter(a => { const v = view.actions[a]; return Array.isArray(v) ? v.length > 0 : Boolean(v) })
    const wantEvent = strategy.kind === "EVENT" || strategy.kind === "GARRISON" || strategy.kind === "DEFEND"
    const wantOps = strategy.kind === "CONQUEST" || strategy.kind === "ABSTRACT"   // D4: ABSTRACT 走 OPS
    if (wantOps && legal.includes("ops")) return { action: "ops", argument: undefined, via: strategy.name + ":ops" }
    if (wantEvent && legal.includes("event")) return { action: "event", argument: undefined, via: strategy.name + ":event" }
    // 意图不可行时按现图表默认优先级(minimal 兜底)
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
function esm_trace_of(strategy) {
    if (!strategy) return null
    const goalKinds = (strategy.goals || []).map(g => g.kind)
    return { axis: strategy.role + "/" + strategy.phase + "/" + strategy.name, kind: strategy.kind, phase: strategy.phase,
        strategy: strategy.name, chainHead: strategy.chain[0] !== undefined ? strategy.chain[0] : null,
        focus: eop_focus(strategy.role), chainLen: strategy.chain.length,
        goals: goalKinds.length ? goalKinds : undefined,
        ...(strategy.eventPhase ? { eventPhase: strategy.eventPhase } : {}),
        ...(strategy.ctx && strategy.ctx._diag ? { diag: strategy.ctx._diag } : {}) }
}
