"use strict"

// AI-WIN-01. Original positional CLI remains supported:
// EOTS_HEADLESS_MOVES=1 node tests/match-run.js <scenario> <count> <seed> [Japan bot] [Allies bot] [maxActions] [tag]
// EOTS_JAPAN_RULES / EOTS_ALLIES_RULES select independent bundles, including their server-side AI actions.
// EOTS_MATCH_OUTPUT_DIR writes incremental game JSON + JSONL; EOTS_RECORD_REPLAYS=all also records losses.
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const cp = require("child_process")
const Module = require("module")
const metrics = require("./campaign-metrics")
const { createOpeningMetrics } = require("./japan-opening-metrics")
const ROOT = path.resolve(__dirname, "..")
const RULE_VERSION = "official-16.2"
const ADAPTER_VERSION = "campaign-bundle-adapter-v1"
const DEFAULT_SCENARIO = "1942-1945 (The Shortened Campaign)"
// The old bundle has no config export. This in-memory shim reports the actual old behavior:
// em_set_config(profile) ignores numeric params in its first argument. No frozen file is changed.
const COMPAT_SOURCE = `\nexports.__campaignLegacyConfig = function(name) {
  var p = name === "erasmus-v2" ? {} : em_profile_from_env(name === "erasmus-v2-opt-v5" ? EM_DEFAULT_PROFILE_V5 : undefined);
  var c = Object.assign({}, EM_PARAMS_BASE); EM_FLAGS.forEach(function(f) { c[f] = p[f] ? 1 : 0; }); return c;
};
exports.__campaignRestoreLegacy = function(c) { em_set_config(c); em_reset_config(); };
`
const sha = input => crypto.createHash("sha256").update(input).digest("hex")
const fileSha = filename => sha(fs.readFileSync(filename))
const slug = value => String(value).replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "")
function activeRole(state) { return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active }
function configEnv() { return Object.fromEntries(Object.entries(process.env).filter(([k]) => /^EOTS_OPT_(PROFILE|PARAMS)/.test(k)
    || ["B_CRUISE", "B_BIAS", "EOTS_BATTLE_DECL_GATE_SHADOW"].includes(k))) }
function withConfigEnv(env, fn) {
    const previous = configEnv()
    for (const k of Object.keys(previous)) delete process.env[k]
    Object.assign(process.env, env)
    try { return fn() } finally {
        for (const k of Object.keys(configEnv())) delete process.env[k]
        Object.assign(process.env, previous)
    }
}
function loadBundle(filename, frozen = false, env = configEnv()) {
    filename = path.resolve(filename)
    const source = fs.readFileSync(filename, "utf8")
    const mod = new Module(filename, module)
    mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename))
    mod._compile(source + COMPAT_SOURCE, filename)
    const rules = mod.exports, effectiveEnv = frozen ? {} : { ...env }
    return { rules, filename, sha256: sha(source), frozen, env: effectiveEnv,
        call: fn => withConfigEnv(effectiveEnv, fn),
        config: (name, role) => withConfigEnv(effectiveEnv, () => rules.bot_config ? rules.bot_config(name, role) : rules.bots[name]?.getConfig ? rules.bots[name].getConfig(role) : rules.__campaignLegacyConfig(name)),
        restore: config => { if (!rules.bot_config) rules.__campaignRestoreLegacy(config) } }
}
function gitInfo() {
    const run = args => cp.execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim()
    return { gitSha: run(["rev-parse", "HEAD"]), gitDirty: !!run(["status", "--porcelain", "--untracked-files=no"]) }
}
function createRuntime(options = {}) {
    const requestedEnv = configEnv()
    const paths = { Japan: options.japanRules || process.env.EOTS_JAPAN_RULES || path.join(ROOT, "rules.js"),
        Allies: options.alliesRules || process.env.EOTS_ALLIES_RULES || path.join(ROOT, "rules.js") }
    const names = { Japan: options.japanBot || "erasmus-v2", Allies: options.alliesBot || "erasmus-v2" }
    const bundles = {}
    for (const side of ["Japan", "Allies"]) {
        const selected = side === "Japan" ? options.japanRules || process.env.EOTS_JAPAN_RULES : options.alliesRules || process.env.EOTS_ALLIES_RULES
        // Preserve the historical frozen-Japan default; a new Japan candidate
        // can explicitly retain its environment, independently of the Allies.
        const frozen = Boolean(selected && (side === "Japan" ? options.freezeJapan !== false : options.freezeAllies))
        bundles[side] = loadBundle(paths[side], frozen, requestedEnv)
        if (!bundles[side].rules.bots?.[names[side]]) throw new Error(`unknown ${side} bot ${names[side]} in ${paths[side]}`)
    }
    const metadata = { ...gitInfo(), rulesSha256: fileSha(path.join(ROOT, "rules.js")), ruleVersion: RULE_VERSION,
        adapterVersion: ADAPTER_VERSION, adapterSha256: sha(COMPAT_SOURCE), runnerSha256: fileSha(__filename), metricsSha256: fileSha(require.resolve("./campaign-metrics")),
        openingMetricsSha256: fileSha(require.resolve("./japan-opening-metrics")), bundles: {}, runtimeModelRequests: 0 }
    for (const side of ["Japan", "Allies"]) metadata.bundles[side] = { path: bundles[side].filename, sha256: bundles[side].sha256,
        bot: names[side], version: bundles[side].rules.bots[names[side]].version,
        frozen: bundles[side].frozen, environment: bundles[side].env, effectiveProfile: bundles[side].config(names[side], side) }
    return { bundles, names, metadata }
}
function validateAction(view, decision) {
    if (!decision || typeof decision.action !== "string") throw new Error("policy returned no action")
    const legal = view.actions?.[decision.action]
    let argument = decision.argument
    if (argument && typeof argument === "object" && argument.__ai) argument = argument.action
    if (argument && typeof argument === "object" && argument.oos) argument = argument.action
    if (!Object.hasOwn(view.actions || {}, decision.action) || legal === false || legal === 0 ||
        (Array.isArray(legal) && !legal.includes(argument))) throw new Error(`illegal policy action ${decision.action}(${JSON.stringify(argument)}) @ ${view.prompt}`)
}
function stateDigest(state) {
    // Undo/history caches are process-local mechanics; game state and its complete log are the replay contract.
    const copy = JSON.parse(JSON.stringify(state))
    for (const key of ["undo", "redo", "persisted_undo", "prepared_undo"]) delete copy[key]
    return sha(JSON.stringify(copy))
}
function gameplayFingerprint(state) {
    // Policy caches and rollback snapshots can grow during a cancelled/retried offense.
    // Their contents are not progress; keep the live RNG, events and phase/battle state.
    const ignored = new Set(["log", "undo", "redo", "redo_count", "persisted_undo", "prepared_undo", "card_rollback", "card_undo_len",
        "weather_rollback", "ai_runtime", "ai_plan", "ai_profile", "__ai", "publicTrace", "privateTrace", "campaignPlan", "targetPlan", "target_plan"])
    return sha(JSON.stringify(state, (key, value) => {
        if (ignored.has(key)) return undefined
        if (value && typeof value === "object" && !Array.isArray(value))
            return Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]]))
        return value
    }))
}
function progressGuard(limit = 32) {
    if (!Number.isInteger(limit) || limit < 2) throw new Error("repeat-state limit must be an integer >= 2")
    const seen = new Map()
    return (state, action) => {
        const fingerprint = gameplayFingerprint(state)
        const prior = seen.get(fingerprint) || { firstAction: action, count: 0 }
        prior.count++; seen.set(fingerprint, prior)
        if (prior.count >= limit) {
            const error = new Error(`repeated gameplay state ${prior.count} times (first action ${prior.firstAction}, current ${action}, phase ${state.L?.P}, turn ${state.turn})`)
            error.progress = { fingerprint, firstAction: prior.firstAction, action, count: prior.count, limit }
            throw error
        }
    }
}
function validDecisionTrace(trace) {
    if (!trace?.node) return false
    const chart = String(trace.chart || "")
    return /(?:JP-0[1-6]|AP-0[7-9]|AP-1[0-2])$/.test(chart)
        || chart === "CAMPAIGN" && !!trace.campaign && ["campaign-v1","campaign-v2.0","campaign-v2.1","campaign-v2.2","campaign-japan-v2.1"].includes(trace.policy)
}
function play(seed, options, runtime = createRuntime(options)) {
    const { bundles, names, metadata } = runtime
    const scenario = options.scenario || DEFAULT_SCENARIO, maxActions = options.maxActions || 60000
    const setupOptions = { headless_moves: !!options.headlessMoves, ...(options.setupOptions || {}) }
    const replay = { schemaVersion: 1, seed, scenario, setup: { seed, scenario, options: setupOptions }, metadata,
        replayActions: [], actionBundles: [], decisionLogs: [], ruleVersion: RULE_VERSION }
    let state, meter, actions = 0, fallback = 0, traceNodeMissing = 0, error = null
    const fallbackDetails = []
    const started = Date.now()
    const repeatStateLimit = options.repeatStateLimit || Number(process.env.EOTS_REPEAT_STATE_LIMIT || 32)
    const guard = progressGuard(repeatStateLimit)
    let repeatedState = null
    try { state = bundles.Allies.call(() => bundles.Allies.rules.setup(seed, scenario, setupOptions)) }
    catch (e) { return { result: { seed, scenario, metadata, status: "setup-error", error: e.stack || String(e), actions, natural: false }, replay } }
    meter = metrics.createMetrics(bundles.Allies.rules.pieces, state)
    const openingMeter = createOpeningMetrics(state)
    try {
        while (state.active !== "None" && actions < maxActions) {
            const role = activeRole(state), bundle = bundles[role]
            if (!bundle) throw new Error(`unexpected active role: ${JSON.stringify(state.active)}`)
            bundle.call(() => {
                const view = bundle.rules.view(state, role)
                const previousLog = state.log.slice()
                const decision = bundle.rules.bots[names[role]].decide(view, { role, seed, actionOrdinal: actions + 1 })
                if (state.log.length < previousLog.length || previousLog.some((line, i) => line !== state.log[i]))
                    throw new Error("policy changed pre-existing log entries")
                replay.decisionLogs.push(state.log.slice(previousLog.length))
                validateAction(view, decision)
                if (decision.publicTrace?.fallback) {
                    fallback++
                    if (fallbackDetails.length < 32) fallbackDetails.push({ role, ordinal: actions + 1, turn: state.turn,
                        state: state.L?.P ?? null, prompt: view.prompt ?? null, action: decision.action,
                        node: decision.publicTrace.node ?? null, legalActions: JSON.parse(JSON.stringify(view.actions || {})) })
                }
                if (!validDecisionTrace(decision.publicTrace)) traceNodeMissing++
                meter.recordDecision(role, decision, view, actions + 1)
                // Copy before action: rules may mutate the incoming plan object.
                replay.replayActions.push(JSON.parse(JSON.stringify([role, decision.action, decision.argument ?? null])))
                replay.actionBundles.push(role)
                state = bundle.rules.action(state, role, decision.action, decision.argument)
            })
            actions++
            meter.observe(state, actions)
            openingMeter.observe(state, actions)
            if (state.active !== "None") guard(state, actions)
            if (options.onProgress && (actions % (options.progressEvery || 500) === 0 || state.active === "None"))
                options.onProgress({ seed, actions, turn: state.turn, politicalWill: state.political_will, phase: state.L?.P, elapsedMs: Date.now() - started })
        }
    } catch (e) { error = e.stack || String(e); repeatedState = e.progress || null }
    const report = meter.result(state)
    const status = error ? "error" : state.active === "None" ? "complete" : "action-limit"
    let finalAtomic = null
    try { finalAtomic = bundles.Allies.call(() => bundles.Allies.rules.query(state, "Allies", "atomic_bomb_strategy_status")) }
    catch (e) { error = [error, `atomic metric query: ${e.stack || e}`].filter(Boolean).join("\n") }
    const zoc = { Japan: 0, Allies: 0 }
    for (const sc of (state.supply_cache || []).slice(1, 1478)) {
        if ((sc & 1) && !(sc & 4)) zoc.Japan++
        if ((sc & 2) && !(sc & 8)) zoc.Allies++
    }
    const blockadeStart = Number(state.events?.[28] || 0)
    const surrender = state.surrender ? { philippines: !!state.surrender[0], malaya: !!state.surrender[1], dei: !!state.surrender[2],
        burma: !!state.surrender[3], japan: !!state.surrender[12] } : null
    const result = { ...report, seed, scenario, metadata, zoc, surrender, opening: openingMeter.result(state),
        blockade: blockadeStart ? { startedTurn: blockadeStart, progress: Math.max(0, Number(state.turn) - blockadeStart + 1) } : null, status: error ? "error" : status, error,
        actions, fallback, fallbackDetails, traceNodeMissing, repeatStateLimit, repeatedState, elapsedMs: Date.now() - started, politicalWill: Number(state.political_will),
        powRequired: Number(state.pow || 0), powBank: metrics.retainedProgress(state), finalAtomic,
        jpResources: finalAtomic?.jpResources ?? null, activationRatio: report.actLimitSum ? report.actSum / report.actLimitSum : null,
        activationSum: report.actSum, activationLimit: report.actLimitSum,
        lateCapturesAllied: Object.entries(report.capByTurn.Allies).reduce((n, [turn, count]) => n + (Number(turn) >= 7 ? count : 0), 0),
        finalStateSha256: stateDigest(state), headless_moves: setupOptions.headless_moves, maxActions }
    result.validNatural = result.status === "complete" && result.natural && result.fallback === 0 && result.traceNodeMissing === 0
    replay.result = { status: result.status, winner: result.winner, won_text: result.won_text, natural: result.natural,
        finalStateSha256: result.finalStateSha256, actions }
    return { result, replay }
}
function replayBundlePath(info, role, options = {}) {
    const override = options.bundlePaths?.[role]
    if (override) {
        const resolved = path.resolve(override)
        if (fileSha(resolved) !== info.sha256) throw new Error(`${role} explicit replay bundle hash differs: ${resolved}`)
        return resolved
    }
    const dirs = [options.bundleDirectory, path.join(ROOT, "tmp/ai-win-01/bundles")]
    if (options.replayPath) dirs.push(path.resolve(path.dirname(options.replayPath), "../..", "bundles"))
    const candidates = [info.path, ...dirs.filter(Boolean).map(d => path.join(d, `${info.sha256}.js`))]
    for (const filename of candidates) if (fs.existsSync(filename) && fileSha(filename) === info.sha256) return path.resolve(filename)
    throw new Error(`${role} replay bundle hash unavailable: ${info.sha256}; checked ${candidates.join(", ")}`)
}
function verifyReplay(replay, options = {}) {
    if (replay.metadata.adapterSha256 !== sha(COMPAT_SOURCE)) throw new Error("replay adapter hash differs")
    const bundles = {}
    for (const role of ["Japan", "Allies"]) {
        const info = replay.metadata.bundles[role]
        const filename = replayBundlePath(info, role, options)
        bundles[role] = loadBundle(filename, info.frozen, info.environment)
    }
    const modes = Object.fromEntries(["Japan", "Allies"].map(role => [role, bundles[role].rules.bot_config ? "actions-only" : "frozen-policy-assisted"]))
    const legacyDecisionChecks = { Japan: 0, Allies: 0 }
    const legacyDecisionDrift = { Japan: 0, Allies: 0 }
    const legacyDecisionLogDrift = { Japan: 0, Allies: 0 }
    let state = bundles.Allies.call(() => bundles.Allies.rules.setup(replay.setup.seed, replay.setup.scenario, replay.setup.options))
    const openingMeter = createOpeningMetrics(state)
    for (const [index, entry] of replay.replayActions.entries()) {
        const [role, action, argument] = entry
        if (state.active === "None" || (Array.isArray(state.active) ? !state.active.includes(role) : state.active !== role))
            throw new Error(`replay active-role mismatch at action ${index + 1}`)
        const b = bundles[role]
        b.call(() => {
            const view = b.rules.view(state, role)
            const expectedLogs = replay.decisionLogs?.[index] || []
            if (modes[role] === "frozen-policy-assisted") {
                // Legacy advance depends on EOP_OVERRIDE and other process caches.
                // Warm them with the frozen policy, then replay the recorded
                // legal action. A transient cache can make a later policy
                // re-decision differ; the full final-state digest, including
                // the game log, is the authority for deterministic replay.
                const beforeLog = state.log.slice()
                const decision = b.rules.bots[replay.metadata.bundles[role].bot].decide(view,
                    { role, seed: replay.setup.seed, actionOrdinal: index + 1 })
                if (state.log.length < beforeLog.length || beforeLog.some((line, i) => line !== state.log[i]))
                    throw new Error(`legacy decision rewrote log at action ${index + 1}`)
                if (decision.action !== action || JSON.stringify(decision.argument ?? null) !== JSON.stringify(argument ?? null)) {
                    legacyDecisionDrift[role]++
                    if (options.strictLegacyDecisions)
                        throw new Error(`legacy decision differs at action ${index + 1}: ${decision.action} != ${action}`)
                }
                if (JSON.stringify(state.log.slice(beforeLog.length)) !== JSON.stringify(expectedLogs)) {
                    legacyDecisionLogDrift[role]++
                    if (options.strictLegacyDecisions)
                        throw new Error(`legacy decision logs differ at action ${index + 1}`)
                }
                legacyDecisionChecks[role]++
            } else if (expectedLogs.length) {
                throw new Error(`new action-only bundle has external decision logs at action ${index + 1}`)
            }
            try { validateAction(view, { action, argument }) }
            catch (error) { throw new Error(`replay action ${index + 1}: ${error.message}`, { cause: error }) }
            if (options.beforeAction) options.beforeAction(state, { index:index+1, role, action, argument, view, bundle:b })
            state = b.rules.action(state, role, action, argument)
        })
        openingMeter.observe(state, index + 1)
        if (options.afterAction) options.afterAction(state, { index:index+1, role, action, argument })
    }
    const actual = stateDigest(state)
    if (actual !== replay.result.finalStateSha256) throw new Error(`replay state mismatch: ${actual} != ${replay.result.finalStateSha256}`)
    const end = metrics.classifyEnd(state)
    return { verified: true, actions: replay.replayActions.length, finalStateSha256: actual, opening: openingMeter.result(state), modes, legacyDecisionChecks,
        legacyDecisionDrift, legacyDecisionLogDrift, verificationMethod: "legal-actions-and-complete-final-state",
        resolvedBundlePaths: Object.fromEntries(Object.entries(bundles).map(([role, b]) => [role, b.filename])), ...end }
}
function gameStem(scenario, seed, japanBot, alliesBot) { return `game-${slug(scenario)}-${seed}-J${slug(japanBot)}-A${slug(alliesBot)}` }
function shouldRecordReplay(result, mode = process.env.EOTS_RECORD_REPLAYS) {
    return Boolean(result.status === "complete" && result.winner === "Allies" || result.error || mode === "all")
}
function summarize(games, header = {}) {
    const valid = games.filter(x => x.validNatural), complete = games.filter(x => x.status === "complete")
    const role = { Japan: metrics.emptyRole(), Allies: metrics.emptyRole() }
    for (const g of complete) for (const side of ["Japan", "Allies"]) for (const k of metrics.METRIC_KEYS) role[side][k] += g.role?.[side]?.[k] || 0
    const mean = f => complete.length ? complete.reduce((n, g) => n + Number(f(g) || 0), 0) / complete.length : null
    const tally = { ...header, gameCount: games.length, complete: complete.length, validNatural: valid.length,
        japanWins: valid.filter(x => x.winner === "Japan").length, alliesWins: valid.filter(x => x.winner === "Allies").length,
        errors: games.filter(x => x.status === "error").length, setupErrors: games.filter(x => x.status === "setup-error").length,
        actionLimit: games.filter(x => x.status === "action-limit").length, invalid: games.length - valid.length,
        atomicBombWins: valid.filter(x => /atomic bomb/i.test(x.won_text || "")).length,
        blockadeWins: valid.filter(x => /blockade/i.test(x.won_text || "")).length,
        homelandWins: valid.filter(x => /mainland islands captured/i.test(x.won_text || "")).length,
        treatyWins: valid.filter(x => /Treaty/i.test(x.won_text || "")).length,
        earlyTreatyDefeats: valid.filter(x => x.earlyTreatyDefeat).length,
        meanTurn: mean(x => x.turn), meanPW: mean(x => x.politicalWill), meanJpResources: mean(x => x.jpResources),
        meanActivationRatio: mean(x => x.activationRatio), meanCapRate: { Japan: mean(x => x.capRate?.Japan?.mean), Allies: mean(x => x.capRate?.Allies?.mean) },
        role, battleWinRate: { Japan: metrics.battleRate(role.Japan).rate, Allies: metrics.battleRate(role.Allies).rate },
        battleRateDetails: { Japan: metrics.battleRate(role.Japan), Allies: metrics.battleRate(role.Allies) },
        amphibSuccessBySide: { Japan: role.Japan.amphibSuccess, Allies: role.Allies.amphibSuccess },
        amphibSuccessRate: { Japan: role.Japan.amphibAssaults ? role.Japan.amphibSuccess / role.Japan.amphibAssaults : null,
            Allies: role.Allies.amphibAssaults ? role.Allies.amphibSuccess / role.Allies.amphibAssaults : null } }
    tally.blockadeStarted = complete.filter(x => x.blockade).length
    tally.elimStepsBySide = { Japan: role.Japan.elimSteps, Allies: role.Allies.elimSteps }
    tally.zocFinal = { Japan: mean(x => x.zoc?.Japan), Allies: mean(x => x.zoc?.Allies) }
    tally.meanAirStrikeUnits = { Japan: mean(x => x.role?.Japan?.airStrikeUnits), Allies: mean(x => x.role?.Allies?.airStrikeUnits) }
    tally.meanCapRate.JapanMax = Math.max(0, ...complete.map(x => x.capRate?.Japan?.max || 0))
    tally.meanCapRate.AlliesMax = Math.max(0, ...complete.map(x => x.capRate?.Allies?.max || 0))
    tally.battleHexesPerTurn = mean(x => ((x.role?.Japan?.attacksInitiated || 0) + (x.role?.Allies?.attacksInitiated || 0)) / Math.max(1, x.turn - x.startTurn + 1))
    tally.surrenderCounts = Object.fromEntries(["philippines", "malaya", "dei", "burma", "japan"].map(k => [k, complete.filter(x => x.surrender?.[k]).length]))
    tally.inflicted = {}
    for (const side of ["Japan", "Allies"]) {
        for (const k of metrics.METRIC_KEYS) role[side][`mean_${k}`] = mean(x => x.role?.[side]?.[k])
        const opponent = side === "Japan" ? "Allies" : "Japan"
        tally.inflicted[side] = Object.fromEntries(["eliminations", "reductions", "cfEliminated", "cfReduced"].map(k => [k, role[opponent][k]]))
    }
    tally.alliesWinInterval = metrics.wilson(tally.alliesWins, games.length) // invalid games remain in the denominator
    return { generatedAt: new Date().toISOString(), tally, perGame: games, errors: games.filter(x => x.error) }
}
function main(argv = process.argv.slice(2)) {
    const scenario = String(argv[0] || DEFAULT_SCENARIO), gameCount = Number(argv[1] || 20), baseSeed = Number(argv[2] || 20260903)
    const japanBot = String(argv[3] || "erasmus-v2"), alliesBot = String(argv[4] || "erasmus-v2"), arg7 = String(argv[5] || "")
    const maxActions = /^\d+$/.test(arg7) ? Number(arg7) : 60000, tag = slug((/^\d+$/.test(arg7) ? argv[6] : arg7) || "")
    if (![gameCount, baseSeed, maxActions].every(Number.isSafeInteger) || gameCount < 1 || maxActions < 1) throw new Error("count, seed and maxActions must be positive integers")
    const outputDir = path.resolve(process.env.EOTS_MATCH_OUTPUT_DIR || path.join(__dirname, "results"))
    fs.mkdirSync(outputDir, { recursive: true })
    const headlessMoves = process.env.EOTS_HEADLESS_MOVES === "1"
    const options = { scenario, japanBot, alliesBot, maxActions, headlessMoves,
        freezeJapan: process.env.EOTS_FREEZE_JAPAN !== "0",
        freezeAllies: process.env.EOTS_FREEZE_ALLIES === "1",
        onProgress: p => process.stderr.write(`seed=${p.seed} action=${p.actions} turn=${p.turn} PW=${p.politicalWill} phase=${p.phase}\n`) }
    const runtime = createRuntime(options), games = [], started = Date.now()
    const runStem = `match-${slug(scenario)}-${gameCount}-${baseSeed}-J${japanBot}-A${alliesBot}${headlessMoves ? "-headless" : ""}${tag ? `-${tag}` : ""}`
    const incremental = path.join(outputDir, `${runStem}.jsonl`)
    fs.writeFileSync(incremental, "")
    for (let index = 0; index < gameCount; index++) {
        const { result, replay } = play(baseSeed + index, options, runtime)
        const stem = gameStem(scenario, result.seed, japanBot, alliesBot)
        if (shouldRecordReplay(result)) {
            result.replayFile = path.join(outputDir, `${stem}.replay.json`)
            fs.writeFileSync(result.replayFile, JSON.stringify(replay) + "\n")
            result.replaySha256 = fileSha(result.replayFile)
            result.replayVerified = false
        }
        fs.writeFileSync(path.join(outputDir, `${stem}.json`), JSON.stringify(result, null, 1) + "\n")
        fs.appendFileSync(incremental, JSON.stringify(result) + "\n")
        games.push(result)
        process.stderr.write(`${index + 1}/${gameCount} ${result.status} seed=${result.seed} turn=${result.turn ?? "-"} winner=${result.winner || "-"}${result.error ? ` ERROR: ${result.error}` : ""}\n`)
    }
    const output = summarize(games, { scenario, baseSeed, maxActions, headless_moves: headlessMoves, japanBot, alliesBot,
        metadata: runtime.metadata, elapsedSec: (Date.now() - started) / 1000 })
    const outputPath = path.join(outputDir, `${runStem}.json`)
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 1) + "\n")
    console.log(JSON.stringify({ outputPath, complete: output.tally.complete, alliesWins: output.tally.alliesWins,
        japanWins: output.tally.japanWins, invalid: output.tally.invalid, alliesWinInterval: output.tally.alliesWinInterval }))
    console.log(outputPath)
    if (games.some(g => !g.validNatural)) process.exitCode = 1
}
module.exports = { createRuntime, play, verifyReplay, summarize, gameStem, fileSha, loadBundle, validateAction, stateDigest, main,
    ADAPTER_VERSION, COMPAT_SOURCE, RULE_VERSION, ROOT, gameplayFingerprint, progressGuard, replayBundlePath, shouldRecordReplay, validDecisionTrace }
if (require.main === module) main()
