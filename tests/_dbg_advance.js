"use strict"
// 侦察: headless_moves 开启下 1942 自对局卡死窗口/空窗。加载 rules.js, 完整打一局。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const seed = Number(process.argv[2] || 20260903)
const maxActions = Number(process.argv[3] || 30000)

function activeRole(state) {
    return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
}

let state = rules.setup(seed, scenario, { headless_moves: true })
const markers = {}
const trace = []
for (let a = 0; a < maxActions; a++) {
    const role = activeRole(state)
    if (role !== "Japan" && role !== "Allies") { console.log(`END role=${role}`); break }
    const view = rules.view(state, role)
    const p = String(view.prompt || "")
    const legalList = Object.keys(view.actions || {}).filter(k => {
        const v = view.actions[k]
        return ["undo", "redo", "awaiting"].includes(k) ? false : Array.isArray(v) ? v.length > 0 : Boolean(v)
    })
    let decision
    if (!legalList.length && view.actions && view.actions.awaiting !== undefined) {
        decision = { action: "awaiting", argument: undefined, publicTrace: { strategy: "HEADLESS_AWAIT" } }
    } else if (!legalList.length) {
        console.log(`\n=== NO LEGAL ACTION @ action ${a} role=${role} turn=${state.turn} ===`)
        console.log(`prompt: ${p}`)
        console.log(`active: ${JSON.stringify(state.active)} stage=${state.offensive && state.offensive.stage}`)
        console.log(`raw actions: ${JSON.stringify(view.actions)}`)
        console.log(`log tail:`)
        console.log((state.log || []).slice(-8).join("\n"))
        process.exit(0)
    } else {
        decision = policy.decide(view, { role, seed, actionOrdinal: a + 1 })
    }
    if (a > 6 && a < 34) {
        console.log(`\n--- action ${a} role=${role} turn=${state.turn} stage=${state.offensive && state.offensive.stage} attacker=${state.offensive && state.offensive.attacker} headless=${view.headless_moves}`)
        console.log(`prompt: ${p}`)
        console.log(`actions: ${JSON.stringify(view.actions)}`)
        console.log(`decision: ${JSON.stringify(decision.publicTrace)}`)
    }
    if (!view.actions || !(decision.action in view.actions)) { console.log(`ILLEGAL ${decision.action} @${p}`); process.exit(1) }
    for (const m of ["Resolve battles", "Post battle movement", "Offensive reaction", "Select action", "Play a card", "Declare battle", "choose HQ", "activate", "Move units", "reaction", "Intelligence", "Advance", "Replacements", "Political"]) {
        if (p.includes(m)) markers[m] = (markers[m] || 0) + 1
    }
    trace.push(`${a}\t${role}\tt${state.turn}\t${p.slice(0, 60)}\t=> ${decision.action}${String(decision.argument).slice(0, 24)}`)
    state = rules.action(state, role, decision.action, decision.argument)
    if (state.active === "None") { console.log(`COMPLETE turn=${state.turn} actions=${a}`); process.exit(0) }
}
console.log(`no hang within ${maxActions}; final active=${JSON.stringify(state.active)} turn=${state.turn} pw=${state.political_will}`)
console.log("markers:", JSON.stringify(markers, null, 0))
require("fs").writeFileSync(require("path").join(__dirname, "_dbg_trace.tsv"), trace.join("\n"))
console.log("trace written")
