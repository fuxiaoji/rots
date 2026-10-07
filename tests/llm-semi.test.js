"use strict"
// LLM-SEMI-01: 半自动模式单元测试。mock 客户端驱动，不发起真实请求。
const test = require("node:test"), assert = require("node:assert/strict")
const rules = require("../rules")
const { hash, clone } = require("../js/server/llm/observation")
const semi = require("../js/server/llm/semi")
const api = require("../js/server/llm/session")
const scenario = "1942-1945 (The Shortened Campaign)"

const MANILA = "2813", KUANTAN = "2014"
function mockAnswer(name = "激进的南方资源战略", targets = [MANILA, KUANTAN]) {
    return { content: JSON.stringify({ strategy: name, targets, reason: "测试: 先夺马尼拉再取关丹" }),
        model: "mock", usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }, latencyMs: 1 }
}
function mockClient(answer = mockAnswer()) { return { complete: async () => answer } }

test("战略目录查询：当前阶段命名战略+默认链，纯只读不 mutating", () => {
    const s = rules.setup(20262602, scenario, { headless_moves: true }), before = hash(s)
    const catalog = rules.query(clone(s), "Japan", "llm_semi_catalog")
    assert.equal(hash(s), before)
    assert.equal(catalog.role, "Japan"); assert.equal(catalog.phase, "early")
    const names = catalog.strategies.map(x => x.name)
    for (const expected of ["激进的空优战略", "保守的空优战略", "激进的南方资源战略", "中缅印战略", "事件战略"]) assert(names.includes(expected), expected)
    const aggressive = catalog.strategies.find(x => x.name === "激进的南方资源战略")
    assert.equal(aggressive.kind, "CONQUEST"); assert(aggressive.defaultChain.length >= 3)
    for (const t of aggressive.defaultChain) { assert(Number.isInteger(t.hex)); assert(t.mapId && t.name); assert(["Japan", "Allies", null].includes(t.control)) }
    const allies = rules.query(clone(s), "Allies", "llm_semi_catalog")
    assert(allies.strategies.some(x => x.name === "建立ABDA")); assert(allies.strategies.every(x => !["激进的空优战略"].includes(x.name)))
})

test("半自动观察包：全地图、国家状态、目录与守军事实齐全且只读", () => {
    const s = rules.setup(20262602, scenario, { headless_moves: true }), before = hash(s)
    const packet = semi.buildPacket(rules, s, "Japan", { profile: { id: "deepseek", model: "mock" }, strategyLog: [] })
    assert.equal(hash(s), before)
    const worldManila = packet.payload.world.rows.find(r => String(r[0]) === MANILA)
    assert(worldManila, "world表须含马尼拉(2813)")
    const ph = packet.payload.nations.find(n => n.key === "PHILIPPINES")
    assert.deepEqual(ph.remainingKeys, [2813]); assert.equal(ph.surrenderedTurn, 0)
    assert(packet.payload.strategyCatalog.strategies.some(x => x.name === "激进的南方资源战略"))
    assert(packet.payload.units.rows.length > 50)
    assert(packet.payload.keyDefenders.some(d => String(d.mapId) === MANILA))
    assert(Number.isInteger(packet.mapIndex.get(MANILA)))
    const { messagesFor } = semi
    const m = messagesFor(packet, null)
    assert(m.messages[0].content.includes("半自动模式") && m.messages[0].content.includes("输出合同"))
    assert(m.messages[0].content.includes(MANILA))
    const parsed = semi.parseAnswer(mockAnswer().content, packet)
    assert.equal(parsed.name, "激进的南方资源战略")
    assert.equal(parsed.chain[0], packet.mapIndex.get(MANILA), "链首=马尼拉engineHex")
    assert.equal(parsed.chain[1], packet.mapIndex.get(KUANTAN))
    assert.equal(parsed.chain.length, 2)
    assert.throws(() => semi.parseAnswer(JSON.stringify({ strategy: "不存在的战略", targets: [] }), packet), /战略目录/)
    const dropped = semi.parseAnswer(JSON.stringify({ strategy: "激进的南方资源战略", targets: [MANILA, "9999", MANILA, "2915"] }), packet)
    assert.deepEqual(dropped.dropped, ["9999"]); assert.equal(dropped.chain.length, 2)
})

test("半自动会话：LLM战略链被钉选执行，trace/strategyLog/回放一致", async () => {
    const s = api.createSession({ seed: 20262602, scenario, players: { Japan: "llmsemi:deepseek", Allies: "erasmus-v2-opt-v5" }, maxRequests: 400 },
        { clients: { deepseek: mockClient() } })
    let llmDecisions = 0, committedAfterDecision = 0
    for (let i = 0; i < 40 && s.status === "playing"; i++) {
        await api.step(s, { revision: s.revision })
        if (s.lastDecision?.trace?.policy === "llm-semi") {
            committedAfterDecision++
            if (s.lastDecision.trace.strategy?.strategy) llmDecisions++
        }
    }
    assert(llmDecisions >= 1, "至少一次选牌窗LLM决策")
    const entry = s.strategyLog.find(x => x.source === "llm")
    assert(entry, "strategyLog记录LLM决策")
    assert.equal(entry.strategy, "激进的南方资源战略")
    assert.deepEqual(entry.chain.slice(0, 2), [engineOf(s, MANILA), engineOf(s, KUANTAN)])
    // 钉选结果进入引擎AI运行时：EOP override 链首=LLM 链首
    const runtime = s.state.ai_runtime?.Japan
    assert(runtime?.override, "日本AI运行时已带战略覆盖")
    assert.equal(runtime.override.chain[0], engineOf(s, MANILA))
    assert.equal(runtime.override.chain[1], engineOf(s, KUANTAN))
    // [ERASMUS] 日志标注 LLM 半自动
    assert(s.state.log.some(l => l.includes("LLM半自动")), "RTT日志须标注LLM半自动钉选")
    const replay = api.replay(s)
    assert(api.verifyReplay(replay).verified)
    assert(replay.strategyLog.length >= 1)
    // 存档恢复后继续（无状态 mock 持续回答），strategyLog 延续
    const restored = api.restoreSession(api.serializeSession(s), { clients: { deepseek: mockClient() }, allowPolicyMigration: true })
    assert.deepEqual(restored.strategyLog, s.strategyLog)
    for (let i = 0; i < 5 && restored.status === "playing"; i++) await api.step(restored, { revision: restored.revision })
    assert(restored.strategyLog.length >= s.strategyLog.length)
})
function engineOf(s, mapId) {
    const hexes = s.rules.query(clone(s.state), "Japan", "llm_public_data").hexes
    return hexes.find(h => String(h.id) === String(mapId)).hex
}

test("格式无效回退：两次无效→本牌程序默认战略，对局继续且与纯bot行为一致", async () => {
    const bad = mockClient({ content: "我不是JSON", model: "mock", usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 }, latencyMs: 1 })
    const s = api.createSession({ seed: 20262602, scenario, players: { Japan: "llmsemi:deepseek", Allies: "erasmus-v2-opt-v5" }, maxRequests: 400 }, { clients: { deepseek: bad } })
    const plain = api.createSession({ seed: 20262602, scenario, players: { Japan: "erasmus-v2-opt-v5", Allies: "erasmus-v2-opt-v5" } })
    for (let i = 0; i < 30; i++) {
        if (s.status !== "playing") break
        await api.step(s, { revision: s.revision })
        await api.step(plain, { revision: plain.revision })
    }
    assert(s.strategyLog.some(x => x.source === "program-default" && x.invalid), "记录无效回退")
    assert(s.stats.invalidResponses >= 2)
    assert.equal(s.actions.length, plain.actions.length)
    for (let i = 0; i < s.actions.length; i++) {
        assert.equal(s.actions[i].action, plain.actions[i].action)
        assert.equal(s.actions[i].stateHash, plain.actions[i].stateHash, `动作${i}状态哈希须与纯bot一致`)
    }
})

test("接口失败/预算耗尽：明确暂停，不静默换机器人", async () => {
    const failing = { complete: async () => { const e = new Error("EOTS_LLM_HTTP_ERROR (HTTP 429)"); e.code = "EOTS_LLM_HTTP_ERROR"; throw e } }
    const s = api.createSession({ seed: 20262602, scenario, players: { Japan: "llmsemi:deepseek", Allies: "erasmus-v2-opt-v5" } }, { clients: { deepseek: failing } })
    let rejected = null
    for (let i = 0; i < 40 && !rejected && s.status === "playing"; i++) {
        try { await api.step(s, { revision: s.revision }) } catch (e) { rejected = e.code }
    }
    assert.equal(rejected, "EOTS_LLM_HTTP_ERROR")
    assert.equal(s.status, "paused"); assert.equal(s.error.code, "EOTS_LLM_HTTP_ERROR")

    const good = mockClient()
    const b = api.createSession({ seed: 20262602, scenario, players: { Japan: "llmsemi:deepseek", Allies: "erasmus-v2-opt-v5" }, maxRequests: 1 }, { clients: { deepseek: good } })
    let stopped = null
    for (let i = 0; i < 60 && b.status === "playing"; i++) {
        try { await api.step(b, { revision: b.revision }) } catch (e) { stopped = e.code; break }
    }
    assert.equal(stopped, "BUDGET"); assert.equal(b.status, "paused"); assert.equal(b.stats.requests, 1)
})

test("半自动窗口判定与选牌窗一致（与 esm_is_card_window 同步）", () => {
    assert(semi.isStrategyWindow({ prompt: "Select card to play.", actions: { card: [1, 2] } }))
    assert(!semi.isStrategyWindow({ prompt: "Select action.", actions: { ops: 1 } }))
    assert(!semi.isStrategyWindow({ prompt: "Activate units: 1 of 5.", actions: { unit: [1] } }))
    assert(!semi.isStrategyWindow({ prompt: null, actions: {} }))
})

test("每张己方牌都询问一次模型；非己方窗口不询问", async () => {
    let calls = 0
    const counting = { complete: async () => { calls++; return mockAnswer() } }
    const s = api.createSession({ seed: 20262602, scenario, players: { Japan: "llmsemi:deepseek", Allies: "erasmus-v2-opt-v5" }, maxRequests: 400 }, { clients: { deepseek: counting } })
    for (let i = 0; i < 90 && s.status === "playing"; i++) await api.step(s, { revision: s.revision })
    assert(calls >= 2, "日本前两张牌应各询问一次")
    assert.equal(s.stats.requests, calls)
    const turns = [...new Set(s.strategyLog.map(x => x.turn))]
    assert(s.strategyLog.every(x => x.role === "Japan"))
    assert(s.strategyLog.length >= 2 && turns.length >= 1)
})
