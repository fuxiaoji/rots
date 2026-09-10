// ============================================================================
// ERASMUS_PLUS 战役层 (改进计划 v1.0 §4-§11) — erasmus-v2-opt 研究层
// Decision Axis → CampaignAssessment → Posture → TargetSet → OffensivePlan
//   → 多候选任务部队 → P(capture) 评估 → 全局激活分配 → 扫荡/前推
// 全部在 em_cfg().erasmus_plus 开关后; STRICT_ERASMUS(配置关)不进本文件任何函数。
// 复用 erasmus_math.js 的期望战斗模型(与引擎表值对齐)。
// ============================================================================
"use strict"

// ---- 参数(计划 §32 初值, 全部可经 EOTS_OPT_PARAMS 覆盖) --------------------
function ep_params() {
    const c = em_cfg() || {}
    return {
        minP: c.epMinP !== undefined ? c.epMinP : 0.60,
        desiredP: c.epDesiredP !== undefined ? c.epDesiredP : 0.75,
        overmatchDesiredP: c.epOvermatchDesiredP !== undefined ? c.epOvermatchDesiredP : 0.85,
        desperateMinP: c.epDesperateMinP !== undefined ? c.epDesperateMinP : 0.45,
        pressureRatio: c.epPressureRatio !== undefined ? c.epPressureRatio : 1.35,
        overmatchRatio: c.epOvermatchRatio !== undefined ? c.epOvermatchRatio : 1.80,
        forwardTheaterDist: c.epForwardDist !== undefined ? c.epForwardDist : 12,
    }
}

// ---- §4 CampaignAssessment --------------------------------------------------
// 前沿有效兵力: 只统计距任意敌方单位 ≤ forwardTheaterDist 的单位 CF(计划 §4.1:
// 不看全图总 CF, 只看能进入相关战区的有效兵力)。
function ep_forward_cf(faction, enemyFaction, cls) {
    const enemyLocs = []
    for (let u = 1; u < pieces.length; ++u) {
        const p = pieces[u]
        if (p && p.faction === enemyFaction && p.class !== "hq") {
            const h = G.location[u]
            if (h >= 0 && h <= LAST_BOARD_HEX) enemyLocs.push(h)
        }
    }
    let total = 0
    for (let u = 1; u < pieces.length; ++u) {
        const p = pieces[u]
        if (!p || p.faction !== faction || p.class !== cls) continue
        const h = G.location[u]
        if (!(h >= 0 && h <= LAST_BOARD_HEX)) continue
        const reduced = G.reduced && (typeof set_has === "function" ? set_has(G.reduced, u) : G.reduced.includes(u))
        const cf = reduced ? (Number(p.rcf) || Math.ceil((Number(p.cf) || 0) / 2)) : (Number(p.cf) || 0)
        for (const eh of enemyLocs) {
            if (get_distance(h, eh) <= 12) { total += cf; break }
        }
    }
    return total
}

// 替补潜力: 未部署+增援队列中的地面 CF 总量(计划 §4.2 交换价值的稀缺度代理)。
function ep_replacement_cf(faction) {
    let total = 0
    for (let u = 1; u < pieces.length; ++u) {
        const p = pieces[u]
        if (!p || p.faction !== faction || p.class !== "ground") continue
        const loc = G.location[u]
        const pending = loc === 1481 || loc === 1483 || loc === 1484 || (loc >= 1490 && loc <= 1510)
        if (pending) total += Number(p.cf) || 0
    }
    return total
}

// §4.3 Turn Urgency
function ep_urgency(turn) {
    if (turn >= 12) return 3.0
    if (turn === 11) return 1.8
    if (turn === 10) return 1.4
    if (turn === 9) return 1.2
    return 1.0
}

// §5 Strategic Posture
function ep_posture(role) {
    const P = ep_params()
    const me = role === "Japan" ? JP : AP
    const enemy = 1 - me
    const myForward = ep_forward_cf(me, enemy, "ground") + 0.5 * ep_forward_cf(me, enemy, "air") + 0.5 * ep_forward_cf(me, enemy, "naval")
    const enForward = ep_forward_cf(enemy, me, "ground") + 0.5 * ep_forward_cf(enemy, me, "air") + 0.5 * ep_forward_cf(enemy, me, "naval")
    const myRepl = ep_replacement_cf(me), enRepl = ep_replacement_cf(enemy)
    const ratio = enForward > 0 ? myForward / enForward : (myForward > 0 ? 9.9 : 1.0)
    let posture = "NORMAL"
    if (ratio >= P.overmatchRatio && myRepl >= enRepl) posture = "OVERMATCH"
    else if (ratio >= P.pressureRatio) posture = "PRESSURE"
    let desperate = false
    if (role === "Allies" && (G.turn >= 11 || Number(G.political_will || 9) <= 2)) desperate = true
    if (role === "Japan" && get_jp_resources && (() => { try { return get_jp_resources() <= 3 } catch (e) { return false } })()) desperate = true
    if (desperate) posture = "DESPERATE"
    return { posture, ratio: Number(ratio.toFixed(2)), myForward, enForward, myRepl, enRepl,
        urgency: ep_urgency(Number(G.turn || 0)) }
}

// P(capture) 门槛(§8 三重门槛的姿态化取值)
function ep_p_thresholds(posture) {
    const P = ep_params()
    if (posture === "DESPERATE") return { min: P.desperateMinP, desired: P.desiredP }
    if (posture === "OVERMATCH") return { min: P.minP + 0.05, desired: P.overmatchDesiredP }
    return { min: P.minP, desired: P.desiredP }
}

// ---- §7 AttackMode 分类 ------------------------------------------------------
function ep_attack_mode(role, target) {
    const mine = role === "Japan" ? JP : AP
    const md = (typeof get_map_data === "function") ? get_map_data(target) : null
    if (!md) return "GROUND_ATTACK"
    let enemyUnits = 0
    for (let u = 1; u < pieces.length; ++u) {
        const p = pieces[u]
        if (p && p.faction !== mine && G.location[u] === target) enemyUnits++
    }
    if (enemyUnits === 0 && is_space_controlled(target, 1 - mine)) return "CAPTURE_EMPTY"
    if (md.port && !ep_land_reachable(target, mine)) return "AMPHIBIOUS_ASSAULT"
    return "GROUND_ATTACK"
}
// 陆路可达粗判: 本方任一地面单位沿陆地距离 ≤ 6(地面移动力上限)可达。
function ep_land_reachable(target, mine) {
    if (typeof get_distance !== "function") return false
    for (let u = 1; u < pieces.length; ++u) {
        const p = pieces[u]
        if (!p || p.faction !== mine || p.class !== "ground") continue
        const h = G.location[u]
        if (h >= 0 && h <= LAST_BOARD_HEX && get_distance(h, target) <= 6) return true
    }
    return false
}

// ---- §6/§10 OffensivePlan: 目标集合 + 价值密度分配 ---------------------------
// targets: 候选目标 hex 数组(决策轴链 ∪ raid/资源/紧迫命名格 —— 调用方给全集,
// 本函数不做战略选择, 只做"给定集合下的统一分配", 取代散落的焦点覆盖)。
// 返回 {queue: [hex...]} 按价值密度排序; 激活窗按队列顺序编组, 编满一个再下一个。
function ep_allocate_targets(role, view, targets, budget) {
    const emc = em_cfg() || {}
    if (!emc.erasmus_plus || !Array.isArray(targets) || !targets.length) return null
    const ps = ep_posture(role)
    const th = ep_p_thresholds(ps.posture)
    const urgency = ps.urgency
    const mine = role === "Japan" ? JP : AP
    const scored = []
    const avail = Array.isArray(view?.actions?.unit) ? view.actions.unit : []
    for (const h of targets) {
        let mode = "GROUND_ATTACK"
        let value = (typeof em_target_value === "function") ? em_target_value(role, h) : 1
        try { mode = ep_attack_mode(role, h) } catch (e) {}
        if (mode === "CAPTURE_EMPTY") value *= 0.8 // 空格扫荡: 低成本高确定性, 轻微降权排序
        // 可行性: 编得出单位才入队(编不出地面组的两栖格跳过 —— 防 Vogelkop 死锁)
        let feasible = true, pWin = 0
        try {
            const plan = composeTaskForce(h, null, null, view, avail, role)
            if (!plan || (plan.unit === undefined || plan.unit === null)) feasible = false
            else if (plan.groundStrength !== undefined && mode === "AMPHIBIOUS_ASSAULT") {
                // 登陆目标 P(capture) 评估(计划 §9: 枚举 D10, 已含反应折算的守军)
                const defenders = (view?.ai?.units || []).filter(u => u.faction !== mine && u.location === h)
                const as = em_amphib_assessment({
                    attacker: mine, targetHex: h,
                    attNavalCF: plan.strikeStrength, attNavalHasBr: true, attAirCF: 0,
                    attGroundCF: plan.groundStrength, attGroundLfs: [3],
                    defNavalCF: defenders.filter(u => u.class === "naval").reduce((s, u) => s + (u.cf || 0), 0),
                    defNavalHasBr: defenders.some(u => u.class === "naval"),
                    defAirCF: defenders.filter(u => u.class === "air").reduce((s, u) => s + (u.cf || 0), 0),
                    defGroundCF: defenders.filter(u => u.class === "ground").reduce((s, u) => s + (u.cf || 0), 0),
                    defGroundLfs: defenders.filter(u => u.class === "ground").map(u => Number(u.lf) || 3),
                })
                pWin = as.pWin
                if (as.abort) feasible = false
            }
        } catch (e) { feasible = false }
        if (!feasible) continue
        // 门槛: 低于 min 且非 DESPERATE 的目标降权(不删除 —— OVERMATCH 交换逻辑仍可打)
        if (pWin > 0 && pWin < th.min && ps.posture !== "DESPERATE") value *= 0.5
        const density = value * (pWin > 0 ? Math.max(pWin, 0.15) : 0.5) * urgency
        scored.push({ hex: h, mode, value: Number(value.toFixed(1)), pWin: Number(pWin.toFixed(2)), density: Number(density.toFixed(2)) })
    }
    scored.sort((a, b) => b.density - a.density || a.hex - b.hex)
    const plan = { role, turn: Number(G.turn || 0), posture: ps.posture, urgency,
        thresholds: th, force: { myForward: ps.myForward, enForward: ps.enForward },
        queue: scored.map(x => x.hex), detail: scored, budget: budget || null }
    if (typeof ep_trace_plan === "function") ep_trace_plan(plan)
    return plan
}

// ---- §13 Exploitation: 空虚敌控格扫荡(队列全达标后的剩余预算消费者) ----------------
// 扫描敌控且双方皆无单位的格: 资源/港口/机场/命名格优先, 需本方地面单位可达(≤6)。
function ep_pick_exploitation_hex(role) {
    const emc = em_cfg() || {}
    if (!emc.erasmus_plus) return null
    const mine = role === "Japan" ? JP : AP
    if (typeof is_space_controlled !== "function" || typeof get_distance !== "function") return null
    const occupied = new Set()
    for (let u = 1; u < pieces.length; ++u) {
        const p = pieces[u]
        if (!p) continue
        const h = G.location[u]
        if (h >= 0 && h <= LAST_BOARD_HEX) occupied.add(h)
    }
    let best = null, bestScore = -Infinity
    for (let h = 1; h <= LAST_BOARD_HEX; ++h) {
        if (occupied.has(h)) continue
        if (!is_space_controlled(h, 1 - mine)) continue
        const md = (typeof get_map_data === "function") ? get_map_data(h) : null
        if (!md) continue
        // 本方地面可达性: 距任意己方地面 ≤6(一个攻势的移动力), 太远不扫
        let reach = 99
        for (let u = 1; u < pieces.length; ++u) {
            const p = pieces[u]
            if (!p || p.faction !== mine || p.class !== "ground") continue
            const h2 = G.location[u]
            if (h2 >= 0 && h2 <= LAST_BOARD_HEX) reach = Math.min(reach, get_distance(h2, h))
        }
        if (reach > 6) continue
        let value = 1
        if (md.resource) value += 6
        if (md.port) value += 3
        if (md.airfield) value += 3
        if (md.named) value += 2
        const score = value - reach * 0.5
        if (score > bestScore) { bestScore = score; best = h }
    }
    return best
}

if (typeof module === "undefined" || !module.exports) { /* bundle 内联, 无导出 */ }
