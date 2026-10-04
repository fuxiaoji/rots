"use strict"
// Historical annotations only. These tests read immutable archives; they do not replay an old engine.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const os = require("os")
const crypto = require("crypto")
const { analyzeLog, classifyEnd } = require("./campaign-metrics")
const { fileSha, COMPAT_SOURCE, shouldRecordReplay } = require("./match-run")
const { verifyGameResult, loadVerification, verificationPath, reportGroups, validateProvenance, evaluationLimits } = require("./campaign-evaluate")
const load = id => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, "..", "replays", `game-${id}.state.json.gz`))))
test("#73: repeated air raids are not occupations; five consecutive missed PoW quotas", () => {
    const state = load(73), m = analyzeLog(state.log, 2)
    assert.deepEqual(m.powTurns.filter(x => x.checked).map(x => [x.turn, x.retained, x.required]), [[4, 1, 3], [5, 1, 4], [6, 0, 4], [7, 0, 4], [8, 1, 4]])
    assert.match(state.log[2019], /H657/); assert.match(state.log[2046], /H657/)
    assert.match(state.log[2020], /P108/); assert.match(state.log[2047], /P109/)
    assert.equal(classifyEnd(state).earlyTreatyDefeat, true)
    assert.equal(m.role.Allies.amphibAssaults, 0, "log-only analysis intentionally reports no inferred landing statistic")
})
test("#76: failed escort/sea battle prevents ground participation and PoW falls behind", () => {
    const state = load(76), m = analyzeLog(state.log, 5)
    assert.deepEqual(m.powTurns.filter(x => x.checked).map(x => [x.turn, x.retained, x.required]), [[5, 2, 4], [6, 1, 4], [7, 1, 4]])
    assert.match(state.log[814], /P129 eliminated/)
    assert.match(state.log[863], /P133 eliminated/)
    assert.equal(m.role.Allies.groundAttacksWon, 0)
    assert.equal(classifyEnd(state).earlyTreatyDefeat, true)
})
test("#78: supported Osaka landing and subsequent ground advances; Kyushu attack did not win", () => {
    const state = load(78)
    for (const [index, pattern] of [[925, /AP captured H647/], [1888, /AP captured H673/], [1994, /AP captured H672/],
        [2591, /Activated \^7 units/], [2617, /AP fire \(78\)/], [2637, /AP captured H732/], [2818, /AP captured H731/],
        [2839, /AP captured H788/], [2880, /AP captured H789/], [3036, /AP captured H703/], [3090, /Defender won in ground combat H674/]])
        assert.match(state.log[index], pattern, `historical log[${index}]`)
    const end = classifyEnd(state)
    assert.equal(end.natural, true); assert.equal(end.winner, "Allies")
    assert.match(end.won_text, /mainland islands captured/)
})

function verificationFixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "campaign-replay-evidence-"))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    const metadata = { ruleVersion: "official-16.2", runnerSha256: fileSha(require.resolve("./match-run")),
        metricsSha256: fileSha(require.resolve("./campaign-metrics")), adapterSha256: crypto.createHash("sha256").update(COMPAT_SOURCE).digest("hex"),
        bundles: { Japan: { sha256: "baseline", bot: "erasmus-v2-opt-v5", effectiveProfile: {}, environment: {} },
            Allies: { sha256: "candidate", bot: "erasmus-campaign", effectiveProfile: { campaign_planner: 1 }, environment: { B_BIAS: "1" } } } }
    const resultFile = path.join(directory, "game.json"), replayFile = path.join(directory, "game.replay.json")
    const game = { seed: 20261004, scenario: "fixture", metadata, status: "complete", natural: true, validNatural: true,
        winner: "Allies", fallback: 0, traceNodeMissing: 0, actions: 1, finalStateSha256: "fixture-final-state", headless_moves: true,
        maxActions: 60000, repeatStateLimit: 32, replayFile, replayVerified: false }
    const replay = { metadata, setup: { seed: game.seed, scenario: game.scenario }, replayActions: [["Allies", "done", null]],
        result: { finalStateSha256: game.finalStateSha256 } }
    fs.writeFileSync(replayFile, JSON.stringify(replay))
    game.replaySha256 = fileSha(replayFile)
    fs.writeFileSync(resultFile, JSON.stringify(game))
    const loadGame = () => { const result = { ...JSON.parse(fs.readFileSync(resultFile, "utf8")), resultFile, resultSha256: fileSha(resultFile) };
        result.verification = loadVerification(result); return result }
    const proof = { verified: true, natural: true, winner: "Allies", actions: 1, finalStateSha256: game.finalStateSha256,
        modes: { Japan: "frozen-policy-assisted", Allies: "actions-only" } }
    const locked = { ruleVersion: metadata.ruleVersion, baseline: { sha256: "baseline", effectiveProfile: {}, environment: {} },
        candidate: { sha256: "candidate", effectiveProfile: { campaign_planner: 1 }, environment: { B_BIAS: "1" } },
        runner: { sha256: metadata.runnerSha256 }, metrics: { sha256: metadata.metricsSha256 }, adapterSha256: metadata.adapterSha256,
        limits: { maxActions: 60000, repeatStateLimit: 32 } }
    const report = result => reportGroups([{ scenario: "fixture", baseline: [{ ...result, winner: "Japan" }], campaign: [result] }], "develop").scenarios[0].campaign
    return { resultFile, replayFile, loadGame, proof, locked, report }
}

test("all terminal Allies wins are recorded even when fallback or trace makes them invalid", () => {
    assert.equal(shouldRecordReplay({status:"complete",winner:"Allies",validNatural:false,fallback:1}, ""), true)
    assert.equal(shouldRecordReplay({status:"complete",winner:"Allies",validNatural:false,traceNodeMissing:1}, ""), true)
    assert.equal(shouldRecordReplay({status:"error",error:"failed"}, ""), true)
    assert.equal(shouldRecordReplay({status:"action-limit",winner:"Allies"}, ""), false)
})

test("a natural win is not counted until its sidecar proves full replay; raw result stays immutable", t => {
    const f = verificationFixture(t), originalHash = fileSha(f.resultFile)
    assert.equal(f.report(f.loadGame()).winRate.successes, 0)
    assert.equal(f.report(f.loadGame()).unverifiedWins, 1)
    let calls = 0
    const verification = verifyGameResult(f.resultFile, f.locked, "campaign", () => { calls++; return f.proof })
    assert.equal(verification.status, "verified")
    assert.equal(fileSha(f.resultFile), originalHash)
    assert.equal(f.report(f.loadGame()).winRate.successes, 1)
    assert.equal(f.report(f.loadGame()).unverifiedWins, 0)
    assert.equal(verifyGameResult(f.resultFile, f.locked, "campaign", () => { throw new Error("must reuse valid evidence") }).status, "verified")
    assert.equal(calls, 1)
})

test("replay verification failure is preserved separately and never counted as a win", t => {
    const f = verificationFixture(t), originalHash = fileSha(f.resultFile)
    const verification = verifyGameResult(f.resultFile, f.locked, "campaign", () => { throw new Error("state digest mismatch fixture") })
    assert.equal(verification.status, "failed")
    assert.match(verification.error, /state digest mismatch/)
    assert.equal(fileSha(f.resultFile), originalHash)
    const report = f.report(f.loadGame())
    assert.equal(report.winRate.n, 1)
    assert.equal(report.winRate.successes, 0)
    assert.equal(report.verificationFailedWins, 1)
})

test("verified evidence is invalidated by changed replay or original result hashes", t => {
    const f = verificationFixture(t)
    verifyGameResult(f.resultFile, f.locked, "campaign", () => f.proof)
    fs.appendFileSync(f.replayFile, "\n")
    assert.equal(f.loadGame().verification.status, "failed")
    assert.equal(f.report(f.loadGame()).winRate.successes, 0)
    fs.appendFileSync(f.resultFile, "\n")
    assert.match(f.loadGame().verification.error, /result\/verifier binding differs/)
})

test("a missing winning replay writes failed evidence instead of trusting the natural-result label", t => {
    const f = verificationFixture(t)
    fs.unlinkSync(f.replayFile)
    const verification = verifyGameResult(f.resultFile, f.locked, "campaign", () => { throw new Error("must not call verifier without replay") })
    assert.equal(verification.status, "failed")
    assert.equal(fs.existsSync(verificationPath(f.resultFile)), true)
    assert.equal(f.report(f.loadGame()).winRate.successes, 0)
})

test("strict new provenance locks effective environment and execution limits; old locks remain auditable", t => {
    const f = verificationFixture(t), result = f.loadGame()
    validateProvenance(result, f.locked, "campaign")
    const changed = JSON.parse(JSON.stringify(result)); changed.metadata.bundles.Allies.environment.B_BIAS = "0"
    assert.throws(() => validateProvenance(changed, f.locked, "campaign"), /behavior environment/)
    assert.throws(() => validateProvenance({...result,maxActions:1}, f.locked, "campaign"), /execution limits/)
    assert.throws(() => validateProvenance({...result,repeatStateLimit:99}, f.locked, "campaign"), /execution limits/)
    const historical = JSON.parse(JSON.stringify(f.locked)); delete historical.limits
    delete historical.baseline.environment; delete historical.candidate.environment
    validateProvenance(result, historical, "campaign")
})

test("evaluation limit defaults agree with runner defaults and invalid limits fail early", () => {
    const old = { max: process.env.EOTS_MAX_ACTIONS, repeat: process.env.EOTS_REPEAT_STATE_LIMIT }
    try {
        delete process.env.EOTS_MAX_ACTIONS; delete process.env.EOTS_REPEAT_STATE_LIMIT
        assert.deepEqual(evaluationLimits(), {maxActions:60000,repeatStateLimit:32})
        process.env.EOTS_MAX_ACTIONS = "1234"; process.env.EOTS_REPEAT_STATE_LIMIT = "64"
        assert.deepEqual(evaluationLimits(), {maxActions:1234,repeatStateLimit:64})
        process.env.EOTS_REPEAT_STATE_LIMIT = "1"
        assert.throws(() => evaluationLimits(), /repeatStateLimit >= 2/)
    } finally {
        if (old.max === undefined) delete process.env.EOTS_MAX_ACTIONS; else process.env.EOTS_MAX_ACTIONS = old.max
        if (old.repeat === undefined) delete process.env.EOTS_REPEAT_STATE_LIMIT; else process.env.EOTS_REPEAT_STATE_LIMIT = old.repeat
    }
})
