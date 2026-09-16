"use strict"

// 诊断: 会战"添油式"取证 —— 每场主动发起会战的投入单位数 / 双方火力 / 结果
// 用法: EOTS_HEADLESS_MOVES=1 node tests/_diag_conc.js <count> <baseSeed> [japanBot] [alliesBot] [tag]
const fs = require("fs")
const path = require("path")
const rules = require("../rules.js")

const gameCount = Number(process.argv[2] || 15)
const baseSeed = Number(process.argv[3] || 20260910)
const japanBotName = String(process.argv[4] || "erasmus-v2-opt")
const alliesBotName = String(process.argv[5] || "erasmus-v2-opt")
const tag = String(process.argv[6] || "")
const scenario = "1942-1945 (The Shortened Campaign)"

const bots = { Japan: rules.bots[japanBotName], Allies: rules.bots[alliesBotName] }

function sideOfFaction(f) { return f === 0 ? "Japan" : "Allies" }

function parseBattles(log) {
    const battles = []
    let cur = null
    const newBattle = (side, hex) => { cur = { side, hex, attUnits: null, defUnits: null, attFire: [], defFire: [], naval: null, ground: null, amphibFail: 0, lines: [] }; battles.push(cur) }
    for (let i = 0; i < log.length; ++i) {
        const line = String(log[i])
        let m
        if ((m = line.match(/^%(J|A)Battle hex [A-Z]+ \(H(\d+)\)/))) { newBattle(m[1] === "J" ? "Japan" : "Allies", Number(m[2])); continue }
        if (!cur) continue
        if ((m = line.match(/&[AJ](?:AP|JP) fire \((\d+)\)\./))) {
            // &[AJ] 前缀 = 当前会战的进攻方; 其后 AP/JP 才是开火方
            const who = /&[AJ]AP fire/.test(line) ? "Allies" : "Japan"
            if (who === cur.side) cur.attFire.push(Number(m[1])); else cur.defFire.push(Number(m[1]))
            continue
        }
        if ((m = line.match(/^&[AJ]Attacker: \^(\d+) units\|/))) { cur.attUnits = Number(m[1]); continue }
        if ((m = line.match(/^&[AJ]Defender: \^(\d+) units\|/))) { cur.defUnits = Number(m[1]); continue }
        if ((m = line.match(/^&[AJ](\d+) units could not participate ground combat/))) { cur.amphFail++; continue }
        if (/^&[AJ](Defender|Attacker) won battle \((\d+) - (\d+)\)/.test(line)) {
            const mm = line.match(/^&[AJ](Defender|Attacker) won battle \((\d+) - (\d+)\)/)
            cur.naval = { attackerWon: mm[1] === "Attacker", aP: Number(mm[2]), dP: Number(mm[3]) }
            continue
        }
        if (/^&[AJ](Attacker|Defender) won in ground combat/.test(line)) {
            cur.ground = { attackerWon: /Attacker won/.test(line) }
            continue
        }
        if (/Amphibious Assault failed/.test(line)) { cur.amphibFail++; continue }
    }
    return battles
}

function play(seed) {
    let state
    try { state = rules.setup(seed, scenario, { headless_moves: true }) }
    catch (e) { return { seed, status: "setup-error", error: e.message } }
    const role = { Japan: {}, Allies: {} }
    for (const s of ["Japan", "Allies"]) { role[s] = { attacksInitiated: 0, groundAttacksWon: 0, groundDefensesHeld: 0, navalBattlesWon: 0, navalBattlesLost: 0, capturedHexes: 0 } }
    let curAttacker = null, logIndex = 0, actions = 0
    const JP_CONTROLLED = 1 << 23
    let prevCtrl = state.supply_cache.slice()
    const scan = () => {
        for (; logIndex < state.log.length; ++logIndex) {
            const line = String(state.log[logIndex]); let m
            if ((m = line.match(/^%(J|A)Battle hex/))) { curAttacker = m[1] === "J" ? "Japan" : "Allies"; role[curAttacker].attacksInitiated++ }
            else if (/Attacker won in ground combat/.test(line)) { if (curAttacker) role[curAttacker].groundAttacksWon++ }
            else if (/Defender won in ground combat/.test(line)) { if (curAttacker) role[curAttacker === "Japan" ? "Allies" : "Japan"].groundDefensesHeld++ }
            else if (/ won battle \(/.test(line)) {
                const aw = /^&?[AJ]?Attacker/.test(line)
                const w = aw ? curAttacker : (curAttacker === "Japan" ? "Allies" : "Japan")
                const l = aw ? (curAttacker === "Japan" ? "Allies" : "Japan") : curAttacker
                if (w && l) { role[w].navalBattlesWon++; role[l].navalBattlesLost++ }
            }
        }
    }
    try {
        while (state.active !== "None" && actions < 60000) {
            const r = Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
            const view = rules.view(state, r)
            const d = bots[r].decide(view, { role: r, seed, actionOrdinal: actions + 1 })
            if (!view.actions || !(d.action in view.actions)) throw new Error(`illegal ${d.action} @ ${view.prompt}`)
            state = rules.action(state, r, d.action, d.argument)
            actions++
            for (let h = 1; h < Math.min(prevCtrl.length, state.supply_cache.length); ++h) {
                const w = (prevCtrl[h] & JP_CONTROLLED) !== 0, i2 = (state.supply_cache[h] & JP_CONTROLLED) !== 0
                if (w && !i2) role.Allies.capturedHexes++
                else if (!w && i2) role.Japan.capturedHexes++
            }
            prevCtrl = state.supply_cache.slice()
            scan()
        }
    } catch (e) { return { seed, status: "error", error: e.message, actions } }
    if (state.active !== "None") return { seed, status: "action-limit", actions }
    const battles = parseBattles(state.log)
    return { seed, status: "complete", actions, turn: Number(state.turn || 0), winner: state.result?.won_side || null,
        role, battles, logs: state.log }
}

const games = []
for (let i = 0; i < gameCount; ++i) {
    const r = play(baseSeed + i)
    games.push(r)
    process.stderr.write(`\r${i + 1}/${gameCount} ${r.status} seed=${r.seed} battles=${r.battles ? r.battles.length : "-"} `)
}
process.stderr.write("\n")

const all = []
for (const g of games) if (g.battles) for (const b of g.battles) all.push({ seed: g.seed, ...b })

const stat = (arr) => {
    if (!arr.length) return { n: 0 }
    const s = arr.slice().sort((a, b) => a - b)
    const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
    return { n: arr.length, mean: Number((arr.reduce((x, y) => x + y, 0) / arr.length).toFixed(2)), median: med,
        min: s[0], max: s[s.length - 1], p25: s[Math.floor(s.length * 0.25)], p75: s[Math.floor(s.length * 0.75)] }
}
const out = { tag, gameCount, baseSeed, japanBot: japanBotName, alliesBot: alliesBotName }
out.games = { complete: games.filter(g => g.status === "complete").length, errors: games.filter(g => g.status === "error").length,
    actionLimit: games.filter(g => g.status === "action-limit").length,
    winners: games.filter(g => g.status === "complete").reduce((a, g) => { a[g.winner] = (a[g.winner] || 0) + 1; return a }, {}) }
out.role = {}
for (const side of ["Japan", "Allies"]) {
    const r = { attacksInitiated: 0, groundAttacksWon: 0, groundDefensesHeld: 0, navalBattlesWon: 0, navalBattlesLost: 0, capturedHexes: 0 }
    for (const g of games) if (g.role) for (const k of Object.keys(r)) r[k] += g.role[side][k]
    r.winRate = r.attacksInitiated ? Number(((r.groundAttacksWon + r.navalBattlesWon) / r.attacksInitiated).toFixed(3)) : null
    out.role[side] = r
}
// 按进攻方分组的会战规模
out.battles = {}
for (const side of ["Japan", "Allies"]) {
    const bs = all.filter(b => b.side === side)
    const attU = bs.map(b => b.attUnits).filter(x => x !== null)
    const defU = bs.map(b => b.defUnits).filter(x => x !== null)
    const diff = bs.filter(b => b.attFire.length && b.defFire.length).map(b => Math.max(...b.attFire) - Math.max(...b.defFire))
    const diffSum = bs.filter(b => b.attFire.length && b.defFire.length).map(b => b.attFire.reduce((a, c) => a + c, 0) - b.defFire.reduce((a, c) => a + c, 0))
    const won = bs.filter(b => (b.ground && b.ground.attackerWon) || (b.naval && b.naval.attackerWon))
    const lost = bs.filter(b => (b.ground && !b.ground.attackerWon) || (b.naval && !b.naval.attackerWon))
    out.battles[side] = {
        count: bs.length,
        attUnits: stat(attU), defUnits: stat(defU),
        attUnits_hist: attU.reduce((a, x) => { a[x] = (a[x] || 0) + 1; return a }, {}),
        fireDiffMax: stat(diff), fireDiffSum: stat(diffSum),
        attackerWonAny: won.length, attackerLostAny: lost.length,
        wonAny_attUnits: stat(won.map(b => b.attUnits).filter(x => x !== null)),
        lostAny_attUnits: stat(lost.map(b => b.attUnits).filter(x => x !== null)),
        wonAny_fireDiff: stat(won.filter(b => b.attFire.length && b.defFire.length).map(b => Math.max(...b.attFire) - Math.max(...b.defFire))),
        lostAny_fireDiff: stat(lost.filter(b => b.attFire.length && b.defFire.length).map(b => Math.max(...b.attFire) - Math.max(...b.defFire))),
        amphibFail: bs.reduce((a, b) => a + b.amphibFail, 0),
        noUnitsLogged: bs.filter(b => b.attUnits === null).length,
    }
}
const p = path.join(__dirname, "results", `_diag_conc-${gameCount}-${baseSeed}-${tag || "run"}.json`)
fs.mkdirSync(path.dirname(p), { recursive: true })
fs.writeFileSync(p, JSON.stringify(out, null, 1))
console.log(JSON.stringify(out, null, 1))
console.log("WROTE " + p)
