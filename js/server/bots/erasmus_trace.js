// ERASMUS_PLUS 计划诊断 (改进计划 §24 Trace 模板) — 供对局审计与"为什么不打"解释。
"use strict"

let EP_LAST_PLAN = null

function ep_trace_plan(plan) {
    EP_LAST_PLAN = plan
    if (typeof process !== "undefined" && process.env && process.env.EOTS_PLUS_DEBUG) {
        try {
            const nm = h => { try { return get_map_data(h).name || String(h) } catch (e) { return String(h) } }
            console.log(`[PLUS] T${plan.turn} ${plan.role} posture=${plan.posture} urgency=${plan.urgency} ` +
                `queue=[${plan.queue.slice(0, 5).map(nm).join(" > ")}] ` +
                `detail=[${plan.detail.slice(0, 3).map(d => `${nm(d.hex)}:${d.mode}:P${d.pWin}:v${d.value}`).join(", ")}]`)
        } catch (e) { /* 诊断失败不影响决策 */ }
    }
}

function ep_last_plan() { return EP_LAST_PLAN }

// 决策轨迹附加: erasmus.js 在 sm 轨迹上挂 plan 摘要(为什么打/为什么不打)。
function ep_trace_of(role) {
    const plan = EP_LAST_PLAN
    if (!plan || plan.role !== role) return null
    return {
        plus: true, posture: plan.posture, urgency: plan.urgency,
        queue: plan.queue.slice(0, 6),
        detail: plan.detail.slice(0, 6).map(d => ({ hex: d.hex, mode: d.mode, pWin: d.pWin, value: d.value })),
    }
}
