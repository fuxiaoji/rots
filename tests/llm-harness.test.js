"use strict"
const test = require("node:test"), assert = require("node:assert/strict")
const rules = require("../rules"), api = require("../js/server/llm/session")
const { observe, clone, hash } = require("../js/server/llm/observation"), { boardPng } = require("../js/server/llm/board")
const { messagesFor } = require("../js/server/llm/prompt"), { getProfile } = require("../js/server/llm/providers")
const { parseAnswer } = require("../js/server/llm/harness")
const profile = { ...getProfile("deepseek", {}), apiKey: "mock", model: "mock" }
function payload(messages) { const c = messages[1].content; return JSON.parse((typeof c === "string" ? c : c[0].text).split("\n上次输出无效：")[0]) }
function answer(messages, candidateIndex = 0) { const p = payload(messages); return { content: JSON.stringify({ decisionId: p.decisionId,
    candidateId: p.candidates[candidateIndex].id, reason: "合法候选", memory: { objective: "目标甲", notes: ["观察甲"] } }),
    model: "mock", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, latencyMs: 1 } }
function game(client, options = {}, vision = false) { return api.createSession({ players: { Japan: "erasmus-v2-opt-v5", Allies: "llm:deepseek" }, ...options },
    { clients: { deepseek: client }, profiles: { deepseek: { ...profile, vision } } }) }
test("v4 accepts current exact candidate without nonce; rejects stale IDs and ignores model actions", () => {
    const p = observe(rules, rules.setup(20261005, "South Pacific", { headless_moves: true }), "Allies", 8)
    const c = p.candidates[0]
    for (const decisionId of [undefined, "incorrect-legacy-nonce"])
        assert.equal(parseAnswer(JSON.stringify({ candidateId: c.id, decisionId, action: "invented", argument: 999 }), p, "internal").candidate, c)
    assert.throws(() => parseAnswer(JSON.stringify({ candidateId: c.id.replace("r8-", "r7-") }), p, "internal"), e => e.code === "FORMAT")
    const prompt = payload(messagesFor(p, null, "secret-internal-nonce").messages)
    assert(!Object.hasOwn(prompt, "decisionId"))
    assert(!JSON.stringify(messagesFor(p, null, "secret-internal-nonce").messages).includes("secret-internal-nonce"))
})
test("stranded selected movement retains only declared undo; real paths and other windows do not gain undo", () => {
    const state = rules.setup(20261005, "South Pacific", { headless_moves: true })
    let paths = [], phase = "move_offensive_units", actions = { move: 1, undo: 1 }
    const wrapped = { view: (s, role) => {
        const v = rules.view(s, role)
        return { ...v, ai: { ...v.ai, state: phase }, active_stack: [188], move_type: 4, actions }
    }, query: (s, role, q) => q === "llm_legal_moves" ? paths : rules.query(s, role, q) }
    const before = hash(state)
    assert.deepEqual(observe(wrapped, state, "Allies", 0).candidates.map(c => c.action), ["undo"])
    paths = [{ hex: 745, path: [745] }]
    assert.deepEqual(observe(wrapped, state, "Allies", 0).candidates.map(c => c.action), ["move"])
    paths = []; phase = "post_battle_move"
    assert.deepEqual(observe(wrapped, state, "Allies", 0).candidates, [])
    phase = "move_offensive_units"; actions = { move: 1 }
    assert.deepEqual(observe(wrapped, state, "Allies", 0).candidates, [])
    assert.equal(hash(state), before)
})
test("hidden enemy hand, deck, PRNG and enemy memory do not affect text or board", () => {
    const state = rules.setup(20261005, "South Pacific", { headless_moves: true }), other = clone(state)
    other.seed = 99999; other.hand[0] = other.hand[0].map((_, i) => 70 + i); other.draw[0].reverse()
    other.ai_plan = { Japan: { secret: "enemy-private-memory" } }; other.offensive.card_rollback = { secret: "server-secret" }
    const a = observe(rules, state, "Allies", 0), b = observe(rules, other, "Allies", 0)
    assert.deepEqual(a, b)
    assert.equal(hash(boardPng(a.observation)), hash(boardPng(b.observation)))
    assert(!JSON.stringify(messagesFor(a, null, "id").messages).includes("enemy-private-memory"))
    assert.deepEqual(state, rules.setup(20261005, "South Pacific", { headless_moves: true }), "observation does not mutate state")
})
test("valid LLM action commits memory once, replay and private restore consume zero API", async () => {
    let calls = 0; const client = { complete: async m => { calls++; return answer(m) } }, s = game(client)
    await api.step(s, { revision: 0 }); assert.equal(s.revision, 1); assert.equal(calls, 1)
    assert.equal(s.memories.Allies.objective, "目标甲"); assert.equal(s.memories.Japan, null)
    assert.equal(s.memories.Allies.recent.length, 1)
    assert.equal(api.verifyReplay(api.replay(s)).verified, true)
    const restored = api.restoreSession(api.serializeSession(s), { clients: { deepseek: client }, profiles: { deepseek: profile } })
    assert.deepEqual(restored.memories, s.memories); assert.equal(api.digest(restored.state), api.digest(s.state)); assert.equal(calls, 1)
    assert(!JSON.stringify(api.snapshot(s)).includes("目标甲"), "observer cannot see model memory")
})
test("invalid JSON/unknown candidate gets one bounded repair, then leaves state/memory unchanged", async () => {
    const s = game({ complete: async () => ({ content: '{"decisionId":"wrong","candidateId":"invented"}', usage: { total_tokens: 1 } }) })
    const before = api.digest(s.state)
    await assert.rejects(api.step(s, { revision: 0 }), e => e.code === "FORMAT")
    assert.equal(s.stats.requests, 2); assert.equal(s.stats.retries, 1); assert.equal(s.stats.invalidResponses, 2)
    assert.equal(s.revision, 0); assert.equal(api.digest(s.state), before); assert.equal(s.memories.Allies, null)
})
test("format repair succeeds using original candidate table and records both requests", async () => {
    let calls = 0; const s = game({ complete: async m => ++calls === 1 ? { content: "bad", usage: { total_tokens: 1 } } : answer(m) })
    await api.step(s, { revision: 0 }); assert.equal(s.stats.requests, 2); assert.equal(s.actions[0].trace.requests, 2)
})
test("requests/token budget pauses explicitly with no robot fallback or memory update", async () => {
    let calls = 0; const s = game({ complete: async m => { calls++; return answer(m) } }, { maxTotalTokens: 1 })
    const before = api.digest(s.state)
    await assert.rejects(api.step(s, { revision: 0 }), e => e.code === "BUDGET")
    assert.equal(calls, 1); assert.equal(api.digest(s.state), before); assert.equal(s.memories.Allies, null)
    const exhausted = game({ complete: async m => { calls++; return answer(m) } }, { maxRequests: 1 }); exhausted.stats.requests = 1
    await assert.rejects(api.step(exhausted, { revision: 0 }), e => e.code === "BUDGET"); assert.equal(calls, 1)
})
test("provider failures are counted and paused, not hidden by a fallback", async () => {
    const s = game({ complete: async () => { const e = Error("secret-transport-message"); e.code = "EOTS_LLM_HTTP_ERROR"; throw e } })
    await assert.rejects(api.step(s, { revision: 0 }), e => e.code === "EOTS_LLM_HTTP_ERROR" && !e.message.includes("secret"))
    assert.equal(s.stats.failedRequests, 1); assert.equal(s.revision, 0); assert.equal(s.status, "paused")
})
test("stale requests and overlapping operations cannot commit twice", async () => {
    let release; const s = game({ complete: m => new Promise(resolve => { release = () => resolve(answer(m)) }) })
    const pending = api.step(s, { revision: 0 })
    await assert.rejects(api.step(s, { revision: 0 }), e => e.code === "BUSY")
    s.revision++; release(); await assert.rejects(pending, e => e.code === "STALE")
    assert.equal(s.actions.length, 0); assert.equal(s.memories.Allies, null)
    await assert.rejects(api.step(s, { revision: 0 }), e => e.code === "STALE")
})
test("vision payload uses PNG from same observation; text payload has no image", async () => {
    for (const vision of [false, true]) {
        let inspected = false; const s = game({ complete: async m => {
            inspected = true; assert.equal(Array.isArray(m[1].content), vision)
            if (vision) assert(m[1].content[1].image_url.url.startsWith("data:image/png;base64,iVBOR"))
            return answer(m)
        } }, {}, vision)
        await api.step(s, { revision: 0 }); assert(inspected)
    }
})
test("human choices use only current candidate IDs and cannot read other role", async () => {
    const s = api.createSession({ players: { Japan: "erasmus-v2-opt-v5", Allies: "human" } })
    assert.throws(() => api.snapshot(s, "Japan"), e => e.code === "VIEW_ROLE")
    await assert.rejects(api.step(s, { revision: 0, role: "Allies", candidateId: "invented" }), e => e.code === "ILLEGAL")
    const p = api.snapshot(s); await api.step(s, { revision: 0, role: "Allies", candidateId: p.candidates[0].id })
    assert.equal(s.revision, 1); assert.equal(s.stats.requests, 0)
})
test("same injected model playing both sides retains separate memories", async () => {
    const client = { complete: async m => { const r = answer(m); const a = JSON.parse(r.content); a.memory.objective = payload(m).observation.role; r.content = JSON.stringify(a); return r } }
    const s = game(client, { players: { Japan: "llm:deepseek", Allies: "llm:deepseek" } })
    for (let i = 0; i < 20 && (!s.memories.Japan || !s.memories.Allies); i++) await api.step(s, { revision: s.revision })
    assert.equal(s.memories.Japan?.objective, "Japan"); assert.equal(s.memories.Allies?.objective, "Allies")
})
test("FSM natural ending uses same engine and exact action-only replay", async () => {
    const s = api.createSession({ seed: 424243, players: { Japan: "erasmus-v2", Allies: "erasmus-v2" } })
    for (let i = 0; i < 3000 && s.status !== "complete"; i++) await api.step(s, { revision: s.revision })
    assert.equal(s.status, "complete"); assert.equal(s.stats.requests, 0)
    assert.equal(api.verifyReplay(api.replay(s)).complete, true)
})
test("engine movement destinations expose actual executable paths, not raw move buttons", async () => {
    const s = api.createSession({ seed: 20261005, players: { Japan: "erasmus-v2-opt-v5", Allies: "erasmus-v2-opt-v5" } })
    let checked = false
    for (let i = 0; i < 300 && s.status !== "complete"; i++) {
        const role = Array.isArray(s.state.active) ? s.state.active[0] : s.state.active
        const v = rules.view(clone(s.state), role)
        if (v.ai.state === "move_offensive_units" && Array.isArray(v.actions.unit) && !v.active_stack.length) {
            const selected = clone(s.state); rules.view(selected, role); const next = rules.action(selected, role, "unit", v.actions.unit[0])
            const p = observe(rules, next, role, s.revision)
            assert(!p.candidates.some(c => c.action === "move" && !Array.isArray(c.argument)))
            const moves = p.candidates.filter(c => c.action === "move")
            const prompt = payload(messagesFor(p, null, "movement-test").messages)
            assert.deepEqual(prompt.candidates.filter(c => c.action === "move").map(c => c.argument), moves.map(c => c.argument))
            assert(p.candidates.find(c => c.action === "unit" && c.argument === v.actions.unit[0]).label.startsWith("取消选择"))
            if (moves.length) { for (const c of [moves[0], moves[moves.length - 1]]) { const trial = clone(next); rules.view(trial, role); assert.doesNotThrow(() => rules.action(trial, role, c.action, clone(c.argument))) } checked = true; break }
        }
        await api.step(s, { revision: s.revision })
    }
    assert(checked, "must reach and check a real movement window")
})

test("activation toggles, budget and South Pacific score projection match public engine state without mutation", async () => {
    const s = api.createSession({ seed: 20261005, players: { Japan: "erasmus-v2-opt-v5", Allies: "erasmus-v2-opt-v5" } })
    await api.step(s, { revision: 0 }); await api.step(s, { revision: 1 })
    const original = clone(s.state), p = observe(rules, s.state, "Allies", 2)
    assert.equal(p.observation.state, "activate_units")
    assert.equal(p.observation.scenario.name, "South Pacific")
    assert.equal(p.observation.scenario.lastTurn, 6)
    assert.equal(p.observation.scenario.victoryMode, "south-pacific-vp")
    assert.equal(p.observation.scenario.victory.vp, 12)
    assert.equal(p.observation.scenario.victory.evaluation, "if-scored-now")
    assert.equal(p.observation.activation.limit, 7)
    const select = p.candidates.find(c => c.action === "unit" && c.argument === 87)
    assert(select.label.startsWith("激活单位"))
    const copy = clone(s.state); rules.view(copy, "Allies")
    const selected = rules.action(copy, "Allies", select.action, select.argument)
    const next = observe(rules, selected, "Allies", 3)
    assert.deepEqual(next.observation.activeUnits, [87])
    assert.deepEqual(next.observation.selectedMovementUnits, [])
    assert.equal(next.observation.activation.activeCount, 1)
    assert.equal(next.observation.activation.remaining, 6)
    const cancel = next.candidates.find(c => c.action === "unit" && c.argument === 87)
    assert(cancel.label.startsWith("取消激活")); assert.equal(cancel.argument, select.argument)
    const trial = clone(selected); rules.view(trial, "Allies")
    const unselected = rules.action(trial, "Allies", cancel.action, cancel.argument)
    assert.deepEqual(observe(rules, unselected, "Allies", 4).observation.activeUnits, [])
    assert.equal(observe(rules, selected, "Observer", 3).observation.activation, null)
    const beforeQuery = clone(selected)
    rules.query(selected, "Allies", "llm_public_data")
    assert.deepEqual(selected, beforeQuery)
    assert.equal(hash(s.state), hash(original), "complete serialized state unchanged (sparse arrays use JSON nulls)")
    const context = payload(messagesFor(next, null, "exact-nonce").messages)
    assert(context.rules.some(r => r.file === "docs/rules/llm-south-pacific.md"))
    assert(!context.rules.some(r => r.file.endsWith("16-campaign-victory.md")))
})

test("paid provider failures count tokens, unknown failures are not reported as free, ledger survives restore", async () => {
    const client = { complete: async () => { throw Object.assign(Error("truncated"), { code: "EOTS_LLM_TRUNCATED_RESPONSE", usage: { total_tokens: 60 }, model: "paid-model", latencyMs: 10 }) } }
    const s = game(client, { maxTotalTokens: 50 })
    await assert.rejects(api.step(s, { revision: 0 }))
    assert.equal(s.stats.totalTokens, 60); assert.equal(s.requestLedger.length, 1); assert.equal(s.requestLedger[0].usage.total_tokens, 60)
    await assert.rejects(api.step(s, { revision: 0 }), e => e.code === "BUDGET"); assert.equal(s.stats.requests, 1)
    const restored = api.restoreSession(api.serializeSession(s), { clients: { deepseek: client }, profiles: { deepseek: profile } })
    assert.deepEqual(restored.requestLedger, s.requestLedger)
    const unknown = game({ complete: async () => { throw Object.assign(Error("network"), { code: "EOTS_LLM_TIMEOUT" }) } })
    await assert.rejects(api.step(unknown, { revision: 0 })); assert.equal(unknown.stats.usageUnknown, 1)
})

test("display failure after successful commit does not falsely promise unchanged game", async () => {
    let failView = false
    const wrapped = { ...rules, view: (...args) => { if (failView) throw Error("projection failure"); return rules.view(...args) },
        action: (...args) => { const next = rules.action(...args); failView = true; return next } }
    const s = api.createSession({ players: { Japan: "erasmus-v2", Allies: "llm:deepseek" } }, { rules: wrapped, clients: { deepseek: { complete: async m => answer(m) } }, profiles: { deepseek: profile } })
    const before = api.digest(s.state)
    await assert.rejects(api.step(s, { revision: 0 }), e => e.code === "COMMITTED_VIEW_ERROR")
    assert.equal(s.revision, 1); assert.equal(s.actions.length, 1); assert.notEqual(api.digest(s.state), before)
    assert.equal(s.memories.Allies.objective, "目标甲")
})

test("resume preserves paused state/decision and requires explicit policy migration", async () => {
    const client = { complete: async m => answer(m) }, s = game(client)
    await api.step(s, { revision: 0 }); s.status = "paused"; s.error = { code: "BUDGET", message: "paused" }
    const saved = api.serializeSession(s), deps = { clients: { deepseek: client }, profiles: { deepseek: profile } }
    const restored = api.restoreSession(saved, deps)
    assert.equal(restored.status, "paused"); assert.deepEqual(restored.lastDecision, s.lastDecision); assert.deepEqual(restored.error, s.error)
    saved.replay.moduleHashes.harness = "changed-policy"
    assert.throws(() => api.restoreSession(saved, deps), e => e.code === "POLICY_CHANGED")
    const migrated = api.restoreSession(saved, { ...deps, allowPolicyMigration: true })
    assert.equal(migrated.policyMigrations.length, 1); assert.equal(migrated.policyMigrations[0].revision, s.revision)
})

test("scripted provider completes full LLM protocol match with isolated memory and exact replay", async () => {
    let s
    const client = { complete: async m => {
        const p = payload(m), role = p.observation.role, copied = clone(s.state), view = s.rules.view(copied, role)
        const d = s.rules.bots["erasmus-v2"].decide(view, { role, seed: s.options.seed, actionOrdinal: s.revision + 1 })
        const raw = d.argument?.__ai ? d.argument.action : d.argument
        const packet = api.packet(s, role)
        const candidate = packet.candidates.find(c => c.action === d.action && JSON.stringify(c.argument ?? null) === JSON.stringify(raw ?? null))
            || packet.candidates.find(c => c.action === d.action)
        assert(candidate, "scripted policy action must be present in LLM table")
        return { content: JSON.stringify({ decisionId: p.decisionId, candidateId: candidate.id, memory: { objective: role, notes: [] } }), usage: { total_tokens: 1 } }
    } }
    s = game(client, { seed: 424243, players: { Japan: "llm:deepseek", Allies: "llm:deepseek" }, maxRequests: 3000 })
    for (let i = 0; i < 3000 && s.status !== "complete"; i++) await api.step(s, { revision: s.revision })
    assert.equal(s.status, "complete"); assert(s.stats.requests > 0); assert.equal(s.requestLedger.length, s.stats.requests)
    assert.equal(api.verifyReplay(api.replay(s)).complete, true)
    assert.equal(s.memories.Japan.objective, "Japan"); assert.equal(s.memories.Allies.objective, "Allies")
})
