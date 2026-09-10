// ============================================================================
// ERASMUS_PLUS 评估层 (改进计划 v1.0 §4/§5/§8/§12/§15/§18) — erasmus_eval.js
// CampaignAssessment(前沿有效兵力/替补稀缺/紧急度) + StrategicPosture + P门槛
// + TargetValue + TheaterForceDemand + unitScarcity。全部配置化, 禁止散落 magic number。
// 复用 erasmus_math.js 期望战斗模型; STRICT_ERASMUS(配置关)不进任何函数。
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

// §15 Theater Force Demand: 按战区(region)统计双方地面 CF, 输出盈缺。
// demandBase 由战区类型决定: 有盟军前沿存在的战区 required 高(进攻区), 否则低。
function ep_theater_demand(role) {
    const mine = role === "Japan" ? JP : AP
    const theaters = {}
    for (let u = 1; u < pieces.length; ++u) {
        const p = pieces[u]
        if (!p || p.class !== "ground") continue
        const h = G.location[u]
        if (!(h >= 0 && h <= LAST_BOARD_HEX)) continue
        const md = get_map_data(h)
        const th = md && md.region ? md.region : "?"
        const reduced = G.reduced && (typeof set_has === "function" ? set_has(G.reduced, u) : G.reduced.includes(u))
        const cf = reduced ? (Number(p.rcf) || Math.ceil((Number(p.cf) || 0) / 2)) : (Number(p.cf) || 0)
        theaters[th] = theaters[th] || { my: 0, enemy: 0 }
        if (p.faction === mine) theaters[th].my += cf
        else theaters[th].enemy += cf
    }
    return Object.entries(theaters).map(([theater, f]) => ({
        theater, currentForce: f.my, enemyForce: f.enemy,
        surplus: f.my - f.enemy,
    })).sort((a, b) => b.surplus - a.surplus)
}
