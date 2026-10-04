"use strict"

// Explicit stages (never run holdout while tuning):
// node tests/campaign-evaluate.js develop <output-dir> [count<=32]
// node tests/campaign-evaluate.js freeze <development-dir> <freeze.json>
// node tests/campaign-evaluate.js holdout <freeze.json> <output-dir>
// node tests/campaign-evaluate.js summarize <output-dir> [develop|holdout]
// node tests/campaign-evaluate.js verify-replay <replay.json>
// EOTS_EVAL_JOBS=1..4 bounds independent match processes (default 2).
// All expensive work is CLI-only. Requiring this module never starts a match.
const fs = require("fs")
const path = require("path")
const cp = require("child_process")
const crypto = require("crypto")
const { createRuntime, verifyReplay, gameStem, fileSha, ROOT, RULE_VERSION } = require("./match-run")
const { wilson, pairedBootstrap } = require("./campaign-metrics")
const SCENARIOS = ["1942-1945 (The Shortened Campaign)", "1943-1945 (The Even Shorter Campaign)"]
const BASELINE_BOT = "erasmus-v2-opt-v5", CANDIDATE_BOT = "erasmus-campaign"
const RANGES = { develop: { first: 20261004, count: 32 }, holdout: { first: 20261101, count: 32 } }
const sha = x => crypto.createHash("sha256").update(x).digest("hex")
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const read = filename => JSON.parse(fs.readFileSync(filename, "utf8"))
function paths() { return { baseline: path.resolve(process.env.EOTS_JAPAN_RULES || path.join(ROOT, "tmp/ai-win-01/baseline-rules.js")),
    candidate: path.resolve(process.env.EOTS_ALLIES_RULES || path.join(ROOT, "rules.js")) } }
function locks() {
    const p = paths()
    const r = createRuntime({ japanRules: p.baseline, alliesRules: p.candidate, japanBot: BASELINE_BOT, alliesBot: CANDIDATE_BOT })
    return { ruleVersion: RULE_VERSION, baseline: { path: p.baseline, sha256: fileSha(p.baseline), effectiveProfile: r.metadata.bundles.Japan.effectiveProfile },
        candidate: { path: p.candidate, sha256: fileSha(p.candidate), effectiveProfile: r.metadata.bundles.Allies.effectiveProfile },
        runner: { path: require.resolve("./match-run"), sha256: fileSha(require.resolve("./match-run")) },
        metrics: { path: require.resolve("./campaign-metrics"), sha256: fileSha(require.resolve("./campaign-metrics")) },
        evaluator: { path: __filename, sha256: fileSha(__filename) }, adapterSha256: r.metadata.adapterSha256, gitSha: r.metadata.gitSha }
}
function resultPath(directory, scenarioIndex, arm, seed) {
    return path.join(directory, `scenario-${scenarioIndex + 1}`, arm,
        `${gameStem(SCENARIOS[scenarioIndex], seed, BASELINE_BOT, arm === "baseline" ? BASELINE_BOT : CANDIDATE_BOT)}.json`)
}
function validateProvenance(result, locked, arm) {
    const bundles = result.metadata?.bundles, expected = arm === "baseline" ? locked.baseline : locked.candidate
    if (result.metadata?.ruleVersion !== locked.ruleVersion || bundles?.Japan?.sha256 !== locked.baseline.sha256 || bundles?.Allies?.sha256 !== expected.sha256 ||
        !equal(bundles?.Japan?.effectiveProfile, locked.baseline.effectiveProfile) || !equal(bundles?.Allies?.effectiveProfile, expected.effectiveProfile) ||
        result.metadata?.runnerSha256 !== locked.runner.sha256 || result.metadata?.metricsSha256 !== locked.metrics.sha256 || result.metadata?.adapterSha256 !== locked.adapterSha256)
        throw new Error(`result provenance differs from locked run: seed=${result.seed} arm=${arm}`)
    if (bundles.Japan.bot !== BASELINE_BOT || bundles.Allies.bot !== (arm === "baseline" ? BASELINE_BOT : CANDIDATE_BOT) || !result.headless_moves)
        throw new Error(`unexpected bots/options: seed=${result.seed}`)
}
function loadPhase(directory, phase, count = RANGES[phase].count, locked = null) {
    const groups = SCENARIOS.map(scenario => ({ scenario, baseline: [], campaign: [] }))
    for (let s = 0; s < SCENARIOS.length; s++) for (const arm of ["baseline", "campaign"]) for (let i = 0; i < count; i++) {
        const seed = RANGES[phase].first + i, filename = resultPath(directory, s, arm, seed)
        if (!fs.existsSync(filename)) throw new Error(`missing ${phase} result ${filename}`)
        const result = read(filename)
        if (result.seed !== seed || result.scenario !== SCENARIOS[s]) throw new Error(`result identity mismatch: ${filename}`)
        if (locked) validateProvenance(result, locked, arm)
        groups[s][arm].push({ ...result, resultFile: filename, resultSha256: fileSha(filename) })
    }
    return groups
}
const win = game => Boolean(game.validNatural && game.status === "complete" && game.winner === "Allies")
function reportGroups(groups, phase) {
    return { phase, ruleVersion: RULE_VERSION, generatedAt: new Date().toISOString(),
        denominatorPolicy: "all scheduled games; invalid/unfinished games remain non-wins and are separately reported",
        scenarios: groups.map(g => {
            const arms = {}
            for (const arm of ["baseline", "campaign"]) {
                const games = g[arm], eligiblePow = games.reduce((n, x) => n + Number(x.pow?.eligibleTurns || 0), 0)
                const amphibAttempts = games.reduce((n, x) => n + Number(x.role?.Allies?.amphibAssaults || 0), 0)
                const amphibSuccess = games.reduce((n, x) => n + Number(x.role?.Allies?.amphibSuccess || 0), 0)
                arms[arm] = { winRate: wilson(games.filter(win).length, games.length), invalid: games.filter(x => !x.validNatural).length,
                    earlyTreatyDefeats: games.filter(x => x.validNatural && x.earlyTreatyDefeat).length,
                    pow: { eligibleTurns: eligiblePow, metTurns: games.reduce((n, x) => n + Number(x.pow?.metTurns || 0), 0) },
                    amphibious: { attempts: amphibAttempts, successes: amphibSuccess, rate: amphibAttempts ? amphibSuccess / amphibAttempts : null },
                    netCaptures: games.map(x => ({ seed: x.seed, value: x.netCaptures?.Allies ?? null })),
                    firstExecutedLandingFormation: games.map(x => ({ seed: x.seed, value: x.firstExecutedLandingFormation ?? null })),
                    // Plan readiness is only a candidate diagnostic; the executed field above is shared by both arms.
                    firstLandingFormation: games.map(x => ({ seed: x.seed, value: x.firstLandingFormation ?? null })),
                    invalidGames: games.filter(x => !x.validNatural).map(x => ({ seed: x.seed, status: x.status, error: x.error || null,
                        fallback: x.fallback || 0, traceNodeMissing: x.traceNodeMissing || 0, termination: x.termination,
                        fallbackDetails: x.fallbackDetails || [] })) }
                arms[arm].pow.rate = eligiblePow ? arms[arm].pow.metTurns / eligiblePow : null
            }
            const baseline = new Map(g.baseline.map(x => [x.seed, x]))
            const pairs = g.campaign.map(x => { if (!baseline.has(x.seed)) throw new Error(`unpaired seed ${x.seed}`); return [win(baseline.get(x.seed)), win(x)] })
            const discordant = pairs.filter(([a,b])=>a!==b).length
            return { scenario: g.scenario, ...arms, pairedWinRateDifference: { ...pairedBootstrap(pairs), discordantPairs: discordant,
                method: "paired percentile bootstrap", caveat: discordant ? null
                    : "No discordant observed pairs: a degenerate bootstrap interval is not evidence of equivalence; use arm Wilson intervals and more data." } }
        }) }
}
function archiveBundles(directory, locked) {
    const bundleDir = path.join(directory, "bundles")
    fs.mkdirSync(bundleDir, { recursive: true })
    const copies = {}
    for (const side of ["baseline", "candidate"]) {
        const source = locked[side], filename = path.join(bundleDir, `${source.sha256}.js`)
        if (fs.existsSync(filename)) {
            if (fileSha(filename) !== source.sha256) throw new Error(`immutable bundle was modified: ${filename}`)
        } else {
            const bytes = fs.readFileSync(source.path)
            if (sha(bytes) !== source.sha256) throw new Error(`bundle changed between lock and archive: ${source.path}`)
            fs.writeFileSync(filename, bytes, { flag: "wx", mode: 0o444 })
        }
        copies[side] = filename
    }
    return copies
}
async function runQueue(tasks, jobs, run) {
    if (!Number.isInteger(jobs) || jobs < 1 || jobs > 4) throw new Error("EOTS_EVAL_JOBS must be an integer 1..4")
    const results = new Array(tasks.length), errors = []
    let next = 0
    async function worker() {
        while (next < tasks.length && !errors.length) {
            const index = next++
            try { results[index] = await run(tasks[index], index) }
            catch (error) { errors.push(error) }
        }
    }
    await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, worker))
    // Finish every already-started process before reporting a fatal infrastructure/provenance error.
    if (errors.length) throw new AggregateError(errors, `evaluation queue failed: ${errors.map(e => e.message || e).join("; ")}`)
    return results
}
function spawnMatch(args, env) {
    return new Promise((resolve, reject) => {
        const child = cp.spawn(process.execPath, args, { cwd: ROOT, env, stdio: "inherit" })
        child.once("error", reject)
        child.once("close", (status, signal) => resolve({ status, signal }))
    })
}
async function runPhase(phase, directory, locked, count = 32, freezeHash = null) {
    if (!Number.isInteger(count) || count < 1 || count > 32) throw new Error("development count must be 1..32")
    const jobs = Number(process.env.EOTS_EVAL_JOBS || 2)
    if (!Number.isInteger(jobs) || jobs < 1 || jobs > 4) throw new Error("EOTS_EVAL_JOBS must be an integer 1..4")
    directory = path.resolve(directory); fs.mkdirSync(directory, { recursive: true })
    const marker = path.join(directory, "run-lock.json")
    const bundleCopies = archiveBundles(directory, locked)
    const contract = { phase, firstSeed: RANGES[phase].first, count, jobs, locked, freezeSha256: freezeHash, maxActions: Number(process.env.EOTS_MAX_ACTIONS || 60000) }
    if (fs.existsSync(marker)) {
        if (!equal(read(marker), contract)) throw new Error("existing output directory has a different run lock; use a separate directory")
    } else fs.writeFileSync(marker, JSON.stringify(contract, null, 2) + "\n", { flag: "wx" })
    let failed = false
    const tasks = [], outputs = new Set()
    for (let s = 0; s < SCENARIOS.length; s++) for (let i = 0; i < count; i++) for (const arm of ["baseline", "campaign"]) {
        const seed = RANGES[phase].first + i, output = resultPath(directory, s, arm, seed)
        if (outputs.has(output)) throw new Error(`duplicate scheduled result path: ${output}`)
        outputs.add(output)
        if (fs.existsSync(output)) { validateProvenance(read(output), locked, arm); continue }
        tasks.push({ s, arm, seed, output })
    }
    await runQueue(tasks, jobs, async ({ s, arm, seed, output }) => {
        // A per-game claim also prevents another evaluator process from writing this result concurrently.
        fs.mkdirSync(path.dirname(output), { recursive: true })
        const claim = `${output}.running`
        fs.writeFileSync(claim, JSON.stringify({ evaluatorPid: process.pid, phase, arm, seed, startedAt: new Date().toISOString() }) + "\n", { flag: "wx" })
        try {
            // Another run may have finished this game after the initial queue snapshot.
            if (fs.existsSync(output)) { validateProvenance(read(output), locked, arm); return }
            const env = { ...process.env, EOTS_HEADLESS_MOVES: "1", EOTS_JAPAN_RULES: bundleCopies.baseline,
                EOTS_ALLIES_RULES: arm === "baseline" ? bundleCopies.baseline : bundleCopies.candidate,
                EOTS_FREEZE_ALLIES: arm === "baseline" ? "1" : "0", EOTS_MATCH_OUTPUT_DIR: path.dirname(output) }
            process.stderr.write(`[${phase}] ${SCENARIOS[s]} ${arm} seed=${seed}\n`)
            const child = await spawnMatch([path.join(__dirname, "match-run.js"), SCENARIOS[s], "1", String(seed), BASELINE_BOT,
                arm === "baseline" ? BASELINE_BOT : CANDIDATE_BOT, String(contract.maxActions), phase], env)
            if (child.status !== 0) { failed = true; process.stderr.write(`match exited ${child.status} signal=${child.signal || "none"}; retained as invalid in the report\n`) }
            if (!fs.existsSync(output)) throw new Error(`match produced no result: ${output}`)
            validateProvenance(read(output), locked, arm)
        } finally { fs.unlinkSync(claim) }
    })
    const groups = loadPhase(directory, phase, count, locked), report = reportGroups(groups, phase)
    fs.writeFileSync(path.join(directory, "summary.json"), JSON.stringify(report, null, 2) + "\n")
    console.log(JSON.stringify(report, null, 2))
    if (failed || groups.some(g => [...g.baseline, ...g.campaign].some(x => !x.validNatural))) process.exitCode = 1
    return report
}
function freeze(developmentDir, filename) {
    const locked = locks(), groups = loadPhase(path.resolve(developmentDir), "develop", 32, locked)
    const evidence = []
    for (const g of groups) {
        const candidates = g.campaign.filter(x => win(x) && x.replayFile && x.replaySha256)
        if (!candidates.length) throw new Error(`freeze gate failed: no recorded natural campaign win in ${g.scenario}`)
        const game = candidates[0]
        if (fileSha(game.replayFile) !== game.replaySha256) throw new Error("winning replay content changed")
        const verified = verifyReplay(read(game.replayFile), { replayPath: game.replayFile })
        if (!verified.natural || verified.winner !== "Allies") throw new Error("winning replay did not verify as a natural Allies win")
        evidence.push({ scenario: g.scenario, seed: game.seed, replayFile: game.replayFile, replaySha256: game.replaySha256, verification: verified })
    }
    const manifest = { schemaVersion: 1, task: "AI-WIN-01", frozenAt: new Date().toISOString(), locked, developmentDir: path.resolve(developmentDir),
        developmentResults: groups.flatMap(g => [...g.baseline, ...g.campaign]).map(g => ({ path: g.resultFile, sha256: g.resultSha256 })),
        winningReplayEvidence: evidence, holdout: RANGES.holdout, scenarios: SCENARIOS, bots: { Japan: BASELINE_BOT, baseline: BASELINE_BOT, candidate: CANDIDATE_BOT } }
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true })
    fs.writeFileSync(filename, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" })
    console.log(JSON.stringify({ freezeFile: path.resolve(filename), freezeSha256: fileSha(filename), evidence }, null, 2))
    return manifest
}
function validateFreeze(filename) {
    const manifest = read(filename), current = locks()
    if (!equal(manifest.locked, current)) throw new Error("freeze mismatch: code, rules, effective profile, adapter or git SHA changed; holdout refused")
    if (!equal(manifest.scenarios, SCENARIOS) || !equal(manifest.holdout, RANGES.holdout) || manifest.winningReplayEvidence?.length !== 2)
        throw new Error("freeze manifest does not satisfy the registered protocol")
    for (const e of manifest.developmentResults) if (fileSha(e.path) !== e.sha256) throw new Error(`development result changed after freeze: ${e.path}`)
    for (const e of manifest.winningReplayEvidence) if (fileSha(e.replayFile) !== e.replaySha256 || !e.verification?.verified) throw new Error("freeze replay evidence invalid")
    return manifest
}
function main(argv = process.argv.slice(2)) {
    const [command, a, b] = argv
    if (command === "develop" && a) return runPhase("develop", a, locks(), b === undefined ? 32 : Number(b))
    if (command === "freeze" && a && b) return freeze(a, b)
    if (command === "holdout" && a && b) { const f = validateFreeze(a); return runPhase("holdout", b, f.locked, 32, fileSha(a)) }
    if (command === "summarize" && a) { const marker = read(path.join(a, "run-lock.json")); const phase = b || marker.phase; const report = reportGroups(loadPhase(a, phase, marker.count, marker.locked), phase); console.log(JSON.stringify(report, null, 2)); return report }
    if (command === "verify-replay" && a) { const result = verifyReplay(read(a), { replayPath: a, bundleDirectory: b }); console.log(JSON.stringify(result, null, 2)); return result }
    throw new Error("usage: campaign-evaluate.js develop <dir> [count] | freeze <development-dir> <freeze.json> | holdout <freeze.json> <dir> | summarize <dir> | verify-replay <replay.json>")
}
module.exports = { SCENARIOS, RANGES, locks, validateProvenance, loadPhase, reportGroups, freeze, validateFreeze, runPhase, runQueue, archiveBundles, main }
if (require.main === module) Promise.resolve().then(() => main()).catch(error => {
    console.error(error.stack || error)
    process.exitCode = 1
})
