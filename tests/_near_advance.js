"use strict"
// 临时侦察: 重放完整剧本自对局, 量化“盟军有没有反攻、离日本本土(region=Japan)最近多远”。
// 盟军可移动单位(地面/海军/HQ, 排除静态驻防与纯空军)取其全游戏最小六角格距离(邻接 BFS);
// 另统计盟军会战申报空袭目标格离本土最近距离, 以及终局回合/政治意志/胜负行。只读地图与状态, 不改引擎。
const path = require("path")
const vm = require("vm")
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const seeds = (process.argv[2] || "20260903,20260905,20260924,20260933,20260946,20260952").split(",").map(Number)
const maxActions = 60000
const AP = 1 // 盟军阵营号(pieces[u].faction)

/* 静态表: 地图邻接/区域/名称 + 单位表(vm 单次加载 rules.js, 只读) */
const mod = { exports: {} }
const ctx = vm.createContext({ module: mod, exports: mod.exports, console, process })
ctx.globalThis = ctx
vm.runInContext(require("fs").readFileSync(path.join(__dirname, "..", "rules.js"), "utf8"), ctx, { filename: "rules.js" })
const pr = s => vm.runInContext(s, ctx)
const MAP = pr("MAP_DATA")
const int_to_hex = h => { try { return pr(`int_to_hex(${h})`) } catch (e) { return String(h) } }
const pieces = pr("pieces")
const N = MAP.length

/* 多源 BFS: 每格到 region==="Japan" 的最近六角格步数 */
const HOME = []
for (let i = 0; i < N; i++) if (MAP[i] && MAP[i].region === "Japan") HOME.push(i)
const distHome = new Int32Array(N).fill(9999)
{
    const q = HOME.slice()
    for (const h of HOME) distHome[h] = 0
    for (let qi = 0; qi < q.length; qi++) {
        const h = q[qi]
        for (const nb of MAP[h].nh || []) if (nb >= 0 && nb < N && distHome[nb] === 9999) { distHome[nb] = distHome[h] + 1; q.push(nb) }
    }
}
const hexInfo = h => {
    if (!(h >= 0 && h < N) || !MAP[h]) return { label: `H${h}(offmap)`, region: null, name: null }
    const d = MAP[h]
    return { label: `H${int_to_hex(h)}${d.name ? " " + d.name : ""}`, region: d.region, name: d.name }
}
function activeRole(state) { return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active }

function replay(seed) {
    let state = rules.setup(seed, scenario, {})
    const minPerUnit = new Map() // u -> {dist,turn,hex}
    const best = { unit: null, dist: 9999, turn: 0, hex: -1, name: "", label: "", region: null }
    const bestStrike = { dist: 9999, turn: 0, hex: -1, label: "", region: null, act: 0 }
    const scanUnits = () => {
        const loc = state.location
        if (!loc) return
        const turn = Number(state.turn || 0)
        for (let u = 0; u < loc.length; u++) {
            const h = loc[u]
            if (h === undefined || h === null || !(h >= 0 && h < N)) continue
            const p = pieces[u]
            if (!p || p.faction !== AP) continue
            if (p.class !== "ground" && p.class !== "naval" && p.class !== "hq") continue
            if (p.class === "ground" && /garrison/i.test(p.name || "")) continue
            const d = distHome[h]
            if (d >= 9999) continue
            const cur = minPerUnit.get(u)
            if (!cur || d < cur.dist) minPerUnit.set(u, { dist: d, turn, hex: h })
        }
    }
    let prevTurn = -1
    let actions = 0
    try {
        while (state.active !== "None" && actions < maxActions) {
            const role = activeRole(state)
            const view = rules.view(state, role)
            const prompt = String(view.prompt || "")
            const turn = Number(state.turn || 0)
            if (turn !== prevTurn) { prevTurn = turn; scanUnits() } // 每回合起始采样一次位置
            const decision = policy.decide(view, { role, seed, actionOrdinal: actions + 1 })
            if (role === "Allies" && /Declare battle hexes/.test(prompt) && decision.action === "action_hex") {
                const hex = Number(decision.argument)
                if (Number.isInteger(hex) && hex >= 0 && hex < N) {
                    const d = distHome[hex]
                    if (d < bestStrike.dist) { const inf = hexInfo(hex)
                        bestStrike.dist = d; bestStrike.turn = turn; bestStrike.hex = hex; bestStrike.label = inf.label; bestStrike.region = inf.region; bestStrike.act = actions }
                }
            }
            state = rules.action(state, role, decision.action, decision.argument)
            ++actions
        }
        scanUnits()
        for (const [u, rec] of minPerUnit) {
            if (rec.dist < best.dist) {
                const inf = hexInfo(rec.hex)
                best.unit = (pieces[u] && pieces[u].name) || "unit" + u
                best.dist = rec.dist; best.turn = rec.turn; best.hex = rec.hex; best.label = inf.label; best.region = inf.region
            }
        }
    } catch (e) { return { seed, status: "error", error: e.message } }
    const pw = state.political_will
    const victoryLines = (state.log || []).filter(l => /VP|Victory|Treaty|Total VP|invasion|atomic/i.test(l)).slice(-10)
    return {
        seed, status: state.active === "None" ? "complete" : "action-limit",
        endTurn: Number(state.turn || 0), pw,
        best, bestStrike, victoryLines,
    }
}

const out = seeds.map(replay)
for (const r of out) process.stderr.write(`\r${r.seed} ${r.status} endT=${r.endTurn} bestDist=${r.best && r.best.dist} strikeDist=${r.bestStrike && r.bestStrike.dist} pw=${r.pw}`)
process.stderr.write("\n")
console.log(JSON.stringify(out, null, 1))
