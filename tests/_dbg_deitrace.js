// DEI/Malaya 投降链追踪: 逐回合记录日本控制的 DEI/MALAYA/PHILIPPINES keys。
// 用法: node tests/_dbg_deitrace.js <seed> [count]
"use strict"
const rules = require("../rules.js")
const scenario = "1942-1945 (The Shortened Campaign)"
const bots = { Japan: rules.bots["erasmus-v2-opt"], Allies: rules.bots["erasmus-v2-opt"] }
const JP_CONTROLLED = 1 << 23
const hex_to_int = i => (Math.floor(i / 100) - 10) * 29 + i % 100
const DEI_KEYS = [2019, 1813, 1916, 2017, 2415, 2616, 2517, 2220]
const MAL_KEYS = [2014, 2015]
const PHI_KEYS = [2813, 2915]
const NAMES = { 2019: "Tjilatjap", 1813: "Medan", 1916: "Palembang", 2017: "Bangka", 2415: "Miri",
    2616: "Tarakan", 2517: "Balikpapan", 2220: "Soerabaja", 2014: "Kuantan", 2015: "Singapore",
    2813: "Manila", 2915: "Davao" }

function keysHeld(state, keys) {
    return keys.filter(k => (state.supply_cache[hex_to_int(k)] & JP_CONTROLLED) !== 0)
}

const seed0 = Number(process.argv[2] || 20260903)
const count = Number(process.argv[3] || 1)
for (let gi = 0; gi < count; ++gi) {
    const seed = seed0 + gi
    let state = rules.setup(seed, scenario, { headless_moves: true })
    let actions = 0
    let lastTurn = 0
    const trace = []
    let captureByTurn = { Allies: {}, Japan: {} }
    let prevSupply = state.supply_cache.slice()
    const flush = t => {
        const dei = keysHeld(state, DEI_KEYS).map(k => NAMES[k])
        trace.push({ turn: t, dei: dei.join(","), deiN: dei.length,
            mal: keysHeld(state, MAL_KEYS).map(k => NAMES[k]).join(","),
            phi: keysHeld(state, PHI_KEYS).map(k => NAMES[k]).join(","), })
    }
    while (state.active !== "None" && actions < 60000) {
        const role = Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
        if (role !== "Japan" && role !== "Allies") break
        const t = Number(state.turn || 0)
        if (t !== lastTurn) { if (lastTurn > 0) flush(lastTurn); lastTurn = t }
        // capture diff
        const n = Math.min(prevSupply.length, state.supply_cache.length)
        for (let h = 1; h < n; ++h) {
            const was = (prevSupply[h] & JP_CONTROLLED) !== 0, is = (state.supply_cache[h] & JP_CONTROLLED) !== 0
            if (was && !is) captureByTurn.Allies[t] = (captureByTurn.Allies[t] || 0) + 1
            else if (!was && is) captureByTurn.Japan[t] = (captureByTurn.Japan[t] || 0) + 1
        }
        prevSupply = state.supply_cache.slice()
        const view = rules.view(state, role)
        const decision = bots[role].decide(view, { role, seed, actionOrdinal: actions + 1 })
        state = rules.action(state, role, decision.action, decision.argument)
        actions++
    }
    flush(lastTurn)
    console.log(`=== seed ${seed} actions=${actions} ===`)
    for (const t of trace)
        console.log(`T${t.turn} DEI(${t.deiN})[${t.dei}] MAL[${t.mal}] PHI[${t.phi}] | cap A=${captureByTurn.Allies[t.turn] || 0} J=${captureByTurn.Japan[t.turn] || 0}`)
    console.log(`surrender: DEI=${state.surrender[2]} MAL=${state.surrender[1]} PHI=${state.surrender[0]} winner=${state.result ? JSON.stringify(state.result) : "?"}`)
}
