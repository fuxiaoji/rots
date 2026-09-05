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

// 当前主轴的完整目标链。外部链覆盖(erasmus_state)直接携带已解析好的有序 idx
// chain(=parse_goals 全部 hex, 忠实 py target_chain), 不走 token 二次解析;
// 默认 EOP_AXES 走 name/4-digit token -> idx。
function eop_axis_chain(role) {
    const axis = eop_axis(role)
    if (!axis) return []
    if (Array.isArray(axis.chain) && axis.chain.length) return axis.chain.slice()
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
    // 状态机显式给出一个战略时，即使其目标链为空（事件、已完成驻军、暂时没有本州
    // 登陆部队），也必须阻断旧的默认资源轴。旧判断会把空链战略悄悄替换成 JP_RESOURCE。
    if (ov) {
        return { id: ov.name || (role + "_AXIS"), role: role,
            note: ov.note ? `${ov.name} — ${ov.note}` : (ov.name || role + "轴"),
            kind: ov.kind || null, tokens: ov.tokens || [], chain: ov.chain || [], targetMeta: ov.targetMeta || [] }
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
        const meta = eop_target_meta(mine === JP ? "Japan" : "Allies", idx)
        // 压制目标的完成条件是敌方 AZOI 不再覆盖该格，并非必须夺取控制权。
        // 因此 Jolo 即便仍由盟军控制，只要覆盖它的航空/航母 ZOI 已被消灭，就应顺延
        // 到 Makassar；夺占类目标仍严格以控制权为完成条件。
        if (meta && (meta.kind === "SUPPRESS" || meta.kind === "SUPPRESS_HQ")) {
            if (typeof has_zoi === "function" && has_zoi(idx, 1 - mine)) return idx
            continue
        }
        // 最终国防圈[2]：只考虑仍由日本控制的地点。己控地点必须有对应兵种驻军；
        // 敌控地点既不算完成条件，也不转化成夺回目标。
        if (meta && meta.kind === "GARRISON") {
            if (!is_space_controlled(idx, mine)) continue
            const required = meta.garrisonClass || "ground"
            let occupied = false
            for (let u = 1; u < pieces.length; ++u) {
                const p = pieces[u]
                if (p && p.faction === mine && p.class === required && G.location[u] === idx) { occupied = true; break }
            }
            if (!occupied) return idx
            continue
        }
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
// 敌方单位落点(任意军种), 供"靠前线"就近打分; 引擎未提供迭代器时退化为直接扫 pieces。
function eop_enemy_locs(mine) {
    if (typeof G === "undefined" || !G || !G.location) return []
    const enemy = mine === JP ? AP : JP
    const out = []
    for (let u = 1; u < pieces.length; u++) {
        const p = pieces[u]
        if (!p || p.faction !== enemy) continue
        const h = G.location[u]
        if (h >= 0 && h <= LAST_BOARD_HEX) out.push(h)
    }
    return out
}
function eop_min_dist(hex, locs) {
    if (typeof get_distance !== "function" || !locs.length) return 99
    let best = 99
    for (let i = 0; i < locs.length; i++) {
        const d = get_distance(hex, locs[i])
        if (d < best) best = d
    }
    return best
}

// 进攻单位/会战申报单位: 主键 = 到最近敌单位的距离(越靠前线, 激活后当回合即可开战夺格,
// 而非空跑一整轮又无会战可报), 次键 = 到焦点距离(保留战略方向)。此前只按"距焦点最近"
// 挑单位, 而焦点(如拉包尔)常远在战线后方, 挑出的单位离任何敌军都远 → 移动后够不着敌格
// → ~半攻势"Confirm offensive"直接跳过会战 → 每回合夺格数远低于 PoW 所需 4。
function eop_pick_unit(candidates, role, activeUnits) {
    if (!Array.isArray(candidates) || candidates.length === 0) return undefined
    const focus = eop_focus(role)
    if (typeof G === "undefined" || !G || !G.location) return undefined
    const mine = role === "Japan" ? JP : AP
    const axis = eop_axis(role)
    const focusMeta = focus === null ? null : eop_target_meta(role, focus)
    if (focus !== null && axis && (axis.kind === "GARRISON" || axis.kind === "DEFEND")) {
        const required = focusMeta && focusMeta.kind === "GARRISON" ? (focusMeta.garrisonClass || "ground") : null
        const home = candidates.filter(u => {
            const p = pieces[u], h = G.location[u], md = h >= 0 && h <= LAST_BOARD_HEX ? get_map_data(h) : null
            if (!p || p.faction !== mine || !md) return false
            if (required) return p.class === required
            return md.region === "Japan" && (p.class === "ground" || p.class === "air" || p.class === "naval")
        })
        if (home.length) {
            const cls = p => axis.kind === "DEFEND" ? (p.class === "ground" ? 0 : p.class === "air" ? 1 : 2) : 0
            home.sort((a, b) => cls(pieces[a]) - cls(pieces[b])
                || get_distance(G.location[a], focus) - get_distance(G.location[b], focus)
                || (Number(pieces[b].cf) || 0) - (Number(pieces[a].cf) || 0) || a - b)
            return home[0]
        }
        // 本土防御没有合适单位时宁可不选，也不能退回最近敌军/南方资源轴。
        return undefined
    }
    const enemyLocs = eop_enemy_locs(mine)
    const activated = Array.isArray(activeUnits) ? activeUnits : []
    // 两栖登陆护航 (TF_FORMATIONS「带海上/带航空海上支援的登陆」至少 1 海军单位):
    // 敌占港口/岛屿格的两栖夺控若不带海军护航, 引擎 broken_aa 会
    // “Amphibious Assault failed due to lack of naval escort” 把登陆部队打回吃损失。
    // 只在激活窗启用(调用方传入 activeUnits), 且仅完整全图剧本(gate on) —— SP/Burma
    // 子图剧本保持 zh.6 行为不变(golden 不动)。
    const mdFocus = (focus !== null && typeof get_map_data === "function") ? get_map_data(focus) : null
    // 敌占或空敌控港口都算"需两栖登陆": 即使当前格无敌军, 敌方反应(Intercept)仍可能
    // 把海军调进来, 无护航的登陆照样在会战判 "Amphibious Assault failed"。故只在
    // "未控制港口"即触发护航, 不要求格内有敌军。
    const landing = Array.isArray(activeUnits) && focus !== null && !is_space_controlled(focus, mine)
        && mdFocus && mdFocus.port
        && (typeof esm_gate_on === "function" ? esm_gate_on() : false)
    const actNaval = activated.find(u => pieces[u] && pieces[u].class === "naval")
    const groundCandLocs = new Set()
    for (const u of candidates) { const p = pieces[u]; if (p && p.class === "ground") groundCandLocs.add(G.location[u]) }

    // 1) 先补海军护航: 只补与地面候选同格的海军(无头推进把同格海陆编成同组一起上岛)。
    //    非同格海军补了也白补 —— 无头推进按“同格编组”, 非同格海军会单独一组, 而纯海军组
    //    只能攻“敌海军格”(headless_target_score), 够不着只守地面的敌港, 地面仍无护航吃失败。
    if (landing && !actNaval) {
        let best = null
        for (const u of candidates) {
            const p = pieces[u]
            if (p && p.class === "naval" && groundCandLocs.has(G.location[u])) {
                if (best === null || u < best) best = u
            }
        }
        if (best !== null) return best
    }

    const fd = h => (focus === null ? 99 : (typeof get_distance === "function") ? get_distance(h, focus) : Math.abs(h - focus))
    const scored = []
    for (const u of candidates) {
        const loc = G.location[u]
        if (!(loc >= 0 && loc <= LAST_BOARD_HEX)) continue
        scored.push([u, eop_min_dist(loc, enemyLocs), fd(loc)])
    }
    if (!scored.length) return undefined
    // 图表已经给出当前目标时，编队必须先围绕该目标组织；旧排序把“离任意敌军最近”
    // 放在首键，导致马尼拉为焦点时仍不断激活靠近婆罗洲小据点的单位。只有无明确
    // 目标（事件/一般前推）时才采用最近敌军排序。
    if (focusMeta) scored.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0])
    else scored.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0])
    // B: 焦点是敌占格(需“夺占”而非纯消耗)时, 若候选里有“到最近敌军距离”不比最优单位远太多的
    // 两栖地面(海军陆战队 asp / 可战略海运 strat_move), 优先选它组成登陆力量 —— 否则每次
    // 攻势总挑最近敌军的纯空/海军, 只会对岛屿做远距空袭, 永远无法登岛占格。
    // 只在 node 端用环境开关做 A/B; 浏览器 PvE(process 未定义)时默认开启该偏置。
    const biasOn = (typeof process === "undefined") || process.env.B_BIAS !== "0"
    if (biasOn && focus !== null && !is_space_controlled(focus, mine)) {
        const refD = scored[0][1]
        const cap = focusMeta ? Infinity : Math.max(3, refD + 3)
        const isGroundLanding = u => { const p = pieces[u]; return p && p.class === "ground" && (p.asp || p.strat_move) }
        // 登陆且已有海军护航时, 优先选与任一已激活海军同格的地面(编成同组一起上岛),
        // 避免海陆分处两格导致地面单独硬登陆。
        let pick = null
        if (landing && actNaval) {
            const escortLocs = new Set()
            for (const u of activated) { const p = pieces[u]; if (p && p.class === "naval") escortLocs.add(G.location[u]) }
            pick = scored.find(([u, ed]) => ed <= cap && escortLocs.has(G.location[u]) && isGroundLanding(u))
        }
        if (!pick) pick = scored.find(([u, ed]) => ed <= cap && isGroundLanding(u))
        if (pick) return pick[0]
    }
    return scored[0][0]
}

// 两栖登陆无护航可用 → 阻断硬登陆 (TF_FORMATIONS「无支援登陆」仅限空目标且无敌方反应;
// 敌占/敌控港口的两栖夺控若本窗既无已激活海军、待激活候选里也无海军, 继续激活两栖地面
// 只会被 broken_aa 判 "Amphibious Assault failed" 吃损失)。返回 true 让选牌窗在尚未激活
// 任何单位时提前 done 收尾(空攻势, 不耗单位)。仅完整全图剧本(gate on)。
function eop_landing_no_escort(role, view) {
    if (typeof esm_gate_on !== "function" || !esm_gate_on()) return false
    if (!view || !view.offensive) return false
    const mine = role === "Japan" ? JP : AP
    const focus = eop_focus(role)
    if (focus === null) return false
    const meta = eop_target_meta(role, focus)
    if (!meta || !meta.requiresOccupation) return false
    const md = (typeof get_map_data === "function") ? get_map_data(focus) : null
    if (!md || !md.port) return false
    if (is_space_controlled(focus, mine)) return false
    // 可新增单位(去已激活、去空中)里, 是否存在"海军与两栖地面同格"的护航编成?
    // 无头推进按“同格编组”, 只有同格的海陆才能一起上岛(带海上支援登陆); 非同格海军
    // 会单独一组, 够不着只守地面的敌港。故只看“同格海陆”是否可用。
    const cand = Array.isArray(view.actions && view.actions.unit) ? view.actions.unit : []
    const unsel = new Set(Array.isArray(view.unselect) ? view.unselect : [])
    const navalLocs = new Set(), groundLocs = new Set()
    for (const u of cand) {
        if (unsel.has(u)) continue
        let p = null
        try { p = pieces[u] } catch (e) {}
        if (!p || p.class === "air") continue
        const loc = G.location[u]
        if (p.class === "naval") navalLocs.add(loc)
        else if (p.class === "ground" && (p.asp || p.strat_move)) groundLocs.add(loc)
    }
    if (groundLocs.size === 0) return false   // 无两栖地面可激活 → 不会发生无护航登陆
    for (const loc of groundLocs) if (navalLocs.has(loc)) return false
    return true
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

function eop_target_meta(role, hex) {
    const axis = eop_axis(role)
    return axis && Array.isArray(axis.targetMeta) ? axis.targetMeta.find(target => target.hex === hex) || null : null
}

// 已在东京 8 格内盟军机场待命的 B29 是战略轰炸胜利链的必要资产。普通攻势若再次
// 激活它，无头移动层只能把纯航空编成送回下一回合轨，导致下一战略轰炸阶段缺席。
// 因此把“已就位且格内无日军”的 B29 从普通激活候选中保护起来。
function eop_preserve_ready_b29(u, role) {
    if (role !== "Allies") return false
    const p = pieces[u], h = G.location[u]
    if (!p || !p.b29 || !(h >= 0 && h <= LAST_BOARD_HEX)) return false
    const md = get_map_data(h)
    if (!md || !md.airfield || !is_space_controlled(h, AP) || get_distance(h, TOKYO) > 8) return false
    for (let x = 1; x < pieces.length; ++x)
        if (pieces[x] && pieces[x].faction === JP && G.location[x] === h) return false
    return true
}

// Public-view planning interfaces used by the chart executor. They deliberately
// consume view.ai/public legal candidates rather than the mutable game state.
function evaluateTargetFeasibility(target, card, hq, view) {
    const units=Array.isArray(view?.ai?.units)?view.ai.units:[], roleFaction=view?.active === "Allies" ? AP : JP
    const meta=eop_target_meta(view?.active,target)
    const cf=u=>u.reduced?(Number(u.rcf)||Math.ceil((Number(u.cf)||0)/2)):(Number(u.cf)||0)
    const allDefenders=units.filter(u=>u.location===target&&u.faction!==roleFaction)
    const defenders=meta?.kind==="SUPPRESS_HQ"?allDefenders.filter(u=>u.class==="air"||u.class==="naval"):allDefenders
    const defense=defenders.reduce((s,u)=>s+cf(u),0)
    const md=(target!==null&&target!==undefined&&typeof get_map_data==="function")?get_map_data(target):null
    const damageLevel=meta?.damageLevel||0.5
    const suppress=meta?.kind==="SUPPRESS"||meta?.kind==="SUPPRESS_HQ"
    const requiresOccupation=!!meta?.requiresOccupation
    const coastal=!!(md&&(md.port||md.island))
    // 第5/11页：兵力标准须把可能反应的敌军计入。以公开单位的战斗航程筛出能到目标的
    // 航空/海军，并计入其中最强一支，避免把一架飞机对现有守军刚好达标误判为完整编队。
    const reactionPool=units.filter(u=>u.faction!==roleFaction&&u.location!==target&&(u.class==="air"||u.class==="naval")
        && typeof get_distance==="function"&&get_distance(u.location,target)<=Math.max(1,Number(u.br)||Number(u.ebr)||1))
    // 提示板要求把所有能够反应到目标的敌军纳入伤害等级，而不是只取最强一支。
    const potentialReactionStrength=reactionPool.reduce((s,u)=>s+cf(u),0)
    const relevantDefense=defense+potentialReactionStrength
    return {target,meta,damageLevel,legal:target!==null&&target!==undefined,coastal,defense,suppress,requiresOccupation,
        garrisonClass:meta?.garrisonClass||null,
        groundDefense:defenders.filter(u=>u.class==="ground").reduce((s,u)=>s+cf(u),0),
        potentialReaction:potentialReactionStrength>0,potentialReactionStrength,
        requiredGroundMath:Math.max(1,defenders.filter(u=>u.class==="ground").reduce((s,u)=>s+cf(u),0)),
        requiredAirSeaMath:Math.max(1,Math.ceil(relevantDefense/damageLevel))}
}
function composeTaskForce(target, card, hq, view, candidates, role) {
    const units=Array.isArray(view?.ai?.units)?view.ai.units:[], byId=new Map(units.map(u=>[u.id,u]))
    const active=new Set((view?.offensive?.active_units||[]).flat()), f=evaluateTargetFeasibility(target,card,hq,view)
    const committed=[...active].map(id=>byId.get(id)).filter(Boolean)
    const cf=u=>u.reduced?(Number(u.rcf)||Math.ceil((Number(u.cf)||0)/2)):(Number(u.cf)||0)
    const strikeStrength=committed.filter(u=>u.class==="air"||u.class==="naval").reduce((s,u)=>s+cf(u),0)
    const groundStrength=committed.filter(u=>u.class==="ground").reduce((s,u)=>s+cf(u),0)
    const hasGround=committed.some(u=>u.class==="ground"),hasNaval=committed.some(u=>u.class==="naval")
    if(f.meta?.kind==="GARRISON"){
        const required=f.garrisonClass||"ground"
        const already=units.some(u=>u.faction===(role==="Japan"?JP:AP)&&u.location===target&&u.class===required)
        if(already)return {complete:true,required:1,strength:1,unit:null,formation:`garrison-${required}`,
            groundStrength,strikeStrength,potentialReactionStrength:0}
        const pool=(candidates||[]).map(id=>byId.get(id)).filter(u=>u&&u.class===required)
        pool.sort((a,b)=>(typeof get_distance==="function"?get_distance(a.location,target)-get_distance(b.location,target):0)
            || cf(a)-cf(b)||a.id-b.id)
        return {complete:false,required:1,strength:0,unit:pool[0]?.id,formation:`garrison-${required}`,
            groundStrength,strikeStrength,potentialReactionStrength:0}
    }
    const landing=f.requiresOccupation&&f.coastal&&view?.ai?.focusControlledBy!==view?.active
    const need=f.suppress?f.requiredAirSeaMath:f.requiresOccupation?f.requiredGroundMath:(f.groundDefense>0?f.requiredGroundMath:f.requiredAirSeaMath)
    const math=f.suppress?strikeStrength:f.requiresOccupation?groundStrength:Math.max(groundStrength,strikeStrength)
    const compositionMet=(!f.requiresOccupation||hasGround)&&(!landing||hasNaval)
    if(compositionMet&&math>=need)return {complete:true,required:need,strength:math,unit:null,
        formation:landing?"supported-amphibious-assault":f.suppress?"air-sea-strike":"minimum-sufficient",
        groundStrength,strikeStrength,potentialReactionStrength:f.potentialReactionStrength}
    let pool=(candidates||[]).map(id=>byId.get(id)).filter(Boolean)
    // 第5/11页脚注：非本土/非印度 HQ 与地面单位同格时，至少保留一个未激活地面单位守卫 HQ。
    pool=pool.filter(u=>{
        if(u.class!=="ground")return true
        const at=units.filter(x=>x.location===u.location&&x.faction===u.faction)
        const hq=at.some(x=>x.class==="hq"), region=typeof get_map_data==="function"?String(get_map_data(u.location)?.region||""):""
        if(!hq)return true
        if(role==="Japan"&&/Japan/i.test(region))return true
        if(role==="Allies"&&/India/i.test(region))return true
        const unactivated=at.filter(x=>x.class==="ground"&&!active.has(x.id))
        return unactivated.length>1
    })
    let amphibiousPick
    if(landing&&typeof eop_pick_unit==="function")amphibiousPick=eop_pick_unit((candidates||[]),role,[...active])
    const classRank=u=>f.suppress?({air:0,naval:1,ground:2}[u.class]??3)
        :f.requiresOccupation?(!hasGround?({ground:0,naval:1,air:2}[u.class]??3):(!hasNaval&&landing?({naval:0,air:1,ground:2}[u.class]??3):({air:0,naval:1,ground:2}[u.class]??3)))
        :({air:0,naval:1,ground:2}[u.class]??3)
    // 同一兵种先选最靠近当前图表目标者，再比较战力；否则会从本土抽一个高战力但
    // 本攻势根本到不了菲律宾的陆军，最终形成“高激活、零会战”。
    const distance=u=>typeof get_distance==="function"&&target!==null&&target!==undefined
        ?get_distance(u.location,target):99
    pool.sort((a,b)=>classRank(a)-classRank(b)||distance(a)-distance(b)||cf(b)-cf(a)||a.id-b.id)
    return {complete:false,required:need,strength:math,unit:amphibiousPick??pool[0]?.id,
        formation:landing?"supported-amphibious-assault":f.requiresOccupation?"ground-with-support":"air-sea-strike",
        groundStrength,strikeStrength,potentialReactionStrength:f.potentialReactionStrength}
}

function selectOperationalHq(view,candidates,role){
    if(!Array.isArray(candidates)||!candidates.length)return undefined
    const byId=new Map((view?.ai?.units||[]).map(u=>[u.id,u])),focus=view?.ai?.focus
    const axis=eop_axis(role),name=String(axis?.id||axis?.note||"").toLowerCase()
    const preferred=role==="Allies"?(name.includes("cbi")?/seac/i:name.includes("dei")||name.includes("philipp")?/south west/i:name.includes("south pacific")?/south pacific/i:/central pacific/i)
        :(name.includes("cbi")||name.includes("india")?/south hq/i:name.includes("central")?/combined fleet/i:/south hq|south seas/i)
    const score=id=>{const u=byId.get(id),d=u&&focus!==null&&focus!==undefined&&typeof get_distance==="function"?get_distance(u.location,focus):99
        return [u&&preferred.test(String(u.name||""))?0:1,d,-(u?.cm||0),-(u?.cr||0),id]}
    return candidates.slice().sort((a,b)=>{const x=score(a),y=score(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];return 0})[0]
}
function planReaction(view,candidates,action,role,strategy){
    if(!Array.isArray(candidates)||!candidates.length)return undefined
    const units=Array.isArray(view?.ai?.units)?view.ai.units:[],byId=new Map(units.map(u=>[u.id,u]))
    const mine=role==="Japan"?JP:AP, enemy=1-mine
    if(action==="card"){
        const cardsMeta=Array.isArray(view?.ai?.ownCards)?view.ai.ownCards.slice():[]
        for(const id of candidates)if(!cardsMeta.some(c=>c.id===id)&&typeof cards!=="undefined"&&cards[id])cardsMeta.push({id,name:cards[id].name,intelligence:cards[id].intelligence,reaction:cards[id].reaction})
        const wanted=String(strategy||"")
        if(wanted.includes("CARD_PRIORITY")){
            const rank=c=>{
                const n=String(c?.name||"")
                if(role==="Allies")return /intelligence|情报/i.test(n)||c?.intelligence!==undefined?0:/counter|反攻/i.test(n)?1:/ambush|伏击/i.test(n)?2:/submarine/i.test(n)?3:4
                return /jn.?25|intelligence|情报/i.test(n)||c?.intelligence!==undefined?0:/counter|反击/i.test(n)?1:/kamikaze|神风/i.test(n)?2:/submarine/i.test(n)?3:4
            }
            const byId=new Map(cardsMeta.map(c=>[c.id,c]))
            return candidates.slice().sort((a,b)=>rank(byId.get(a))-rank(byId.get(b))||a-b)[0]
        }
        const re=wanted.includes("WEATHER")?/weather/i:wanted.includes("KAMIKAZE")?/kamikaze/i
            :wanted.includes("SUBMARINE")?/submarine/i:wanted.includes("AMBUSH")?/(ambush|伏击)/i
            :wanted.includes("COUNTER")?/(counter|反攻)/i:/(jn.?25|intelligence|情报)/i
        const ids=new Set(cardsMeta.filter(c=>re.test(String(c.name||""))).map(c=>c.id))
        const hit=candidates.filter(id=>ids.has(id)).sort((a,b)=>a-b)
        return hit[0]
    }
    if(action==="action_hex"||action==="hex"){
        const score=h=>{
            const md=typeof get_map_data==="function"?get_map_data(h):{}
            const at=units.filter(u=>u.location===h), own=at.filter(u=>u.faction===mine), foe=at.filter(u=>u.faction===enemy)
            // 反应格优先级（双方同构）：己方 HQ、资源格、港口、机场、其他。
            const tier=own.some(u=>u.class==="hq")?0:md.resource?1:md.port?2:md.airfield?3:4
            const foePower=foe.reduce((s,u)=>s+(u.reduced?(u.rcf||Math.ceil(u.cf/2)):u.cf||0),0)
            return [tier,foePower,h]
        }
        return candidates.slice().sort((a,b)=>{const x=score(a),y=score(b);return x[0]-y[0]||x[1]-y[1]||x[2]-y[2]})[0]
    }
    // 反应兵力标准：先使海空战力达到敌海空1倍，再使己方空军数量追平；最后才加地面。
    const active=new Set((view?.offensive?.active_units||[]).flat())
    const selected=[...active].map(id=>byId.get(id)).filter(u=>u&&u.faction===mine)
    const attackers=[...active].map(id=>byId.get(id)).filter(u=>u&&u.faction===enemy)
    const cf=u=>u?(u.reduced?(Number(u.rcf)||Math.ceil((Number(u.cf)||0)/2)):(Number(u.cf)||0)):0
    const ownAS=selected.filter(u=>u.class==="air"||u.class==="naval").reduce((s,u)=>s+cf(u),0)
    const enemyAS=attackers.filter(u=>u.class==="air"||u.class==="naval").reduce((s,u)=>s+cf(u),0)
    const ownAir=selected.filter(u=>u.class==="air").length, enemyAir=attackers.filter(u=>u.class==="air").length
    const rank=u=>ownAS<enemyAS?(u.class==="air"?0:u.class==="naval"?1:2)
        :ownAir<enemyAir?(u.class==="air"?0:u.class==="naval"?1:2)
        :(u.class==="ground"?0:u.class==="air"?1:2)
    return candidates.slice().sort((a,b)=>rank(byId.get(a))-rank(byId.get(b))||cf(byId.get(b))-cf(byId.get(a))||a-b)[0]
}

// 第6/12页 PBM 的单位顺序。落点的六级/三级优先级由 offensive.js 在计算真实合法路径后
// 评分；这里负责在交互式 unit 窗严格按“航空→海上→失败AA地面”选择，并在同类中选择
// 最强航空或稳定的最低 id。函数只读取 view.ai 的只读投影。
function planPostBattleMovement(view,candidates,action,role){
    if(!Array.isArray(candidates)||!candidates.length)return undefined
    if(action!=="unit")return undefined
    const units=Array.isArray(view?.ai?.units)?view.ai.units:[],byId=new Map(units.map(u=>[u.id,u]))
    const failed=new Set(view?.ai?.pbm?.failedAAUnits||[])
    const cf=u=>u?(u.reduced?(Number(u.rcf)||Math.ceil((Number(u.cf)||0)/2)):(Number(u.cf)||0)):0
    const rank=u=>u?.class==="air"?0:u?.class==="naval"?1:(u?.class==="ground"&&failed.has(u.id)?2:3)
    return candidates.slice().sort((a,b)=>rank(byId.get(a))-rank(byId.get(b))
        ||(rank(byId.get(a))===0?cf(byId.get(b))-cf(byId.get(a)):0)||a-b)[0]
}
