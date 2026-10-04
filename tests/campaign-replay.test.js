"use strict"
// Historical annotations only. These tests read immutable archives; they do not replay an old engine.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const { analyzeLog, classifyEnd } = require("./campaign-metrics")
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
