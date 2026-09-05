"use strict"
// 探针: 定位反应/移动窗死循环根因——滚动记录最近动作(含单位类型/位置/行动参数)。
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const seed = Number(process.argv[2] || 20260905)
const maxActions = Number(process.argv[3] || 60000)
let state
try { state = rules.setup(seed, scenario, { headless_moves: true }) } catch (e) { console.log("setup-error", e.message); process.exit(1) }
function activeRole(s) { return Array.isArray(s.active) ? s.active.slice().sort()[0] : s.active }
function cls(u) { try { const p = rules.pieces ? rules.pieces[u] : null; return p ? p.class : "?" } catch (e) { return "?" } }
function loc(u) { try { return state.location[u] } catch (e) { return "?" } }
let actions = 0
const trace = []
let stuck = null
try {
  while (state.active !== "None" && actions < maxActions) {
    const role = activeRole(state)
    const view = rules.view(state, role)
    const legal = Object.keys(view.actions || {}).filter(a => !["undo","redo"].includes(a) && (Array.isArray(view.actions[a]) ? view.actions[a].length > 0 : Boolean(view.actions[a])))
    if (!legal.length) { stuck = { t: state.turn, role, prompt: view.prompt, actions: Object.keys(view.actions||{}), unselect: view.unselect }; break }
    const d = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
    if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
    const u = (state.active_stack && state.active_stack[0]) || (Array.isArray(view.unselect) && view.unselect[0]) || null
    const legalStr = Object.keys(view.actions||{}).filter(a=>!["undo","redo"].includes(a)).map(a=>`${a}${Array.isArray(view.actions[a])?"["+view.actions[a].length+"]":""}`).join(",")
    trace.push(`T${state.turn} ${role.slice(0,3)} [${d.action}]${d.argument!==undefined?":"+d.argument:""} u=${u}(cls=${u!==null?cls(u):"-"},loc=${u!==null?loc(u):"-"}) legal={${legalStr}} | ${String(view.prompt||"").slice(0,45)}`)
    if (trace.length > 40) trace.shift()
    state = rules.action(state, role, d.action, d.argument)
    actions++
  }
} catch (e) { console.log("err", e.message); }
console.log(`== seed ${seed} == endT ${state.turn} win ${state.result} actions ${actions} hitMax=${actions>=maxActions}`)
if (stuck) { console.log("STUCK:", stuck.t, stuck.role, JSON.stringify(String(stuck.prompt).slice(0,90)), "actions=", JSON.stringify(stuck.actions), "unselect=", JSON.stringify(stuck.unselect)) }
console.log("--- last actions ---")
for (const l of trace) console.log("  " + l)
