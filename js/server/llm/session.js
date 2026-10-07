"use strict"
const crypto = require("node:crypto"), fs = require("node:fs"), path = require("node:path")
const { observe, visible, activeRole, clone, hash, ROLES } = require("./observation")
const { boardSvg } = require("./board"), { decide, fail } = require("./harness")
const { commitMemory } = require("./memory")
const semi = require("./semi")
const ENGINE = path.resolve(__dirname, "../../../rules.js")
const LOADED_SOURCE = fs.readFileSync(ENGINE, "utf8"), LOADED_HASH = hash(LOADED_SOURCE)
function compileRules(source) { const Module = require("node:module"), m = new Module(ENGINE, module); m.filename = ENGINE; m.paths = Module._nodeModulePaths(path.dirname(ENGINE)); m._compile(source, ENGINE); return m.exports }
const LOADED_RULES = compileRules(LOADED_SOURCE)
const ARCHIVES = path.resolve(__dirname, "../../../llm-private/rules")
function archivedRules(sha) {
    if (!/^[a-f0-9]{64}$/.test(sha)) throw fail("RULES_CHANGED", "规则哈希无效")
    const file = path.join(ARCHIVES, sha + ".js"), source = fs.readFileSync(file, "utf8")
    if (hash(source) !== sha) throw fail("RULES_CHANGED", "归档规则哈希不一致")
    return compileRules(source)
}
function digest(state) { const s = clone(state); for (const k of ["undo", "redo", "persisted_undo", "prepared_undo"]) delete s[k]; return hash(s) }
function gameplayDigest(state) {
    const ignored = new Set(["log", "undo", "redo", "redo_count", "persisted_undo", "prepared_undo", "card_rollback", "weather_rollback", "ai_runtime", "ai_plan", "ai_profile", "supply_cache"])
    return hash(JSON.stringify(state, (key, value) => ignored.has(key) ? undefined : value))
}
function createSession(options = {}, deps = {}) {
    const rules = deps.rules || LOADED_RULES
    if (!deps.rules && hash(fs.readFileSync(ENGINE, "utf8")) !== LOADED_HASH) throw fail("RULES_CHANGED", "规则文件已变化，请重启对战服务")
    const players = options.players || { Japan: "erasmus-v2-opt-v5", Allies: "llm:deepseek" }
    const scenario = options.scenario || "South Pacific", seed = options.seed ?? 20261005
    if (!rules.scenarios.includes(scenario) || !Number.isSafeInteger(seed) || seed <= 0 || seed > 0x7fffffff) throw fail("CONFIG", "剧本或种子无效")
    for (const role of ROLES) {
        const player = players[role]
        if (typeof player !== "string" || player !== "human" && !player.startsWith("llm:") && !player.startsWith("llmsemi:") && !rules.bots[player]) throw fail("CONFIG", "未知玩家配置")
        if (player.startsWith("llmsemi:")) {
            // [LLM-SEMI-01] 半自动：模型只出战略与目标链，执行状态机由 semiBots 指定。
            const botName = options.semiBots?.[role] || "erasmus-v2-opt-v5"
            const bot = rules.bots[botName]
            if (!bot) throw fail("CONFIG", "半自动执行状态机不存在")
            if (bot.scenarios && !bot.scenarios.includes(scenario)) throw fail("CONFIG", "状态机AI不支持该剧本")
        }
        if (rules.bots[player]?.scenarios && !rules.bots[player].scenarios.includes(scenario)) throw fail("CONFIG", "状态机AI不支持该剧本")
        if ((player.startsWith("llm:") || player.startsWith("llmsemi:")) && !deps.clients?.[player.slice(player.indexOf(":") + 1)]) {
            const { getProfile } = require("./providers")
            const p = getProfile(player.slice(player.indexOf(":") + 1))
            if (!p.apiKey) throw fail("CONFIG", "所选模型未配置API密钥")
        }
    }
    if (ROLES.filter(r => players[r] === "human").length > 1) throw fail("CONFIG", "当前页面支持一名人类玩家")
    const limits = { maxRequests: options.maxRequests ?? 200, maxTotalTokens: options.maxTotalTokens ?? 2000000,
        maxActions: options.maxActions ?? 60000 }
    for (const [key, n] of Object.entries(limits)) if (!Number.isSafeInteger(n) || n < 1 || n > (key === "maxTotalTokens" ? 20000000 : 10000000)) throw fail("CONFIG", "预算必须为有界正整数")
    const normalized = { seed, scenario, players: { ...players },
        semiBots: { Japan: options.semiBots?.Japan || "erasmus-v2-opt-v5", Allies: options.semiBots?.Allies || "erasmus-v2-opt-v5" }, ...limits, directOnly: options.directOnly === true }
    return { id: crypto.randomUUID(), revision: 0, options: normalized, limits, rules,
        rulesSha256: deps.rulesSha256 || (deps.rules ? "injected-test-engine" : LOADED_HASH),
        moduleHashes: Object.fromEntries(["observation", "prompt", "memory", "board", "providers", "harness", "session", "semi"].map(n => [n, hash(fs.readFileSync(path.join(__dirname, n + ".js"), "utf8"))])),
        state: rules.setup(seed, scenario, { headless_moves: true }), memories: { Japan: null, Allies: null }, strategyLog: [],
        stats: { requests: 0, retries: 0, failedRequests: 0, invalidResponses: 0, totalTokens: 0, promptTokens: 0,
            completionTokens: 0, usageUnknown: 0, latencyMs: 0, forcedActions: 0, assistedActions: 0, cost: "unknown" },
        actions: [], requestLedger: [], status: "playing", clients: deps.clients || {}, profiles: deps.profiles || {}, cache: new Map(), busy: false, progressWindow: [] }
}
function viewer(s) { return ROLES.find(r => s.options.players[r] === "human") || "Observer" }
function packet(s, role) {
    const key = s.revision + ":" + role
    if (!s.cache.has(key)) s.cache.set(key, observe(s.rules, s.state, role, s.revision, { directOnly: s.options.directOnly, memory: s.memories[role] }))
    return s.cache.get(key)
}
function snapshot(s, role = viewer(s)) {
    // Caller may request only this session's fixed human/public perspective.
    if (role !== viewer(s)) throw fail("VIEW_ROLE", "禁止读取对手私有视图")
    const p = packet(s, role), own = s.lastDecision?.role === role
    const last = s.lastDecision ? { role: s.lastDecision.role, policy: s.lastDecision.trace?.policy,
        action: s.lastDecision.action, assisted: !!s.lastDecision.trace?.assisted,
        ...(own ? { reason: s.lastDecision.reason } : {}) } : null
    return { id: s.id, revision: s.revision, role, active: activeRole(s.state), turn: p.observation.turn,
        prompt: p.observation.prompt, observation: p.observation,
        candidates: activeRole(s.state) === role && s.options.players[role] === "human" ? p.candidates : [],
        boardSvg: boardSvg(p.observation), log: p.observation.log, lastDecision: last, stats: clone(s.stats),
        status: s.status, result: s.state.result || null, error: s.error || null }
}
async function step(s, request = {}) {
    if (s.busy) throw fail("BUSY", "本局已有请求正在执行")
    if (request.revision !== s.revision) throw fail("STALE", "棋局版本已变化，请刷新")
    if (s.status === "complete") throw fail("COMPLETE", "对局已经结束")
    if (s.actions.length >= s.limits.maxActions) { s.status = "paused"; throw fail("ACTION_LIMIT", "动作预算已耗尽") }
    const role = activeRole(s.state), player = s.options.players[role]
    if (!ROLES.includes(role)) throw fail("ROLE", "没有活动阵营")
    s.busy = true
    const revision = s.revision
    const priorStatus = s.status
    let committed = false
    try {
        let choice, nextMemory, trace, logs = [], reason = ""
        const p = packet(s, role)
        if (player === "human") {
            if (request.role !== role) throw fail("ROLE", "当前不是你的行动窗口")
            choice = p.candidates.find(c => c.id === request.candidateId)
            if (!choice) throw fail("ILLEGAL", "候选动作无效或已过期")
            trace = { policy: "human", assisted: choice.assisted, requests: 0 }
        } else if (player.startsWith("llm:")) {
            const id = player.slice(4), { getProfile, createClient } = require("./providers")
            const profile = s.profiles[id] || getProfile(id)
            const client = s.clients[id] || (s.clients[id] = createClient(profile))
            const result = await decide(p, { client, profile, memory: s.memories[role], stats: s.stats, limits: s.limits,
                decisionId: hash([s.id, role, revision, p.observationHash]).slice(0, 24), ledger: s.requestLedger })
            choice = result.candidate; nextMemory = result.memory; trace = result.trace; reason = result.reason
        } else if (player.startsWith("llmsemi:")) {
            // [LLM-SEMI-01] 战略由模型在选牌窗决定一次，其余窗口与全部动作执行都
            // 走指定状态机。模型接口失败/预算耗尽照常抛出暂停；格式无效回退程序
            // 默认战略并计数，不静默伪装成模型决策。
            const id = player.slice("llmsemi:".length), { getProfile, createClient } = require("./providers")
            const profile = s.profiles[id] || getProfile(id)
            const client = s.clients[id] || (s.clients[id] = createClient(profile))
            const bot = s.rules.bots[s.options.semiBots[role]]
            if (!bot) throw fail("CONFIG", "半自动执行状态机不存在")
            const copied = clone(s.state), view = s.rules.view(copied, role), count = copied.log.length
            const requestsBefore = s.stats.requests
            let override = null, semiTrace = null, semiReason = ""
            if (semi.isStrategyWindow(view)) {
                const packet = semi.buildPacket(s.rules, clone(s.state), role, { profile,
                    strategyLog: s.strategyLog.filter(x => x.role === role) })
                const result = await semi.decide(packet, { client, profile, stats: s.stats, limits: s.limits,
                    decisionId: hash([s.id, role, revision, packet.observationHash]).slice(0, 24), ledger: s.requestLedger })
                override = result.override
                semiTrace = result.trace; semiReason = result.reason
                s.strategyLog.push({ revision: s.revision, role, turn: view.turn, phase: result.phase || null,
                    strategy: result.name || null, chain: (result.chain || []).slice(0, 16), dropped: result.dropped || [],
                    source: override ? "llm" : "program-default", invalid: !!result.invalid,
                    reason: semiReason, requests: result.requests || 0 })
            }
            const d = bot.decide(view, { role, seed: s.options.seed, actionOrdinal: revision + 1, strategyOverride: override })
            if (!d || !Object.hasOwn(view.actions || {}, d.action) || !view.actions[d.action]) throw fail("ILLEGAL", "状态机返回未声明动作")
            const raw = d.argument?.__ai ? d.argument.action : d.argument?.oos ? d.argument.action : d.argument
            if (Array.isArray(view.actions[d.action]) && !view.actions[d.action].includes(raw)) throw fail("ILLEGAL", "状态机返回非法参数")
            logs = copied.log.slice(count)
            choice = { action: d.action, argument: d.argument }
            trace = { policy: "llm-semi", executor: s.options.semiBots[role], requests: s.stats.requests - requestsBefore, ...(semiTrace ? { strategy: semiTrace } : {}) }
            reason = semiReason
        } else {
            const copied = clone(s.state), view = s.rules.view(copied, role), count = copied.log.length
            const d = s.rules.bots[player].decide(view, { role, seed: s.options.seed, actionOrdinal: revision + 1 })
            if (!d || !Object.hasOwn(view.actions || {}, d.action) || !view.actions[d.action]) throw fail("ILLEGAL", "状态机返回未声明动作")
            const raw = d.argument?.__ai ? d.argument.action : d.argument?.oos ? d.argument.action : d.argument
            if (Array.isArray(view.actions[d.action]) && !view.actions[d.action].includes(raw)) throw fail("ILLEGAL", "状态机返回非法参数")
            logs = copied.log.slice(count)
            choice = { action: d.action, argument: d.argument }
            trace = { policy: player, requests: 0 }
        }
        if (s.revision !== revision || activeRole(s.state) !== role) throw fail("STALE", "响应到达时棋局已变化；动作未执行")
        // Commit on a copy: throwing handlers cannot partially change the live game.
        const next = clone(s.state)
        s.rules.view(next, role)
        next.log.push(...logs)
        const nextState = s.rules.action(next, role, choice.action, clone(choice.argument ?? null))
        const progressHash = gameplayDigest(nextState), recentStates = s.progressWindow.slice(-127), repeatCount = recentStates.filter(h => h === progressHash).length + 1
        if (repeatCount > 16) throw fail("NO_PROGRESS", "重复相同局面超过16次；对局暂停供调试")
        let afterObservation = null
        if (player.startsWith("llm:")) { try { afterObservation = visible(s.rules, nextState, role).observation } catch (_) { /* Projection failure is not a failed legal action. */ } }
        const finalMemory = player.startsWith("llm:") ? commitMemory(nextMemory, p.observation, afterObservation,
            { revision: revision + 1, action: choice.action, label: choice.label, effect: choice.effect, reason, policy: trace.policy, assisted: trace.assisted }) : null
        s.state = nextState
        s.progressWindow = [...recentStates, progressHash]
        if (player.startsWith("llm:")) s.memories[role] = finalMemory
        s.actions.push({ role, action: choice.action, argument: clone(choice.argument ?? null), logs,
            revision, trace, reason, stateHash: digest(nextState), progressHash })
        s.revision++; s.cache.clear(); s.error = null
        committed = true
        s.status = nextState.active === "None" ? "complete" : "playing"
        if (trace.policy === "forced") s.stats.forcedActions++
        if (trace.assisted) s.stats.assistedActions++
        s.lastDecision = { role, action: choice.action, reason, trace }
        return snapshot(s)
    } catch (e) { s.status = !committed && ["ILLEGAL", "ROLE", "STALE"].includes(e.code) ? priorStatus : "paused"; s.error = { code: committed ? "COMMITTED_VIEW_ERROR" : e.code || "ENGINE", message: committed ? "动作已执行，但显示投影失败；请刷新核对局面" : e.code ? e.message : "规则引擎未完成动作；棋局保持不变" }; throw fail(s.error.code, s.error.message) }
    finally { s.busy = false }
}
function replay(s) {
    if (s.rulesSha256 === LOADED_HASH) { fs.mkdirSync(ARCHIVES, { recursive: true, mode: 0o700 }); const file = path.join(ARCHIVES, s.rulesSha256 + ".js"); if (!fs.existsSync(file)) fs.writeFileSync(file, LOADED_SOURCE, { mode: 0o600 }) }
    return { schemaVersion: 1, kind: "eots-llm-replay", setup: s.options, rulesSha256: s.rulesSha256, moduleHashes: s.moduleHashes,
        policyMigrations: clone(s.policyMigrations || []), requestLedger: clone(s.requestLedger), strategyLog: clone(s.strategyLog), actions: clone(s.actions), finalStateHash: digest(s.state), complete: s.state.active === "None", result: s.state.result || null, stats: clone(s.stats) }
}
function verifyReplay(r, rules) {
    rules ||= r.rulesSha256 === "injected-test-engine" || r.rulesSha256 === LOADED_HASH ? LOADED_RULES : archivedRules(r.rulesSha256)
    let state = rules.setup(r.setup.seed, r.setup.scenario, { headless_moves: true })
    for (const item of r.actions) {
        const role = activeRole(state)
        if (role !== item.role) throw fail("REPLAY", "回放活动阵营不一致")
        const view = rules.view(state, role), raw = item.argument?.__ai ? item.argument.action : item.argument?.oos ? item.argument.action : item.argument
        if (!view.actions?.[item.action] || Array.isArray(view.actions[item.action]) && !view.actions[item.action].includes(raw)) throw fail("REPLAY", "回放动作未通过合法性检查")
        state.log.push(...(item.logs || [])); state = rules.action(state, role, item.action, clone(item.argument))
        if (digest(state) !== item.stateHash) throw fail("REPLAY", "回放逐步状态哈希不一致")
    }
    if (digest(state) !== r.finalStateHash) throw fail("REPLAY", "回放终态哈希不一致")
    return { verified: true, actions: r.actions.length, complete: state.active === "None", result: state.result || null, finalStateHash: digest(state) }
}
function serializeSession(s) { return { schemaVersion: 1, kind: "eots-llm-private-save", id: s.id, replay: replay(s), memories: clone(s.memories), status: s.status, error: s.error || null, lastDecision: s.lastDecision || null } }
function restoreSession(saved, deps = {}) {
    if (saved?.kind !== "eots-llm-private-save" || saved.schemaVersion !== 1) throw fail("SAVE", "私有存档格式无效")
    if (!deps.rules && saved.replay.rulesSha256 !== LOADED_HASH) deps = { ...deps, rules: archivedRules(saved.replay.rulesSha256), rulesSha256: saved.replay.rulesSha256 }
    const s = createSession(saved.replay.setup, deps)
    verifyReplay(saved.replay, s.rules)
    for (const a of saved.replay.actions) {
        s.rules.view(s.state, a.role); s.state.log.push(...(a.logs || [])); s.state = s.rules.action(s.state, a.role, a.action, clone(a.argument))
    }
    s.id = saved.id; s.revision = saved.replay.actions.length; s.actions = clone(saved.replay.actions)
    if (saved.replay.moduleHashes && hash(saved.replay.moduleHashes) !== hash(s.moduleHashes) && !deps.allowPolicyMigration)
        throw fail("POLICY_CHANGED", "模型接口代码已变化；需明确允许策略迁移后恢复存档")
    s.policyMigrations = clone(saved.replay.policyMigrations || [])
    if (saved.replay.moduleHashes && hash(saved.replay.moduleHashes) !== hash(s.moduleHashes))
        s.policyMigrations.push({ revision: s.revision, from: saved.replay.moduleHashes, to: s.moduleHashes })
    s.memories = clone(saved.memories); s.stats = clone(saved.replay.stats)
    s.requestLedger = clone(saved.replay.requestLedger || [])
    s.strategyLog = clone(saved.replay.strategyLog || [])
    s.progressWindow = s.actions.slice(-128).map(a => a.progressHash).filter(Boolean)
    s.status = s.state.active === "None" ? "complete" : saved.status === "paused" ? "paused" : "playing"
    s.error = clone(saved.error || null); s.lastDecision = clone(saved.lastDecision || null)
    return s
}
module.exports = { createSession, snapshot, step, replay, verifyReplay, serializeSession, restoreSession, packet, viewer, digest }
