// ============================================================================
// ERASMUS_PLUS 计划层 (改进计划 v1.0 §6/§10/§11) — erasmus_plan.js
// OffensivePlan + 目标集合价值密度分配(贪心→beam)。计划 v1.0 §22 文件职责。
// ============================================================================
"use strict"

"use strict"









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
        // §19 DESPERATE(T11/12) 资源格紧急加权: 原子弹/封锁门槛的最后通路,
        // 实测 20260905 差一个资源格即胜的局存在 —— 末盘资源夺取是最高价值动作。
        if (ps.posture === "DESPERATE" && role === "Allies") {
            const mDr = (typeof get_map_data === "function") ? get_map_data(h) : null
            if (mDr && mDr.resource) value *= 2.5
        }
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
        // §11 PlanScore = ObjectiveValue×P + 交换价值(§18 稀缺度) − 失败成本
        // 交换价值: OVERMATCH/PRESSURE 姿态下敌军损失价值加权(计划 §5 效果项)
        let trade = 0
        try {
            const defenders = (view?.ai?.units || []).filter(u => u.faction !== mine && u.location === h)
            if (defenders.length) {
                const enemyLoss = defenders.reduce((s2, u) => s2 + (u.cf || 0) * (typeof ep_unit_scarcity === "function" ? ep_unit_scarcity(u, 1 - mine) : 0.5), 0)
                trade = enemyLoss * (ps.posture === "OVERMATCH" ? 0.15 : ps.posture === "PRESSURE" ? 0.08 : 0)
            }
        } catch (e) {}
        const planScore = value * (pWin > 0 ? Math.max(pWin, 0.15) : 0.5) + trade
            - (pWin > 0 && pWin < th.min ? value * (th.min - pWin) * 0.5 : 0)
        const density = planScore * urgency
        scored.push({ hex: h, mode, value: Number(value.toFixed(1)), pWin: Number(pWin.toFixed(2)), density: Number(density.toFixed(2)) })
    }
    scored.sort((a, b) => b.density - a.density || a.hex - b.hex)
    // [opt chain_prereq] 前置跳板闸门(战役层): 无前置跳板的纵深目标(己控相邻/陆路连通/
    // 己控港口机场≤emChainPrereqDist/己方地面在旁 四者皆无)降权后移, 让价值密度序先在
    // 已达战程的目标上编组; 只重排不删除(全部无前置 → 原序), 且只影响 focus 取用顺序,
    // 不删目标、不改 detail 数值。flag 关 = scored 原序(逐位一致)。
    if (emc.chain_prereq && scored.length > 1 && typeof eop_chain_prereq_defer === "function") {
        const byHex = new Map()
        for (const s of scored) {
            if (!byHex.has(s.hex)) byHex.set(s.hex, [])
            byHex.get(s.hex).push(s)
        }
        const ordered = eop_chain_prereq_defer(role, scored.map(s => s.hex))
        const reordered = []
        for (const h of ordered) {
            const bucket = byHex.get(h)
            if (bucket && bucket.length) reordered.push(bucket.shift())
        }
        if (reordered.length === scored.length) for (let i = 0; i < reordered.length; ++i) scored[i] = reordered[i]
    }
    const plan = { role, turn: Number(G.turn || 0), posture: ps.posture, urgency,
        thresholds: th, force: { myForward: ps.myForward, enForward: ps.enForward },
        queue: scored.map(x => x.hex), detail: scored, budget: budget || null }
    if (typeof ep_trace_plan === "function") ep_trace_plan(plan)
    return plan
}


if (typeof module === "undefined" || !module.exports) { /* bundle 内联, 无导出 */ }
