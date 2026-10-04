"use strict"

// AI-WIN-01: pure, engine-independent accounting. Log indices are zero based.
const JP_CONTROLLED = 1 << 23
const HEX_CONTROLLABLE = 1 << 24
const AMPH_MOVE = 1 << 3
const LAST_BOARD_HEX = 1478
const METRIC_KEYS = ["decisions", "fire", "advance", "hqActivations", "airStrikeUnits", "airStrikeHexes",
    "attacksInitiated", "groundAttacksWon", "groundAttacksLost", "groundDefensesHeld", "groundDefensesLost", "groundDefensesFaced",
    "navalBattlesWon", "navalBattlesLost", "amphibAssaults", "amphibFailures", "amphibSuccess",
    "eliminations", "reductions", "cfEliminated", "cfReduced", "elimSteps", "capturedHexes", "lostHexes"]
const other = side => side === "Japan" ? "Allies" : "Japan"
const sideOf = faction => faction === 0 ? "Japan" : "Allies"
const emptyRole = () => Object.fromEntries(METRIC_KEYS.map(k => [k, 0]))
const controlledBy = (supply, hex) => (supply[hex] & JP_CONTROLLED) ? "Japan" : "Allies"
const retainedProgress = state => (state.capture || []).filter(h => controlledBy(state.supply_cache || [], h) === "Allies").length
function snapshot(state) {
    return { turn: state.turn, location: [...(state.location || [])], reduced: [...(state.reduced || [])],
        supply_cache: [...(state.supply_cache || [])], capture: [...(state.capture || [])], pow: state.pow,
        political_will: state.political_will, offensive: state.offensive ? JSON.parse(JSON.stringify(state.offensive)) : null }
}
function classifyEnd(state) {
    const text = [...(state.log || [])].reverse().find(s => /Victory|surrenders by atomic bomb|did not surrender|resign|abandon|timeout|manually|administrat/i.test(String(s))) || state.L?.message || null
    const winner = state.result?.won_side || (typeof state.result === "string" ? state.result : null)
    const finished = state.active === "None"
    const artificial = /resign|abandon|timeout|manually|administrat/i.test(text || "")
    const natural = finished && ["Japan", "Allies"].includes(winner) && !artificial && /Victory|surrenders by atomic bomb|Japan did not surrender/i.test(text || "")
    return { winner, won_text: text, natural, termination: !finished ? "unfinished" : artificial ? "artificial" : natural ? "natural" : "unknown",
        earlyTreatyDefeat: natural && winner === "Japan" && Number(state.turn) < 12 && /Treaty Negotiations/i.test(text || "") }
}
function captureRate(byTurn, startTurn, endTurn) {
    const values = Array.from({ length: Math.max(0, endTurn - startTurn + 1) }, (_, i) => byTurn[startTurn + i] || 0)
    return { mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0,
        max: Math.max(0, ...values), turnsWithCapture: values.filter(x => x > 0).length,
        startTurn, endTurn, denominator: values.length }
}
function battleRate(role) {
    const won = role.groundAttacksWon + role.groundDefensesHeld + role.navalBattlesWon
    const lost = role.groundAttacksLost + role.groundDefensesLost + role.navalBattlesLost
    return { won, lost, denominator: won + lost, rate: won + lost ? won / (won + lost) : null }
}

function createMetrics(pieces, initial) {
    const m = { startTurn: Number(initial.turn), turn: Number(initial.turn), role: { Japan: emptyRole(), Allies: emptyRole() },
        capByTurn: { Japan: {}, Allies: {} }, pwLog: [], powTurns: [], noBattleHex: 0, actSum: 0, actLimitSum: 0,
        surrenderTurns: {}, battles: [], amphibious: [], firstLandingFormation: null, firstExecutedLandingFormation: null, pwMin: Number(initial.political_will),
        warnings: [] }
    let prev = snapshot(initial), logIndex = 0, logTurn = m.startTurn, offense = "setup", currentBattle = null
    const attempts = new Map(), pow = new Map(), captureEvents = new Set()
    const row = turn => { if (!pow.has(turn)) pow.set(turn, { turn, required: null, retained: null, met: null, checked: false }); return pow.get(turn) }
    function discover(s, id, priorSupply) {
        const o = s.offensive
        if (!o || ![0, 1].includes(o.attacker)) return
        const side = sideOf(o.attacker)
        const add = (hex, units, fromBattle) => {
            if (!Number.isInteger(hex) || hex < 1 || hex >= LAST_BOARD_HEX || !units.length) return
            const key = `${id}:${hex}`
            if (!attempts.has(key) && controlledBy(priorSupply, hex) === side && !fromBattle) return
            if (!attempts.has(key)) attempts.set(key, { key, offense: id, side, turn: s.turn, hex, units: [], committed: false, resolved: false, success: false })
            const a = attempts.get(key)
            a.units = [...new Set([...a.units, ...units])]
            if (fromBattle) a.committed = true
        }
        const paths = o.paths || []
        const grouped = new Map()
        for (let i = 0; i < paths.length; i += 2) {
            const unit = paths[i], p = paths[i + 1]
            if (pieces[unit]?.class !== "ground" || pieces[unit]?.faction !== o.attacker || !Array.isArray(p) || !(p[0] & AMPH_MOVE) || p.length < 4) continue
            const hex = p[p.length - 1]
            if (!grouped.has(hex)) grouped.set(hex, [])
            grouped.get(hex).push(unit)
        }
        for (const [hex, units] of grouped) add(hex, units, false)
        if (o.battle?.amph_ground?.length) add(o.battle.battle_hex, o.battle.amph_ground, true)
    }
    function settle(id, supply, action) {
        for (const a of attempts.values()) if (a.offense === id && a.committed && !a.resolved) {
            a.resolved = true
            a.success = captureEvents.has(`${id}:${a.side}:${a.hex}`) || controlledBy(supply, a.hex) === a.side
            a.action = action
            m.role[a.side].amphibAssaults++
            m.role[a.side][a.success ? "amphibSuccess" : "amphibFailures"]++
            m.amphibious.push({ ...a, units: [...a.units] })
        }
    }
    function recordExecutedLanding(state, id, action) {
        if (m.firstExecutedLandingFormation || state.offensive?.attacker !== 1) return
        const o = state.offensive, paths = [], onboard = hex => Number.isInteger(hex) && hex > 0 && hex < LAST_BOARD_HEX
        for (let i = 0; i < (o.paths || []).length; i += 2) {
            const unit = o.paths[i], path = o.paths[i + 1], piece = pieces[unit]
            if (piece?.faction !== 1 || !Array.isArray(path) || path.length < 4) continue
            const origin = path[2], target = path[path.length - 1]
            if (!onboard(origin) || !onboard(target) || origin === target || state.location?.[unit] !== target) continue
            paths.push({ unit, kind: piece.class, amph: !!(path[0] & AMPH_MOVE), origin, target })
        }
        for (const path of paths) {
            // The attempt cache proves this destination was enemy-controlled when the
            // amphibious move began. A friendly transport is not a frontier landing.
            if (path.kind !== "ground" || !path.amph || !attempts.has(`${id}:${path.target}`)) continue
            const sameRoute = paths.filter(p => p.origin === path.origin && p.target === path.target)
            const ground = sameRoute.filter(p => p.kind === "ground" && p.amph).map(p => p.unit).sort((a, b) => a - b)
            const escort = sameRoute.filter(p => p.kind === "naval").map(p => p.unit).sort((a, b) => a - b)
            if (escort.length) {
                m.firstExecutedLandingFormation = { turn: Number(state.turn), action, target: path.target, ground, escort,
                    source: "executed-paths", origin: path.origin }
                return
            }
        }
        // The battle engine can still prove participation after movement paths
        // have been shortened. Remote committed ships are not physical escorts.
        const battle = o.battle, target = battle?.battle_hex
        if (!onboard(target)) return
        const present = (unit, kind) => pieces[unit]?.faction === 1 && pieces[unit]?.class === kind && state.location?.[unit] === target
        const ground = (battle.amph_ground || []).filter(unit => present(unit, "ground")).sort((a, b) => a - b)
        const escort = (battle.air_naval?.[1] || []).filter(unit => present(unit, "naval")).sort((a, b) => a - b)
        if (ground.length && escort.length) m.firstExecutedLandingFormation = { turn: Number(state.turn), action, target,
            ground, escort, source: "battle-participants" }
    }
    function observe(state, action = 0) {
        const lines = (state.log || []).slice(logIndex)
        let lastOffense = offense
        for (let j = 0; j < lines.length; j++) if (/^P\d+ activated for offensive\./.test(lines[j])) lastOffense = `log:${logIndex + j}`
        discover(prev, offense, prev.supply_cache)
        discover(state, lastOffense, prev.supply_cache)
        recordExecutedLanding(state, lastOffense, action)
        // Retained bank is diagnostic only; authoritative political-phase logs decide met/missed.
        const live = row(Number(state.turn))
        live.liveRequired = Number(state.pow || 0)
        live.liveRetained = retainedProgress(state)
        live.politicalWill = Number(state.political_will)
        for (let j = 0; j < lines.length; j++) {
            const raw = String(lines[j]), line = raw.replace(/^&[JA]/, ""), ix = logIndex + j
            let match
            if ((match = raw.match(/^@Turn (\d+)\./))) logTurn = Number(match[1])
            if (/^P\d+ activated for offensive\./.test(raw)) offense = `log:${ix}`
            if ((match = line.match(/^P(\d+) activated for (?:offensive|reaction)\./))) {
                const hq = pieces[Number(match[1])]
                if (hq?.class === "hq" && [0, 1].includes(hq.faction)) m.role[sideOf(hq.faction)].hqActivations++
            }
            if ((match = raw.match(/^%(J|A)Battle hex .*\(H(\d+)\)/))) {
                currentBattle = { logIndex: ix, turn: logTurn, side: match[1] === "J" ? "Japan" : "Allies", hex: Number(match[2]), groundResult: null, navalResult: null }
                m.battles.push(currentBattle)
                m.role[currentBattle.side].attacksInitiated++
                const a = attempts.get(`${offense}:${currentBattle.hex}`)
                if (a) a.committed = true
            }
            if (/^#GResolve battles/.test(raw)) for (const a of attempts.values()) if (a.offense === offense) a.committed = true
            if ((match = line.match(/^(AP|JP) captured(?: H(\d+)|:)/))) {
                const side = match[1] === "AP" ? "Allies" : "Japan"
                for (const h of line.matchAll(/H(\d+)/g)) captureEvents.add(`${offense}:${side}:${Number(h[1])}`)
            }
            if (currentBattle && (match = line.match(/^(Attacker|Defender) won in ground combat/)) && !currentBattle.groundResult) {
                const a = currentBattle.side, d = other(a), aw = match[1] === "Attacker"
                m.role[a][aw ? "groundAttacksWon" : "groundAttacksLost"]++
                m.role[d][aw ? "groundDefensesLost" : "groundDefensesHeld"]++
                m.role[d].groundDefensesFaced++
                currentBattle.groundResult = aw ? a : d
            }
            if (currentBattle && (match = line.match(/^(Attacker|Defender) won battle \(/)) && !currentBattle.navalResult) {
                const w = match[1] === "Attacker" ? currentBattle.side : other(currentBattle.side)
                m.role[w].navalBattlesWon++; m.role[other(w)].navalBattlesLost++
                currentBattle.navalResult = w
            }
            if ((match = line.match(/^(AP|JP) fire \(/))) m.role[match[1] === "AP" ? "Allies" : "Japan"].fire++
            if (/No battle hexes declared/.test(line)) m.noBattleHex++
            if ((match = line.match(/Political will changed to (\d+) \(([+-]?\d+)\)/))) m.pwLog.push({ turn: logTurn, pw: +match[1], delta: +match[2], logIndex: ix, reason: line })
            if ((match = line.match(/Progress of war target - (\d+)/i))) row(logTurn).required = +match[1]
            if (/No progress of war required|Progress of War not checked/i.test(line)) Object.assign(row(logTurn), { required: 0, checked: false, exempt: true })
            if ((match = line.match(/(?:current progress of war|Progress of War) (\d+) (>=|<) (\d+)/i))) Object.assign(row(logTurn), { required: +match[3], retained: +match[1], met: match[2] === ">=", checked: true, logIndex: ix })
            if ((match = line.match(/(Philippines|Malaya|Dutch East Ind\w+|Burma|India|China) surrender/))) m.surrenderTurns[match[1]] ??= logTurn
            if ((match = line.match(/Activated \^(\d+) units\|[^^]*\^, (\d+) limit\./))) { m.actSum += +match[1]; m.actLimitSum += +match[2] }
            if ((match = line.match(/#GTotal VP: (\d+)/))) m.vp = +match[1]
            if (raw === "#GPost battle movement") { settle(offense, state.supply_cache || [], action); currentBattle = null }
        }
        const curr = snapshot(state)
        for (let unit = 1; unit < curr.location.length; unit++) {
            const p = pieces[unit]
            if (!p) continue
            const r = m.role[sideOf(p.faction)], eliminated = loc => loc === 1482 || loc === 1485
            if (!eliminated(prev.location[unit]) && eliminated(curr.location[unit])) {
                r.eliminations++; r.cfEliminated += Number(p.cf || 0)
                r.elimSteps += p.one_step || prev.reduced.includes(unit) ? 1 : 2
            } else if (!eliminated(curr.location[unit]) && !prev.reduced.includes(unit) && curr.reduced.includes(unit)) {
                r.reductions++; r.cfReduced += Math.max(0, Number(p.cf || 0) - Number(p.rcf ?? Math.floor(Number(p.cf || 0) / 2)))
            }
        }
        for (let hex = 1; hex < Math.min(prev.supply_cache.length, curr.supply_cache.length, LAST_BOARD_HEX); hex++) {
            if (!((prev.supply_cache[hex] | curr.supply_cache[hex]) & HEX_CONTROLLABLE)) continue
            const before = controlledBy(prev.supply_cache, hex), after = controlledBy(curr.supply_cache, hex)
            if (before !== after) {
                m.role[after].capturedHexes++; m.role[before].lostHexes++
                // A next-turn transition still belongs to the turn whose action caused the capture.
                const turn = Number(prev.turn)
                m.capByTurn[after][turn] = (m.capByTurn[after][turn] || 0) + 1
            }
        }
        m.turn = Number(state.turn); m.pwMin = Math.min(m.pwMin, Number(state.political_will))
        logIndex = (state.log || []).length; prev = curr
        if (state.active === "None") settle(offense, state.supply_cache || [], action)
    }
    function recordDecision(role, decision, view, action) {
        let argument = decision.argument
        if (argument && typeof argument === "object" && argument.__ai) argument = argument.action
        const r = m.role[role]; r.decisions++
        if (decision.action === "advance") r.advance++
        if (/Declare battle hexes/.test(view.prompt || "")) {
            if (decision.action === "unit") r.airStrikeUnits++
            if (decision.action === "action_hex") r.airStrikeHexes++
        }
        const trace = decision.publicTrace || {}
        // Only an explicit planner feasibility result qualifies. Never infer readiness from activation counts.
        const formation = trace.campaign?.formation || trace.plan?.formation || trace.formation
        if (!m.firstLandingFormation && role === "Allies" && formation && typeof formation === "object" && formation.ready === true && formation.ground?.length && formation.escort?.length)
            m.firstLandingFormation = { turn: m.turn, action, target: formation.target ?? null, source: "publicTrace", formation }
    }
    function result(state) {
        const rows = [...pow.values()].sort((a, b) => a.turn - b.turn), checked = rows.filter(x => x.checked)
        const capRate = {}, rates = {}
        for (const side of ["Japan", "Allies"]) { capRate[side] = captureRate(m.capByTurn[side], m.startTurn, m.turn); rates[side] = battleRate(m.role[side]) }
        return { ...m, powTurns: rows, pow: { eligibleTurns: checked.length, metTurns: checked.filter(x => x.met).length,
            rate: checked.length ? checked.filter(x => x.met).length / checked.length : null, liveRequired: Number(state.pow || 0), liveRetained: retainedProgress(state) },
            capRate, battleRates: rates, netCaptures: { Japan: m.role.Japan.capturedHexes - m.role.Japan.lostHexes, Allies: m.role.Allies.capturedHexes - m.role.Allies.lostHexes }, ...classifyEnd(state) }
    }
    observe(initial)
    return { observe, recordDecision, result, metrics: m }
}
function analyzeLog(log, startTurn = 2) {
    const state = { turn: startTurn, log: [], location: [], reduced: [], supply_cache: [], capture: [], pow: 0, political_will: 8, active: "Allies" }
    const meter = createMetrics([], state)
    state.log = log
    const turns = log.map(x => /^@Turn (\d+)\./.exec(x)).filter(Boolean).map(x => +x[1])
    state.turn = Math.max(startTurn, ...turns)
    meter.observe(state)
    return meter.result(state)
}
function wilson(successes, n, z = 1.959963984540054) {
    if (!n) return { n: 0, successes, estimate: null, low: null, high: null }
    const p = successes / n, den = 1 + z * z / n, mid = (p + z * z / (2 * n)) / den
    const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return { n, successes, estimate: p, low: Math.max(0, mid - half), high: Math.min(1, mid + half) }
}
function pairedBootstrap(pairs, iterations = 10000, seed = 20261004) {
    if (!pairs.length) return { n: 0, estimate: null, low: null, high: null, iterations, seed }
    const diffs = pairs.map(([base, candidate]) => Number(candidate) - Number(base))
    let rng = seed >>> 0
    const rand = () => { rng = (Math.imul(1664525, rng) + 1013904223) >>> 0; return rng / 4294967296 }
    const samples = []
    for (let j = 0; j < iterations; j++) { let sum = 0; for (let i = 0; i < diffs.length; i++) sum += diffs[Math.floor(rand() * diffs.length)]; samples.push(sum / diffs.length) }
    samples.sort((a, b) => a - b)
    return { n: pairs.length, estimate: diffs.reduce((a, b) => a + b, 0) / diffs.length,
        low: samples[Math.floor(iterations * 0.025)], high: samples[Math.min(iterations - 1, Math.floor(iterations * 0.975))], iterations, seed }
}
module.exports = { METRIC_KEYS, JP_CONTROLLED, HEX_CONTROLLABLE, AMPH_MOVE, emptyRole, snapshot, retainedProgress,
    classifyEnd, captureRate, battleRate, createMetrics, analyzeLog, wilson, pairedBootstrap }
