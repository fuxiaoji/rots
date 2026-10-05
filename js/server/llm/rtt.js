"use strict"
// RTT owns the only game state. This bridge owns private accounting/memory.
const fs = require("node:fs"), path = require("node:path")
const providers = require("./providers"), { observe, hash, activeRole } = require("./observation"), harness = require("./harness")
const VERSION = "eots-rtt-llm-v1"
const isLLM = id => typeof id === "string" && id.startsWith("llm-")
const scenarios = ["South Pacific", "1942-1945 (The Shortened Campaign)", "1943-1945 (The Even Shorter Campaign)"]
const blankStats = () => ({ requests: 0, retries: 0, failedRequests: 0, invalidResponses: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0, usageUnknown: 0, latencyMs: 0, actions: 0, forced: 0, assisted: 0 })
function limits(options) {
    const number = (key, fallback, max) => {
        const n = options[key] === undefined ? fallback : Number(options[key])
        if (!Number.isSafeInteger(n) || n < 1 || n > max) throw harness.fail("CONFIG", "LLM额度必须是允许范围内的正整数")
        return n
    }
    return { maxRequests: number("llm_requests", 600, 6000), maxTotalTokens: number("llm_tokens", 10000000, 100000000), maxActions: 20000 }
}
function creatorAllowed(game, user, seats) {
    let options; try { options = JSON.parse(game?.options || "{}") } catch { return false }
    return !!user && options.mode === "aivai" && seats.length === 2 && seats.every(s => s.bot_id)
        && (user.user_id === game.owner_id || user.user_id === 1)
}
function summary(trace) {
    if (!trace?.llm) return null
    // Explicit whitelist: never expose the observation, ledger, full memory or reasoning_content.
    const keys = ["llm", "model", "provider", "role", "turn", "windowKind", "action", "label", "explanation", "objective", "notes", "policy", "assisted", "usage", "latencyMs", "stats", "limits", "sources"]
    return Object.fromEntries(keys.filter(k => trace[k] !== undefined).map(k => [k, trace[k]]))
}
function createBridge(db, { env = process.env, clientFactory = providers.createClient, rulesFile = path.resolve(__dirname, "../../../rules.js") } = {}) {
    if (env.EOTS_LLM_ENV_FILE) providers.loadEnv(env.EOTS_LLM_ENV_FILE, env)
    db.exec("CREATE TABLE IF NOT EXISTS game_llm_runtime (game_id INTEGER PRIMARY KEY, context TEXT NOT NULL)")
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='games'").get()) {
        db.exec("CREATE TABLE IF NOT EXISTS game_llm_archive (instance TEXT PRIMARY KEY, game_id INTEGER, context TEXT NOT NULL)")
        db.exec(`CREATE TRIGGER IF NOT EXISTS rtt_llm_delete AFTER DELETE ON games BEGIN
            INSERT OR REPLACE INTO game_llm_archive SELECT json_extract(context,'$.instance'),game_id,context FROM game_llm_runtime WHERE game_id=old.game_id;
            DELETE FROM game_llm_runtime WHERE game_id=old.game_id;
        END`)
    }
    const read = db.prepare("SELECT context FROM game_llm_runtime WHERE game_id=?").pluck()
    const write = db.prepare("INSERT OR REPLACE INTO game_llm_runtime VALUES (?,?)")
    const save = (id, ctx) => write.run(id, JSON.stringify(ctx))
    const get = id => { const value = read.get(id); return value ? JSON.parse(value) : null }
    function pause(id, code) {
        const ctx = get(id)
        if (ctx) { ctx.status = "paused"; ctx.error = /^[A-Z0-9_]{1,48}$/.test(code) ? code : "ERROR"; save(id, ctx) }
    }
    // A request in flight at process death may have been billed. Never resend it automatically.
    for (const row of db.prepare("SELECT game_id,context FROM game_llm_runtime").all()) {
        const ctx = JSON.parse(row.context)
        if (ctx.pending) {
            if (ctx.error !== "UNKNOWN_REQUEST") {
                ctx.stats.usageUnknown++
                const last = ctx.ledger[ctx.ledger.length - 1]
                if (last) last.code = "UNKNOWN_REQUEST"
            }
            ctx.error = "UNKNOWN_REQUEST"; ctx.status = "paused"; save(row.game_id, ctx)
        }
    }
    function bots(rules, title) {
        const result = { ...(rules?.bots || {}) }
        if (title !== "empire-of-the-sun") return result
        for (const p of providers.listProfiles(env).filter(p => p.configured))
            result["llm-" + p.id] = { name: "LLM · " + p.model + (p.vision ? "（地图图片）" : ""), roles: ["Japan", "Allies"], scenarios }
        return result
    }
    function fingerprint(profile) {
        const { apiKey, ...safe } = profile
        return hash({ profile: safe, bridge: VERSION, rules: hash(fs.readFileSync(rulesFile, "utf8")),
            sources: ["rtt.js", "harness.js", "observation.js", "prompt.js", "providers.js", "board.js"].map(f => hash(fs.readFileSync(path.join(__dirname, f), "utf8"))),
            rulesText: ["docs/rules/llm-south-pacific.md", ...fs.readdirSync(path.resolve(__dirname, "../../../docs/rules/normalized/eots-v3.2-zh-rules/chapters")).filter(f => f.endsWith(".md")).sort().map(f => "docs/rules/normalized/eots-v3.2-zh-rules/chapters/" + f)]
                .map(f => hash(fs.readFileSync(path.resolve(__dirname, "../../..", f), "utf8"))) })
    }
    function init(id, options, seats) {
        const profiles = {}
        for (const s of seats.filter(s => isLLM(s.bot_id))) profiles[s.role] = fingerprint(providers.getProfile(s.bot_id.slice(4), env))
        const ctx = { instance: require("node:crypto").randomUUID(), version: VERSION, profiles, stats: blankStats(), limits: limits(options), memories: {}, ledger: [], pending: null, prepared: null, status: "paused", error: null }
        save(id, ctx)
        return ctx
    }
    async function decide({ id, rules, state, role, botId, revision, options, seats, stillCurrent }) {
        const ctx = get(id) || init(id, options, seats)
        const saveCurrent = () => {
            if (get(id)?.instance !== ctx.instance) throw harness.fail("STALE", "对局实例已改变，响应未保存")
            save(id, ctx)
        }
        if (ctx.pending) throw harness.fail("UNKNOWN_REQUEST", "上次请求结果不确定；需先核查账本，不能自动重发")
        const profile = providers.getProfile(botId.slice(4), env)
        if (ctx.profiles[role] !== fingerprint(profile)) throw harness.fail("POLICY_CHANGED", "模型或规则版本已改变；请新建对局")
        if (ctx.stats.actions >= ctx.limits.maxActions) throw harness.fail("BUDGET", "本局动作额度已耗尽")
        const packet = observe(rules, state, role, revision)
        if (activeRole(state) !== role) throw harness.fail("STALE", "活动阵营已改变")
        const client = { async complete(messages) {
            // Harness has already charged the request and added its hash-only ledger entry.
            ctx.pending = { role, revision, ordinal: ctx.stats.requests, stateHash: hash(state), at: Date.now() }
            ctx.status = "running"; ctx.error = null; saveCurrent()
            return clientFactory(profile).complete(messages)
        } }
        const binding = hash({ role, revision, state: hash(state) })
        let answer
        try {
            answer = ctx.prepared?.binding === binding ? ctx.prepared.answer : await harness.decide(packet, { client, profile, memory: ctx.memories[role] || { objective: "", notes: [] },
                stats: ctx.stats, limits: ctx.limits, decisionId: `${id}:${revision}:${role}`, ledger: ctx.ledger })
        } catch (e) {
            ctx.pending = null; ctx.status = "paused"; ctx.error = e.code || "ERROR"; saveCurrent()
            throw e
        }
        ctx.pending = null; ctx.prepared = { binding, answer }; ctx.status = "paused"; ctx.error = null; saveCurrent()
        if (!stillCurrent()) throw harness.fail("STALE", "等待期间棋局发生变化，响应未执行")
        const fresh = observe(rules, state, role, revision).candidates
        if (!fresh.some(c => c.id === answer.candidate.id && c.action === answer.candidate.action && hash(c.argument ?? null) === hash(answer.candidate.argument ?? null)))
            throw harness.fail("STALE", "候选动作已经失效")
        const c = answer.candidate
        const publicTrace = { llm: true, role, model: answer.trace.model || profile.model, provider: profile.provider,
            turn: packet.observation.turn, windowKind: packet.observation.state, action: c.action,
            policy: answer.trace.policy, assisted: !!c.assisted, usage: answer.trace.usage || null, latencyMs: answer.trace.latencyMs || 0 }
        const privateTrace = { ...publicTrace, label: c.label, explanation: answer.reason,
            objective: answer.memory.objective, notes: answer.memory.notes, memory: answer.memory,
            stats: { ...ctx.stats, actions: ctx.stats.actions + 1 }, limits: ctx.limits,
            sources: answer.trace.sources || [], observationHash: packet.observationHash }
        return { action: c.action, argument: c.argument, publicTrace, privateTrace, version: VERSION,
            commit(replayId) {
                // Called INSIDE RTT's action transaction. Memory and replay commit together.
                ctx.memories[role] = answer.memory; ctx.stats.actions++
                if (answer.trace.policy === "forced") ctx.stats.forced++
                if (c.assisted) ctx.stats.assisted++
                ctx.lastReplay = replayId; ctx.prepared = null; saveCurrent()
            } }
    }
    function rewind(id, replayId) {
        const ctx = get(id); if (!ctx) return
        ctx.memories = {}
        const rows = db.prepare("SELECT role,private_trace FROM game_ai_trace WHERE game_id=? AND replay_id<=? ORDER BY replay_id").all(id, replayId)
        for (const row of rows) {
            const trace = JSON.parse(row.private_trace)
            if (trace?.llm && trace.memory) ctx.memories[row.role] = trace.memory
        }
        ctx.lastReplay = replayId; ctx.prepared = null; ctx.status = "paused"; save(id, ctx)
        // Costs and any uncertain request remain charged even after rewind.
    }
    return { bots, init, decide, rewind, get, pause, isLLM, limits, summary, creatorAllowed, activeRole }
}
module.exports = { createBridge, isLLM, limits, summary, creatorAllowed, blankStats }
