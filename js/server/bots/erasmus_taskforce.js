// ============================================================================
// ERASMUS_PLUS 任务部队层 (改进计划 v1.0 §7/§9/§13) — erasmus_taskforce.js
// AttackMode 分类 + P(capture) 评估 + Exploitation 扫荡/连续占领路径。
// ============================================================================
"use strict"

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
    // [opt amph-coast] 沿海敌控格(非仅 port)都可能是两栖登陆(Medan 等 DEI key 无 port 标记)
    if ((md.port || md.coastal) && !ep_land_reachable(target, mine)) return "AMPHIBIOUS_ASSAULT"
    return "GROUND_ATTACK"
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

// ============================================================================
// §18 Exchange Logic: 单位稀缺度(0-1 归一)。日本 CV/精锐航空高稀缺; 盟军后期
// 普通地面低稀缺; 双方 notreplaceable 高。TradeScore = 敌损价值 − 我损价值。
// ============================================================================
function ep_unit_scarcity(u, side) {
    if (!u) return 0.5
    const type = String(u.type || u.name || "").toUpperCase()
    let s = 0.4
    if (/^CV/.test(type)) s = 0.9                      // 航母: 双方均难补
    else if (/BB/.test(type)) s = 0.7
    else if (side === JP) s = 0.6                      // 日本地面: 补员弱
    else s = G.turn >= 9 ? 0.25 : 0.45                 // 盟军后期地面: 大量可补
    if (u.notreplaceable) s = Math.min(1, s + 0.3)
    if (u.reduced) s *= 0.8                            // 已减编单位残余价值低
    return s
}

// §9 Battle/Capture Probability Estimator: 输出全套期望量。
// args 与 em_ground_outcome/em_amphib_assessment 相同口径 + 双方单位表(scarcity 用)。
function ep_estimate_battle_outcome(args) {
    const out = { pWinCombat: 0, pCaptureTarget: 0, pLoseKeyGroundUnit: 0, pFailedAmphibiousAssault: 0,
        expectedFriendlyLoss: 0, expectedEnemyLoss: 0, expectedNetTrade: 0 }
    const g = em_ground_outcome({ attCF: args.attCF, defCF: args.defCF,
        attMods: args.attMods || 0, defMods: args.defMods || 0,
        attLfs: args.attLfs || [], defLfs: args.defLfs || [] })
    out.pWinCombat = g.pWin
    out.expectedFriendlyLoss = g.eOwnElim * 3 + g.eOwnDamaged * 1.5   // cf 加权近似
    out.expectedEnemyLoss = g.eEnemyElim * 3 + g.eEnemyDamaged * 1.5
    if (args.amphibious) {
        const naval = em_naval_outcome({ attCF: args.attNavalCF || 0, defCF: args.defNavalCF || 0,
            attHasBr: args.attNavalHasBr !== false, defHasBr: args.defNavalHasBr })
        out.pFailedAmphibiousAssault = 1 - naval.pWin
        out.pCaptureTarget = naval.pWin * g.pWin
    } else {
        out.pCaptureTarget = g.pWin
    }
    // 关键地面单位损失概率: 攻方最大 cf 单位受损概率的代理
    if (args.attLfs && args.attLfs.length) {
        out.pLoseKeyGroundUnit = Math.min(1, g.eOwnElim / Math.max(1, args.attLfs.length))
    }
    out.expectedNetTrade = out.expectedEnemyLoss - out.expectedFriendlyLoss
    return out
}
