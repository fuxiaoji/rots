"use strict"

// 空攻势归因: 每次 "No battle hexes declared" 记录其上下文(哪一方/卡/HQ/激活单位类别/
// 是否有地面/海军/航空), 用于定位真正的成因。用法:
//   EOTS_HEADLESS_MOVES=1 node tests/_diag_empty_off.js [seed] [scenario]

const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2-opt"]
const seed = Number(process.argv[2] || 20260910)
const scenario = String(process.argv[3] || "1942-1945 (The Shortened Campaign)")
const ar = x => Array.isArray(x.active) ? x.active.slice().sort()[0] : x.active

let state = rules.setup(seed, scenario, { headless_moves: true })
let actions = 0
let logIndex = 0
const events = []
let pending = null // 当前攻势上下文

while (state.active !== "None" && actions < 80000) {
    const role = ar(state)
    const view = rules.view(state, role)
    const d = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
    state = rules.action(state, role, d.action, d.argument)
    ++actions
    for (; logIndex < state.log.length; ++logIndex) {
        const line = String(state.log[logIndex])
        let m
        if ((m = line.match(/^#([A-Z])([A-Za-z ]+) Action/))) { pending = { side: m[1] === "A" ? "Allies" : "Japan", turn: state.turn, card: null, hq: null, activated: [], lines: [] } }
        if (/^C\d+ played/.test(line) && pending) pending.card = line
        if (/^P\d+ activated for offensive/.test(line) && pending) pending.hq = line
        else if ((m = line.match(/^Activated \^(\d+) units\|([^^]*)\^/)) && pending) pending.activated.push({ n: Number(m[1]), ids: m[2] })
        if (pending && pending.lines.length < 14) pending.lines.push(line)
        if (/No battle hexes declared/.test(line) && pending) {
            const allIds = pending.activated.flatMap(a => a.ids.split(",").map(s => Number(s.trim())))
            const cls = { ground: 0, naval: 0, air: 0, hq: 0, other: 0 }
            for (const id of allIds) { const p = rules.pieces[id]; if (!p) continue; cls[p.class] = (cls[p.class] || 0) + 1 }
            events.push({ ...pending, allIds, cls })
            pending = null
        }
    }
}

const bySide = {}
for (const e of events) {
    const k = e.side + (e.cls.ground ? "+G" : "") + (e.cls.naval ? "+N" : "") + (e.cls.air ? "+A" : "")
    bySide[k] = (bySide[k] || 0) + 1
}
console.log(`seed ${seed}: "No battle hexes declared" 共 ${events.length} 次`)
console.log("按方/兵种构成:", JSON.stringify(bySide, null, 1))
console.log("\n前 6 次完整上下文:")
for (const e of events.slice(0, 6)) {
    console.log(`--- T${e.turn} ${e.side} | ${e.card} | ${e.hq} | 激活=${JSON.stringify(e.activated)} | 兵种=${JSON.stringify(e.cls)}`)
    for (const l of e.lines.slice(0, 10)) console.log("     ", l.slice(0, 110))
}
