"use strict"
const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path")
const { createRequire } = require("node:module")
const runtime = process.env.RTT_RUNTIME_ROOT || "D:/desktop/rots-runtime-pve"
const Database = createRequire(path.join(runtime, "server.js"))("better-sqlite3")
const { createBridge, summary, creatorAllowed, limits } = require("../js/server/llm/rtt")
const rules = require("../rules"), { hash } = require("../js/server/llm/observation")
const env = { DEEPSEEK_API_KEY: "mock" }
const seats = [{ role: "Japan", bot_id: "erasmus-v2-opt-v5" }, { role: "Allies", bot_id: "llm-deepseek" }]
function setup(factory, options = {}) {
    const db = new Database(":memory:")
    db.exec("CREATE TABLE game_ai_trace(game_id INTEGER,replay_id INTEGER,role TEXT,private_trace TEXT)")
    const bridge = createBridge(db, { env: { ...env }, clientFactory: factory })
    bridge.init(1, options, seats)
    const state = rules.setup(20261005, "South Pacific", { headless_moves: true })
    const args = { id: 1, rules, state, role: "Allies", botId: "llm-deepseek", revision: 1, options, seats, stillCurrent: () => true }
    return { db, bridge, args }
}
function response(messages) {
    const p = JSON.parse(messages[1].content.split("\n上次输出无效：")[0])
    return { content: JSON.stringify({ candidateId: p.candidates[0].id, reason: "简短说明", memory: { objective: "目标甲", notes: ["备注甲"] } }), model: "mock-real", latencyMs: 3, usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }
}
test("native bridge persists budget before sending; commits memory only in RTT transaction", async () => {
    let calls = 0, current
    const s = setup(() => ({ complete: async messages => {
        calls++; current = s.bridge.get(1)
        assert.equal(current.stats.requests, 1); assert(current.pending)
        return response(messages)
    } }))
    const before = hash(s.args.state), decision = await s.bridge.decide(s.args)
    assert.equal(hash(s.args.state), before); assert.deepEqual(s.bridge.get(1).memories, {})
    assert.equal(decision.publicTrace.explanation, undefined)
    assert.equal(decision.publicTrace.model, "mock-real")
    s.db.exec("BEGIN")
    decision.commit(2)
    s.db.exec("ROLLBACK")
    assert.deepEqual(s.bridge.get(1).memories, {})
    // Prepared response survives process recovery and an action-save failure, without another paid request.
    const restored = createBridge(s.db, { env: { ...env }, clientFactory: () => { throw Error("duplicate") } })
    const again = await restored.decide(s.args)
    s.db.transaction(() => again.commit(2))()
    assert.equal(calls, 1); assert.equal(restored.get(1).memories.Allies.objective, "目标甲")
    assert.equal(restored.get(1).stats.actions, 1)
    assert.equal(restored.get(1).prepared, null)
})
test("stale response is charged but cannot commit private memory", async () => {
    const s = setup(() => ({ complete: async m => response(m) }))
    await assert.rejects(s.bridge.decide({ ...s.args, stillCurrent: () => false }), e => e.code === "STALE")
    assert.deepEqual(s.bridge.get(1).memories, {})
    assert.equal(s.bridge.get(1).stats.requests, 1)
})
test("provider failure and token/request caps persist through recovery; no fallback", async () => {
    const s = setup(() => ({ complete: async () => { const e = Error("secret should never be shown"); e.code = "HTTP_429"; throw e } }), { llm_requests: 1 })
    await assert.rejects(s.bridge.decide(s.args), e => e.code === "HTTP_429")
    const restored = createBridge(s.db, { env: { ...env } })
    assert.equal(restored.get(1).stats.requests, 1)
    assert.equal(restored.get(1).stats.usageUnknown, 1)
    assert(!JSON.stringify(restored.get(1)).includes("secret should"))
    await assert.rejects(restored.decide(s.args), e => e.code === "BUDGET")
    const t = setup(() => ({ complete: async m => response(m) }), { llm_tokens: 1 })
    await assert.rejects(t.bridge.decide(t.args), e => e.code === "BUDGET")
    assert.equal(t.bridge.get(1).stats.totalTokens, 15); assert.deepEqual(t.bridge.get(1).memories, {})
})
test("unknown in-flight request blocks restart and is counted once", async () => {
    const s = setup(() => ({ complete: async m => response(m) }))
    const ctx = s.bridge.get(1)
    ctx.pending = { ordinal: 1 }; ctx.stats.requests = 1; ctx.ledger = [{ ordinal: 1 }]
    s.db.prepare("UPDATE game_llm_runtime SET context=? WHERE game_id=1").run(JSON.stringify(ctx))
    for (let i = 0; i < 2; i++) {
        const restored = createBridge(s.db, { env: { ...env } })
        await assert.rejects(restored.decide(s.args), e => e.code === "UNKNOWN_REQUEST")
        assert.equal(restored.get(1).stats.usageUnknown, 1)
    }
})
test("rewind restores earlier per-side memory while retaining actual costs", async () => {
    const s = setup(() => ({ complete: async m => response(m) }))
    const d = await s.bridge.decide(s.args)
    s.db.transaction(() => {
        d.commit(2)
        s.db.prepare("INSERT INTO game_ai_trace VALUES (?,?,?,?)").run(1, 2, "Allies", JSON.stringify(d.privateTrace))
    })()
    s.bridge.rewind(1, 1)
    assert.deepEqual(s.bridge.get(1).memories, {})
    assert.equal(s.bridge.get(1).stats.requests, 1)
    s.bridge.rewind(1, 2)
    assert.equal(s.bridge.get(1).memories.Allies.objective, "目标甲")
})
test("only AIvsAI creator/admin gets whitelisted summary; no memory/observation/reasoning leak", () => {
    const game = { owner_id: 7, options: JSON.stringify({ mode: "aivai" }) }
    assert(creatorAllowed(game, { user_id: 7 }, seats))
    assert(creatorAllowed(game, { user_id: 1 }, seats))
    assert(!creatorAllowed(game, { user_id: 8 }, seats))
    assert(!creatorAllowed(game, null, seats))
    assert(!creatorAllowed({ ...game, options: '{"mode":"pve"}' }, { user_id: 7 }, seats))
    assert(!creatorAllowed(game, { user_id: 7 }, [seats[0], { role: "Allies" }]))
    assert.deepEqual(summary({ llm: true, explanation: "摘要", memory: { objective: "secret" }, observation: "secret", reasoning_content: "secret" }), { llm: true, explanation: "摘要" })
    assert.throws(() => limits({ llm_requests: "bad" }))
})
test("forced action preserves memory and makes zero model calls", async () => {
    const s = setup(() => { throw Error("no API") })
    const wrapped = { ...rules, view: (state, role) => ({ ...rules.view(state, role), actions: { end: 1 } }) }
    const d = await s.bridge.decide({ ...s.args, rules: wrapped })
    d.commit(2)
    assert.equal(s.bridge.get(1).stats.requests, 0); assert.equal(s.bridge.get(1).stats.forced, 1)
})
test("deleted/reused game IDs cannot receive an old asynchronous response or private context", async () => {
    let release
    const s = setup(() => ({ complete: m => new Promise(resolve => { release = () => resolve(response(m)) }) }))
    s.db.exec("CREATE TABLE games(game_id INTEGER PRIMARY KEY); INSERT INTO games VALUES (1)")
    const bridge = createBridge(s.db, { env: { ...env }, clientFactory: () => ({ complete: m => new Promise(resolve => { release = () => resolve(response(m)) }) }) })
    const pending = bridge.decide(s.args)
    const oldInstance = bridge.get(1).instance
    s.db.exec("DELETE FROM games WHERE game_id=1; INSERT INTO games VALUES (1)")
    const fresh = bridge.init(1, {}, seats)
    release()
    await assert.rejects(pending, e => e.code === "STALE")
    assert.equal(bridge.get(1).instance, fresh.instance)
    assert.equal(bridge.get(1).stats.requests, 0)
    assert(s.db.prepare("SELECT context FROM game_llm_archive WHERE instance=?").get(oldInstance))
})
test("native transaction commits replay/state/memory before failed socket delivery", async () => {
    const s = setup(() => ({ complete: async m => response(m) })), decision = await s.bridge.decide(s.args)
    const fs = require("node:fs"), vm = require("node:vm")
    const source = fs.readFileSync(path.join(runtime, "server.js"), "utf8")
    const fn = source.slice(source.indexOf("function put_new_state("), source.indexOf("const game_ai_locks =", source.indexOf("function put_new_state(")))
    s.db.exec("CREATE TABLE test_replay(id INTEGER PRIMARY KEY,action TEXT); CREATE TABLE test_state(state TEXT)")
    let deliveries = 0
    const host = {
        SQL_BEGIN: { run: () => s.db.exec("BEGIN") }, SQL_COMMIT: { run: () => s.db.exec("COMMIT") }, SQL_ROLLBACK: { run: () => s.db.exec("ROLLBACK") }, db: s.db,
        put_replay: (_id, _role, action) => Number(s.db.prepare("INSERT INTO test_replay(action) VALUES(?)").run(action).lastInsertRowid),
        SQL_INSERT_AI_TRACE: { run() {} }, dont_snap: () => true, RULES: { test: rules },
        put_game_state: (_id, state) => s.db.prepare("INSERT INTO test_state VALUES(?)").run(JSON.stringify(state)),
        game_clients: { 1: ["broken", "live"] }, send_state: socket => { assert.equal(s.db.inTransaction, false); if (socket === "broken") throw Error("disconnected"); deliveries++ },
        is_nobody_active: () => false, send_your_turn_notification_to_offline_users: () => { throw Error("offline notification") }, console: { log() {} },
    }
    vm.runInNewContext(fn, host)
    host.put_new_state("test", 1, { active: "Allies", log: [] }, "Allies", "Allies", decision.action, decision.argument, 1, false,
        { bot_id: "llm-deepseek", policy_version: decision.version, public_trace: decision.publicTrace, private_trace: decision.privateTrace, commit: decision.commit })
    assert.equal(deliveries, 1); assert.equal(s.db.prepare("SELECT count(*) FROM test_replay").pluck().get(), 1)
    assert.equal(s.db.prepare("SELECT count(*) FROM test_state").pluck().get(), 1)
    assert.equal(s.bridge.get(1).memories.Allies.objective, "目标甲"); assert.equal(s.bridge.get(1).prepared, null)
})
