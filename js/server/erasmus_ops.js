// 目标聚焦操作层 (Operational Target-Focus) — erasmus-v2.0-zh.6
//
// 与 erasmus_complete_ai_execution_engine.py 同源: 各战略的目标优先级表来自
// 伊拉斯谟 PDF 图表转录 (01/02/03/07/08/09 决策轴), 本文件把这些目标清单落成
// 可执行的主攻轴线 (convoy/岛链), 供:
//   1. js/server/bots/erasmus.js 在“选目标格/选进攻单位”时把行动聚焦到当前
//      轴线的最优先未夺目标 (消除到处乱打、无主线的空转攻势);
//   2. js/server/offensive.js 无头地面/海上推进的 target_score 就近目标转向
//      (让陆军/两栖部队沿主轴线推进, 而不是奔离轴的最近敌军)。
//
// 设计: 无跨窗口记忆 —— 每次调用按当前地图状态(G/控制位)重算“当前主轴”与
// “最优先未夺目标”。同闭包内共享, 引擎与 bot 都能调用 (function 声明提升)。
// 数字 token 按 hex id -> 内部 idx; 其余按地图 name 精确匹配 (+别名)。

var EOP_IDX_BY_NAME = null
const EOP_ALIASES = {
    "Sasebo": "Kynshu",          // 佐世保 = Kynshu (3307)
    "Timor": "Koepang",
    "Uluthi": "Ulithi",
    "Gili-Gili": "Gili Gili",
    "Buin": "Bougainville",      // 无独立 hex
    "Tinian": "Saipan",          // Saipan/Tinian 同格
    "New Hebrides": "Espiritu Santo",
    "Palau Islands": "Palau",
    "Noumea": null,              // 不在 1942-45 长剧本地图, 跳过
    "Salamaua": null,
    "Finschhafen": null,
}

const EOP_AXES = {
    // 盟军: 中太平洋主线 -> 马里亚纳 -> 硫磺岛/冲绳 -> 登陆日本。
    // 对应图表“中太平洋战略 / 跳岛作战 / 登陆日本”三张目标表按序拼接;
    // 每个命名格(或有名字的夺控格)被攻下即计入 PoW 的 G.capture。
    AP: {
        id: "AP_CENPAC_MAIN", role: "Allies",
        note: "中太平洋主线→日本 (Wake→Tarawa→Kwajalein→Eniwetok→Palau→Ulithi→Saipan→Iwo→Okinawa→日本本土)",
        tokens: ["Wake", "Tarawa", "Kwajalein", "Eniwetok", "Palau", "Ulithi",
                 "Saipan", "Iwo Jima", "Okinawa",
                 "Kynshu", "Tokyo", "Ominato", 3606, "Nagoya", "Kyoto", "Kure", "Osaka"],
    },
    // 日本: 南方资源夺控 (东印度/马来亚/菲律宾投降目标)。
    JP_RESOURCE: {
        id: "JP_SOUTH_RESOURCE", role: "Japan",
        note: "南方资源夺控 (东印度→马来亚→菲律宾, 至日本控制≥13资源)",
        tokens: ["Balikpapan", "Tarakan", "Batavia", "Tjilatjap", "Soerabaja",
                 "Bangka", "Palembang", "Medan",
                 "Kuantan", "Singapore",
                 "Manila", "Davao"],
    },
}

// ---- 地图名字 -> 内部 idx 一次性索引 --------------------------------------
function eop_ensure_name_index() {
    if (EOP_IDX_BY_NAME) return
    const m = {}
    if (typeof map === "undefined") { EOP_IDX_BY_NAME = m; return }
    for (let i = 0; i < map.length; i++) {
        const nm = map[i].name
        if (nm) m[nm.toLowerCase()] = (typeof hex_to_int === "function") ? hex_to_int(map[i].id) : null
    }
    EOP_IDX_BY_NAME = m
}

// 解析一个目标 token -> 内部 idx; 解析不到返回 null (调用方跳过, 不炸)。
function eop_resolve_token(token) {
    if (typeof token === "number") return (typeof hex_to_int === "function") ? hex_to_int(token) : null
    const t = String(token).trim()
    const num = t.match(/^(\d{4})$/)
    if (num) return (typeof hex_to_int === "function") ? hex_to_int(+num[1]) : null
    eop_ensure_name_index()
    const alias = Object.prototype.hasOwnProperty.call(EOP_ALIASES, t) ? EOP_ALIASES[t] : undefined
    if (alias === null) return null
    const key = (alias === undefined ? t : alias).toLowerCase()
    return EOP_IDX_BY_NAME[key] !== undefined ? EOP_IDX_BY_NAME[key] : null
}

// 回合级状态机外部链覆盖 (erasmus-v2.0-zh.7): erasmus_state.js 在 gate 开时于
// 每方首卡窗钉住整回合战略, 把该战略的优先目标链(epoch token 表)作为"外部主轴"
// 覆盖固定 EOP_AXES。gate 关时必须清空(否则同进程跨剧本串台)。
var EOP_OVERRIDE = { Japan: null, Allies: null }

function eop_set_strategy_chain(role, override) {
    EOP_OVERRIDE[role] = override || null
}
function eop_clear_all_chains() {
    EOP_OVERRIDE = { Japan: null, Allies: null }
}

// 当前主轴的完整目标链 (只含能解析到真实 hex 的目标; 解析失败的目标静默跳过)。
function eop_axis_chain(role) {
    const axis = eop_axis(role)
    if (!axis) return []
    const out = []
    for (const tk of axis.tokens) {
        const idx = eop_resolve_token(tk)
        if (idx !== null && !out.includes(idx)) out.push(idx)
    }
    return out
}

// 该方当前应当遵循的主轴; 无主轴(如日本资源已足、转入防守)返回 null。
function eop_axis(role) {
    const ov = EOP_OVERRIDE[role]
    if (ov && ov.tokens && ov.tokens.length) {
        return { id: ov.name || (role + "_AXIS"), role: role,
            note: ov.note ? `${ov.name} — ${ov.note}` : (ov.name || role + "轴"), tokens: ov.tokens }
    }
    if (role === "Allies") return EOP_AXES.AP
    // 日本: 控制资源 < 13 时抢南方资源; 达标后转入防守, 不再无谓远征。
    let jpRes = 99
    if (typeof get_jp_resources === "function") {
        try { jpRes = get_jp_resources() } catch (e) { jpRes = 99 }
    }
    if (jpRes < 13) return EOP_AXES.JP_RESOURCE
    return null
}

// 该方最优先的“未夺控”目标 (轴线链首)。链首已控则顺延到下一个, 即
// “目标达成前不换目标”——达成(夺控)才放行下一目标。
// role: "Japan" | "Allies" (或 faction 数值 0/1)。
function eop_focus(role) {
    if (typeof G === "undefined" || !G || !G.supply_cache) return null
    const faction = role === "Japan" ? JP : role === "Allies" ? AP : role
    const mine = faction === JP ? JP : AP
    for (const idx of eop_axis_chain(mine === JP ? "Japan" : "Allies")) {
        if (idx < 0 || idx > LAST_BOARD_HEX) continue
        if (!is_space_controlled(idx, mine)) return idx
    }
    return null
}
function eop_focus_faction(faction) {
    return eop_focus(faction === JP ? "Japan" : faction === AP ? "Allies" : faction)
}

// ---- 选目标格 (action_hex 参数) ------------------------------------------
// 优先当前焦点; 焦点不可达时, 在候选里选距离焦点最近的格(逐步靠近主轴),
// 而不是随机散打。无焦点(= 无主轴或主轴已全达成)时返回 undefined 让原逻辑决定。
function eop_pick_action_hex(candidates, role) {
    if (!Array.isArray(candidates) || candidates.length === 0) return undefined
    const focus = eop_focus(role)
    if (focus === null) return undefined
    let best = null, bestD = Infinity
    for (const h of candidates) {
        let d
        if (h === focus) d = 0
        else if (typeof get_distance === "function") d = get_distance(h, focus)
        else d = Math.abs(h - focus)
        if (d < bestD || (d === bestD && (best === null || h < best))) { bestD = d; best = h }
    }
    return best !== null ? best : undefined
}

// ---- 选进攻/激活单位 ------------------------------------------------------
// 进攻单位/会战申报单位: 优先能打到焦点(距焦点最近)的单位, 使后续 action_hex
// 候选里包含焦点或最靠近焦点的敌格, 消除“有会战能力却全程零会战”。
function eop_pick_unit(candidates, role) {
    if (!Array.isArray(candidates) || candidates.length === 0) return undefined
    const focus = eop_focus(role)
    if (focus === null) return undefined
    if (typeof G === "undefined" || !G || !G.location) return undefined
    let best = null, bestD = Infinity
    for (const u of candidates) {
        const loc = G.location[u]
        if (!(loc >= 0 && loc <= LAST_BOARD_HEX)) continue
        let d
        if (loc === focus) d = 0
        else if (typeof get_distance === "function") d = get_distance(loc, focus)
        else d = Math.abs(loc - focus)
        if (d < bestD || (d === bestD && (best === null || u < best))) { bestD = d; best = u }
    }
    return best !== null ? best : undefined
}

// ---- 引擎无头推进就近转向 ------------------------------------------------
// 供 js/server/offensive.js 调用: 攻击方有主轴时, 用“到焦点的距离”作为
// 同等优先目标内的次级排序键, 引导地面/海军/登陆沿主轴推进。守卫在无主轴时
// (focus null) 返回 -1, 调用方保留原策略无关行为。
function eop_advance_tiebreak(hex, faction) {
    if (typeof G === "undefined" || !G) return -1
    const focus = eop_focus_faction(faction)
    if (focus === null) return -1
    return (typeof get_distance === "function") ? get_distance(hex, focus) : -1
}

// 轨迹可读: 主轴 id + 焦点(便于审计 AI 是否聚焦)。
function eop_trace(role) {
    const axis = eop_axis(role)
    return { axis: axis ? axis.id : null, axis_note: axis ? axis.note : null, focus: eop_focus(role) }
}
