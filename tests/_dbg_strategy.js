"use strict"
// 定向策略侦察: headless_moves 下完整剧本, 归因盟军 0 胜。不修改引擎。
// 统一十六进制索引: 内部索引 idx = (⌊id/100⌋-10)*29 + id%100 (hex_to_int)。
// 引擎所有 log H#### / G.supply_cache / get_map_data 都按 idx。
const fs = require("fs")
const path = require("path")
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const scenario = "1942-1945 (The Shortened Campaign)"
const HEADLESS = process.env.EOTS_HEADLESS_MOVES !== "0"
const setupOptions = { headless_moves: HEADLESS }
const gameCount = Number(process.argv[2] || 8)
const baseSeed = Number(process.argv[3] || 20260903)
const maxActions = Number(process.argv[4] || 90000)

const idxOf = id => (Math.floor(id / 100) - 10) * 29 + (id % 100)
const JPBIT = 1 << 23
// JP_CONTROLLED=1<<23 (common/constants.js)

const MAP_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "common", "data_map.js"), "utf8")
function parseMap() {
    const byIdx = {} // idx -> {id, region, name, city, resource}
    const re = /\{\s*id:\s*(\d+)\s*,/g
    let m
    while ((m = re.exec(MAP_SRC))) {
        const id = +m[1]
        const start = MAP_SRC.indexOf("{", m.index)
        let depth = 0, j = start
        for (; j < MAP_SRC.length; j++) { const c = MAP_SRC[j]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) break } }
        const blk = MAP_SRC.slice(start, j + 1)
        const region = (blk.match(/region:\s*"([^"]+)"/) || [])[1]
        const name = (blk.match(/name:\s*"([^"]+)"/) || [])[1]
        const city = (blk.match(/city:\s*(\w+)/) || [])[1]
        if (!region && !name && !city && !/resource:\s*true/.test(blk)) continue
        const e = byIdx[idxOf(id)] || (byIdx[idxOf(id)] = { id })
        if (region) e.region = region
        if (name) e.name = name
        if (city) e.city = city
        if (/resource:\s*true/.test(blk)) e.resource = true
    }
    return byIdx
}
const MAP = parseMap()
const JP_CITY_IDX = Object.keys(MAP).filter(h => MAP[h].city === "JAPANESE_CITY").map(Number)
const REGIONS = {}
Object.keys(MAP).forEach(h => { const r = MAP[h].region; if (r) REGIONS[r] = (REGIONS[r] || 0) + 1 })
const HOME = ["Japan", "Korea", "Manchuria", "Sakhalin"].filter(r => REGIONS[r])
const MID = ["Marshall", "Caroline", "JMandates", "Philippines", "Formosa", "Okinawa"].filter(r => REGIONS[r])
const FAR = ["DEI", "Borneo", "Sumatra", "Java", "Celebes", "Guinea", "Australia", "AMandates", "Burma"].filter(r => REGIONS[r])

function activeRole(state) { return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active }
function jpAt(state, idx) { return !!(state.supply_cache && (state.supply_cache[idx] !== undefined) && (state.supply_cache[idx] & JPBIT)) }
function apControlsIdx(state, idx) { return (state.supply_cache && (state.supply_cache[idx] !== undefined)) && !(state.supply_cache[idx] & JPBIT) }
function regionControl(state, region) { let jp = 0, ap = 0, total = 0; for (const h of Object.keys(MAP)) { if (MAP[h].region !== region) continue; const i = +h; total++; if (jpAt(state, i)) jp++; else ap++ } return { jp, ap, total } }
function anyApJapaneseCity(state) { return JP_CITY_IDX.some(i => apControlsIdx(state, i)) }

function play(seed) {
    let state
    try { state = rules.setup(seed, scenario, setupOptions) } catch (e) { return { seed, status: "setup-error", error: e.message } }
    const g = { seed, status: "error", winner: null, endTurn: null, endMessage: null, actions: 0 }
    const apCap = [], jpCap = [] // 夺格 idx
    const pwCauses = []
    let powOk = 0, powFail = 0
    const keyLog = [] // 战略相关事件行
    const offense = { Japan: { act: 0, noBattle: 0, offensives: 0 }, Allies: { act: 0, noBattle: 0, offensives: 0 } }
    let curTurn = Number(state.turn || 0)
    try {
        while (state.active !== "None" && g.actions < maxActions) {
            const role = activeRole(state)
            if (role !== "Japan" && role !== "Allies") throw new Error(`unexpected active ${JSON.stringify(state.active)}`)
            const view = rules.view(state, role)
            const decision = policy.decide(view, { role, seed, actionOrdinal: g.actions + 1 })
            if (!view.actions || !(decision.action in view.actions)) throw new Error(`illegal ${decision.action} @ ${view.prompt}`)
            const preLen = state.log.length
            state = rules.action(state, role, decision.action, decision.argument)
            // 归因: 该动作新增的日志行属动作方
            for (const line of state.log.slice(preLen)) {
                if (/activated for offensive| launches offensive|declare battle|Declare battle/.test(line) && /activated/.test(line)) offense[role].act++
                if (/ activated for offensive\.$/.test(line)) offense[role].offensives++
                if (/No battle hexes declared/.test(line)) offense[role].noBattle++
            }
            g.actions++
            g.endTurn = Math.max(g.endTurn || 0, Number(state.turn || 0))
        }
    } catch (e) { return { seed, status: "error", winner: null, actions: g.actions, turn: g.endTurn, error: e.message } }
    if (state.active !== "None") return { seed, status: "action-limit", winner: null, actions: g.actions, turn: g.endTurn }
    const turnStart = (state.log || []).filter(l => /^@Turn \d+\./.test(l))
    for (const line of (state.log || [])) {
        let m = line.match(/^AP captured H(\d+)/)
        if (m) { apCap.push(+m[1]); continue }
        m = line.match(/^JP captured H(\d+)/)
        if (m) { jpCap.push(+m[1]); continue }
        if (/Political will changed/.test(line)) {
            m = line.match(/^Political will changed to \d+ \(([+-]?\d+)\) - ([^.]+)\./)
            pwCauses.push({ diff: m ? +m[1] : null, cause: m ? m[2].trim() : line })
        }
        if (/^Progress of War /.test(line)) { if (/>=/.test(line)) powOk++; else powFail++ }
        if (/activated for offensive|No battle hexes declared|fire \(|displaced|Political will|Progress of War|captured H\d+/.test(line)) keyLog.push(line)
    }
    const homeCtrl = {}
    HOME.forEach(r => homeCtrl[r] = regionControl(state, r))
    const midCtrl = {}; MID.forEach(r => midCtrl[r] = regionControl(state, r))
    const nameOf = i => { const e = MAP[i]; return e && e.name ? e.name : (e && e.region ? `${e.region}#${i}` : `?${i}`) }
    return {
        seed, status: "complete", winner: state.result, actions: g.actions, endTurn: g.endTurn,
        endMessage: state.L && state.L.message || null,
        finalPw: state.political_will, finalWie: state.wie,
        homeCtrl, midCtrl, apAnyCityFinal: anyApJapaneseCity(state),
        apCityEver: null, // 填充于下: 由 per-turn 扫描不可行(此处未采样), 用终态代表
        apCapCount: apCap.length, jpCapCount: jpCap.length,
        apCapSamples: apCap.map(i => `${i}:${nameOf(i)}`), jpCapSamples: jpCap.map(i => `${i}:${nameOf(i)}`),
        offense,
        pwCauses: pwCauses.reduce((m, c) => { const k = c.cause.replace(/\d+<\s*\d+$/, "X<Y"); m[k] = (m[k] || 0) + 1; return m }, {}),
        powOk, powFail, keyLogCount: keyLog.length, keyLog: keyLog.slice(-160), turnStarts: turnStart.length,
    }
}

const games = []
for (let i = 0; i < gameCount; ++i) {
    const r = play(baseSeed + i); games.push(r)
    const h = Object.entries(r.homeCtrl || {}).map(([k, v]) => `${k}${v.jp}/${v.ap}`).join(" ")
    process.stderr.write(`\r${i + 1}/${gameCount} seed=${r.seed} ${r.status} endT=${r.endTurn} win=${r.winner} pw=${r.finalPw} apCap=${r.apCapCount} ${h}`)
}
process.stderr.write("\n")
fs.mkdirSync(path.join(__dirname, "results"), { recursive: true })
const out = { policy: policy.version, scenario, gameCount, baseSeed, headless: HEADLESS, regions: REGIONS,
    home: HOME, mid: MID, generatedAt: new Date().toISOString(), games }
const p = path.join(__dirname, "results", `_strategy-${gameCount}-${baseSeed}${HEADLESS ? "-headless" : ""}.json`)
fs.writeFileSync(p, JSON.stringify(out, null, 2))
console.log("wrote", p)
console.log(JSON.stringify(games.map(x => ({ seed: x.seed, endT: x.endTurn, msg: x.endMessage, pw: x.finalPw, apCity: x.apAnyCityFinal, apCap: x.apCapCount, jpCap: x.jpCapCount, pow: `${x.powOk}/${x.powFail}`, pwCauses: x.pwCauses, home: x.homeCtrl, apSamples: x.apCapSamples.slice(0, 20) })), null, 1))
