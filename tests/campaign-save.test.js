"use strict"

// AI-WIN-01: genuine legal play, JSON save boundaries, and a fresh Node process.
// Run after building rules.js: node --test tests/campaign-save.test.js
// No recorded states are edited, no policy-assisted replay, no fixture files are written.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const cp = require("node:child_process")
const Module = require("node:module")
const { stateDigest, validateAction } = require("./match-run")
const ROOT = path.resolve(__dirname, "..")
const RULES_FILE = path.join(ROOT, "rules.js")
const SCENARIO = "1943-1945 (The Even Shorter Campaign)"
const SEED = 20261004
const BOTS = { Japan: "erasmus-v2-opt-v5", Allies: "erasmus-campaign" }
const TEST_ENV = { EOTS_OPT_PARAMS_JAPAN: "emMinPWin=0.41", EOTS_OPT_PARAMS_ALLIES: "emMinPWin=0.67" }
const clone = value => JSON.parse(JSON.stringify(value))
const activeRole = state => Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
function cleanEnv() {
    const env = { ...process.env }
    for (const key of Object.keys(env)) if (/^EOTS_OPT_(PROFILE|PARAMS)/.test(key)) delete env[key]
    return { ...env, ...TEST_ENV }
}
function withTestEnvironment(fn) {
    const old = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^EOTS_OPT_(PROFILE|PARAMS)/.test(key)))
    for (const key of Object.keys(old)) delete process.env[key]
    Object.assign(process.env, TEST_ENV)
    try { return fn() } finally {
        for (const key of Object.keys(process.env)) if (/^EOTS_OPT_(PROFILE|PARAMS)/.test(key)) delete process.env[key]
        Object.assign(process.env, old)
    }
}
function freshBundle() {
    const mod = new Module(RULES_FILE, module)
    mod.filename = RULES_FILE; mod.paths = Module._nodeModulePaths(ROOT)
    mod._compile(fs.readFileSync(RULES_FILE, "utf8"), RULES_FILE)
    return mod.exports
}
function changedFields(a, b, prefix = "", out = []) {
    if (JSON.stringify(a) === JSON.stringify(b) || out.length >= 12) return out
    if (!a || !b || typeof a !== "object" || typeof b !== "object") {
        out.push({ path: prefix, before: a, after: b }); return out
    }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (["undo", "redo", "persisted_undo", "prepared_undo"].includes(key)) continue
        changedFields(a[key], b[key], `${prefix}.${key}`, out)
        if (out.length >= 12) break
    }
    return out
}
const CHILD_SOURCE = String.raw`
const fs = require("node:fs")
const input = JSON.parse(fs.readFileSync(0, "utf8"))
const rules = require(input.rulesFile)
const { stateDigest, validateAction } = require(input.runnerFile)
let state = input.state
let decision = null
if (input.mode === "action") {
    // Deliberately no rules.view or bot.decide: persisted action metadata must be sufficient.
    state = rules.action(state, input.role, input.action, input.argument)
} else if (input.mode === "decision") {
    const before = JSON.stringify(state)
    const view = rules.view(state, input.role)
    const afterView = JSON.stringify(state)
    decision = rules.bots[input.bot].decide(view, input.context)
    validateAction(view, decision)
    if (JSON.stringify(state) !== afterView) throw new Error("fresh-process decide mutated serialized game state")
} else throw new Error("unknown child mode")
process.stdout.write("\n__CAMPAIGN_SAVE_RESULT__" + JSON.stringify({ state, digest: stateDigest(state), decision }))
`
function freshProcess(payload) {
    const result = cp.spawnSync(process.execPath, ["-e", CHILD_SOURCE], {
        cwd: ROOT, env: cleanEnv(), input: JSON.stringify({ rulesFile: RULES_FILE,
            runnerFile: require.resolve("./match-run"), ...payload }), encoding: "utf8", timeout: 60000,
        maxBuffer: 64 * 1024 * 1024,
    })
    if (result.error) throw result.error
    assert.equal(result.status, 0, `fresh Node failed (signal=${result.signal}):\n${result.stderr}\n${result.stdout.slice(-3000)}`)
    const marker = "__CAMPAIGN_SAVE_RESULT__", index = result.stdout.lastIndexOf(marker)
    assert(index >= 0, "fresh process did not produce its result marker")
    return JSON.parse(result.stdout.slice(index + marker.length))
}
let fixture
function movingFixture() {
    if (fixture) return fixture
    return withTestEnvironment(() => {
        const rules = freshBundle()
        assert.equal(typeof rules.bot_config, "function", "build the new bundle before running save tests")
        const profiles = { Japan: rules.bot_config(BOTS.Japan, "Japan"), Allies: rules.bot_config(BOTS.Allies, "Allies") }
        assert.equal(profiles.Japan.emMinPWin, 0.41)
        assert.equal(profiles.Allies.emMinPWin, 0.67)
        assert.equal(profiles.Allies.campaign_planner, 1)
        assert.equal(profiles.Japan.campaign_planner, 0)
        let state = rules.setup(SEED, SCENARIO, { headless_moves: true })
        const history = [], roleActions = { Japan: 0, Allies: 0 }
        for (let ordinal = 1; ordinal <= 600 && state.active !== "None"; ordinal++) {
            const role = activeRole(state), view = rules.view(state, role), phase = state.L?.P
            assert(BOTS[role], `unexpected active role ${JSON.stringify(state.active)}`)
            const unchanged = JSON.stringify(state)
            const decision = rules.bots[BOTS[role]].decide(view, { role, seed: SEED, actionOrdinal: ordinal })
            assert.equal(JSON.stringify(state), unchanged, `decide mutated state before action ${ordinal} (${role}, ${phase})`)
            validateAction(view, decision)
            assert(decision.argument?.__ai, `new ${role} policy action ${ordinal} has no persisted metadata`)
            assert.deepEqual(decision.argument.__ai.profile, profiles[role], `wrong acting-role profile at ${ordinal}`)
            const saved = clone(state), argument = clone(decision.argument), opponent = role === "Japan" ? "Allies" : "Japan"
            const opponentProfile = clone(state.ai_profile?.[opponent] || null)
            state = rules.action(state, role, decision.action, decision.argument)
            roleActions[role]++
            assert.deepEqual(state.ai_profile?.[role], profiles[role], `profile was not persisted for ${role}`)
            assert.deepEqual(state.ai_profile?.[opponent] || null, opponentProfile, `action ${ordinal} contaminated the opponent profile`)
            history.push({ ordinal, role, phase, action: decision.action, turn: state.turn })
            const groundMoved = []
            for (let id = 1; id < state.location.length; id++) {
                const p = rules.pieces[id], from = saved.location[id], to = state.location[id]
                if (p?.faction === 1 && p.class === "ground" && from > 0 && from < 1478 && to > 0 && to < 1478 && from !== to)
                    groundMoved.push({ id, name: p.name, from, to })
            }
            if (role === "Allies" && roleActions.Japan > 0 && /move|movement/i.test(phase || "") && ["advance", "action_hex", "stop"].includes(decision.action) && groundMoved.length) {
                assert(roleActions.Japan > 0 && roleActions.Allies > 0, "fixture must include both roles' genuine actions")
                fixture = { rules, before: saved, expected: clone(state), argument, action: decision.action,
                    role, ordinal, groundMoved, profiles, roleActions, history: history.slice(-12) }
                return fixture
            }
        }
        assert.fail(`No actual allied ground movement action in 600 legal steps. Last actions: ${JSON.stringify(history.slice(-12))}; phase=${state.L?.P}`)
    })
}

test("real campaign ground movement survives JSON save and action-only replay in a fresh Node process", { timeout: 120000 }, () => {
    const f = movingFixture()
    const restored = freshProcess({ mode: "action", state: f.before, role: f.role, action: f.action, argument: f.argument })
    assert.equal(restored.digest, stateDigest(f.expected),
        `action ${f.ordinal} ${f.action}; moved ${JSON.stringify(f.groundMoved)}; first state differences: ${JSON.stringify(changedFields(f.expected, restored.state))}`)
    assert.deepEqual(restored.state.log, f.expected.log, "full gameplay and strategy log must survive; do not drop logs to make replay pass")
})

test("same-game Japan and Allies retain separate effective configs across actual alternating actions", { timeout: 120000 }, () => {
    const f = movingFixture()
    assert(f.roleActions.Japan > 0 && f.roleActions.Allies > 0)
    assert.deepEqual(f.expected.ai_profile.Japan, f.profiles.Japan)
    assert.deepEqual(f.expected.ai_profile.Allies, f.profiles.Allies)
    assert.notEqual(f.expected.ai_profile.Japan.emMinPWin, f.expected.ai_profile.Allies.emMinPWin)
    withTestEnvironment(() => {
        assert.deepEqual(f.rules.bot_config(BOTS.Japan, "Japan"), f.profiles.Japan)
        assert.deepEqual(f.rules.bot_config(BOTS.Allies, "Allies"), f.profiles.Allies)
    })
})

test("saved next decision is identical after another game warms the module and in a fresh process", { timeout: 120000 }, () => {
    const f = movingFixture()
    withTestEnvironment(() => {
        // Intentionally contaminate process caches with another seed before loading the saved game.
        let other = f.rules.setup(SEED + 1, SCENARIO, { headless_moves: true })
        for (let i = 1; i <= 16 && other.active !== "None"; i++) {
            const role = activeRole(other), view = f.rules.view(other, role)
            const d = f.rules.bots[BOTS[role]].decide(view, { role, seed: SEED + 1, actionOrdinal: i })
            validateAction(view, d)
            other = f.rules.action(other, role, d.action, d.argument)
        }
        const saved = clone(f.expected), role = activeRole(saved), context = { role, seed: SEED, actionOrdinal: f.ordinal + 1 }
        const view = f.rules.view(saved, role), unchanged = JSON.stringify(saved)
        const hotDecision = f.rules.bots[BOTS[role]].decide(view, context)
        validateAction(view, hotDecision)
        assert.equal(JSON.stringify(saved), unchanged, "warm restored-game decide must not modify the save")
        const cold = freshProcess({ mode: "decision", state: clone(f.expected), role, bot: BOTS[role], context })
        assert.deepEqual(clone(hotDecision), cold.decision, `restored decision depends on another game's module caches; action ordinal ${f.ordinal + 1}`)
    })
})

test("a new game's first decision agrees between a used module and a fresh Node process", { timeout: 120000 }, () => {
    const f = movingFixture()
    withTestEnvironment(() => {
        const seed = SEED + 2
        const state = f.rules.setup(seed, SCENARIO, { headless_moves: true }), saved = clone(state), role = activeRole(state)
        const context = { role, seed, actionOrdinal: 1 }, view = f.rules.view(state, role), unchanged = JSON.stringify(state)
        const decision = f.rules.bots[BOTS[role]].decide(view, context)
        validateAction(view, decision)
        assert.equal(JSON.stringify(state), unchanged, "new-game decide must not mutate serialized state")
        const cold = freshProcess({ mode: "decision", state: saved, role, bot: BOTS[role], context })
        assert.deepEqual(clone(decision), cold.decision, "new game inherited strategic/cache state from a previous game")
    })
})
