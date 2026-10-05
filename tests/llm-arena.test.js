"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const { createArenaServer } = require("../tools/llm-arena.js")

const ROOT = path.resolve(__dirname, "..")
const CONFIG = { scenarios: ["mock-scenario"], bots: { "erasmus-v2-opt-v5": {} } }
const PROVIDERS = { listProfiles: () => [{ id: "minimax", provider: "minimax", model: "mock-model", vision: false, configured: true, apiKey: "NEVER_EXPOSE_KEY" }] }
function api(overrides = {}) {
    return {
        createSession: options => ({ id: "internal-id", revision: 0, status: "playing", options, active: "Japan", privateState: "NEVER_EXPOSE_STATE" }),
        snapshot: (session, role) => ({ revision: session.revision, role, active: session.active, status: session.status, turn: 2, prompt: "mock prompt", observation: { ownCards: role === "Observer" ? [] : ["own-card"] }, candidates: session.options.players[session.active] === "human" ? [{ id: "safe-choice", action: "done", label: "继续" }] : [], rawState: session.privateState, memories: "NEVER_EXPOSE_MEMORIES" }),
        step: async (session, options) => { if (options.candidateId && options.candidateId !== "safe-choice") throw Object.assign(Error("secret details"), { code: "INVALID_CANDIDATE" }); ++session.revision; return { role: "Allies", observation: { ownCards: ["NEVER_EXPOSE_ENEMY_HAND"] } } },
        replay: session => ({ revision: session.revision, actions: [] }),
        ...overrides
    }
}
async function fixture(t, overrides = {}, serverOptions = {}) {
    const server = createArenaServer({ root: ROOT, sessionApi: api(overrides), providers: PROVIDERS, rules: CONFIG, ...serverOptions })
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
    const base = `http://127.0.0.1:${server.address().port}`
    async function call(endpoint, { token, method = "GET", data, headers = {} } = {}) {
        const response = await fetch(base + endpoint, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, body: data === undefined ? undefined : typeof data === "string" ? data : JSON.stringify(data) })
        return { status: response.status, body: await response.json() }
    }
    async function create(players = { Japan: "human", Allies: "llm:minimax" }) {
        const out = await call("/api/games", { method: "POST", data: { seed: 10, scenario: "mock-scenario", players, maxRequests: 2, maxActions: 20 } })
        assert.equal(out.status, 201)
        return out.body
    }
    return { base, call, create }
}

test("config strips provider credentials and serves only the arena page", async t => {
    const { call, base } = await fixture(t)
    const config = await call("/api/config")
    assert.equal(config.status, 200)
    assert.equal(JSON.stringify(config.body).includes("NEVER_EXPOSE_KEY"), false)
    assert.deepEqual(config.body.profiles[0], { id: "minimax", provider: "minimax", model: "mock-model", vision: false, configured: true })
    const page = await fetch(base + "/")
    assert.equal(page.status, 200)
    assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/)
    assert.equal((await page.text()).includes("__ARENA_NONCE__"), false)
    assert.equal((await call("/.env.llm.local")).status, 404)
    assert.equal((await call("/rules.js")).status, 404)
})

test("creator authentication and fixed human view protect all session endpoints", async t => {
    const { call, create } = await fixture(t)
    const game = await create()
    const endpoint = `/api/games/${game.id}`
    assert.equal(game.viewRole, "Japan")
    assert.equal((await call(endpoint)).status, 401)
    assert.equal((await call(endpoint + "/step", { method: "POST", data: { revision: 0, candidateId: "safe-choice" } })).status, 401)
    assert.equal((await call(endpoint + "/replay")).status, 401)
    assert.equal((await call(endpoint + "?role=Allies", { token: game.sessionToken })).status, 403)
    const snapshot = await call(endpoint, { token: game.sessionToken })
    assert.equal(snapshot.body.role, "Japan")
    assert.equal(JSON.stringify(snapshot.body).includes("NEVER_EXPOSE"), false)
    const stepped = await call(endpoint + "/step", { token: game.sessionToken, method: "POST", data: { revision: 0, role: "Japan", candidateId: "safe-choice" } })
    assert.equal(stepped.status, 200)
    assert.equal(stepped.body.role, "Japan")
    assert.equal(stepped.body.revision, 1)
    assert.equal(JSON.stringify(stepped.body).includes("NEVER_EXPOSE_ENEMY_HAND"), false)
    const stale = await call(endpoint + "/step", { token: game.sessionToken, method: "POST", data: { revision: 0, role: "Japan", candidateId: "safe-choice" } })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.error.code, "STALE_REVISION")
})

test("spectators receive only Observer and full replay remains locked until completion", async t => {
    const { call, create } = await fixture(t, { step: async s => { ++s.revision; s.status = "complete"; s.active = "None" } })
    const game = await create({ Japan: "erasmus-v2-opt-v5", Allies: "llm:minimax" })
    assert.equal(game.viewRole, "Observer")
    assert.deepEqual(game.snapshot.observation.ownCards, [])
    const endpoint = `/api/games/${game.id}`
    assert.equal((await call(endpoint + "?role=Japan", { token: game.sessionToken })).status, 403)
    const early = await call(endpoint + "/replay", { token: game.sessionToken })
    assert.equal(early.body.error.code, "REPLAY_NOT_READY")
    assert.equal((await call(endpoint + "/step", { token: game.sessionToken, method: "POST", data: { revision: 0 } })).status, 200)
    assert.equal((await call(endpoint + "/replay", { token: game.sessionToken })).status, 200)
})

test("foreign origins, oversized bodies, invalid player configurations are rejected", async t => {
    const { call, create } = await fixture(t, {}, { bodyLimit: 512 })
    const foreign = await call("/api/games", { method: "POST", data: {}, headers: { Origin: "https://foreign.example" } })
    assert.equal(foreign.status, 403)
    const huge = await call("/api/games", { method: "POST", data: { text: "X".repeat(513) } })
    assert.equal(huge.status, 413)
    const malformed = await call("/api/games", { method: "POST", data: "{" })
    assert.equal(malformed.body.error.code, "INVALID_JSON")
    const doubleHuman = await call("/api/games", { method: "POST", data: { scenario: "mock-scenario", players: { Japan: "human", Allies: "human" } } })
    assert.equal(doubleHuman.status, 400)
    const badPlayer = await call("/api/games", { method: "POST", data: { scenario: "mock-scenario", players: { Japan: "llm:missing", Allies: "human" } } })
    assert.equal(badPlayer.status, 400)
    const game = await create()
    const missingRevision = await call(`/api/games/${game.id}/step`, { token: game.sessionToken, method: "POST", data: { candidateId: "safe-choice" } })
    assert.equal(missingRevision.status, 400)
})

test("same-game pending lock prevents concurrent mutations and private reads", async t => {
    let entered, unblock
    const started = new Promise(resolve => { entered = resolve })
    const gate = new Promise(resolve => { unblock = resolve })
    const { call, create } = await fixture(t, { step: async session => { entered(); await gate; ++session.revision } })
    const game = await create(), endpoint = `/api/games/${game.id}`
    const first = call(endpoint + "/step", { token: game.sessionToken, method: "POST", data: { revision: 0, candidateId: "safe-choice" } })
    await started
    try {
        const second = await call(endpoint + "/step", { token: game.sessionToken, method: "POST", data: { revision: 0, candidateId: "safe-choice" } })
        assert.equal(second.body.error.code, "GAME_BUSY")
        assert.equal((await call(endpoint, { token: game.sessionToken })).body.error.code, "GAME_BUSY")
        assert.equal((await call(endpoint, { token: game.sessionToken, method: "DELETE" })).status, 409)
    } finally { unblock() }
    assert.equal((await first).status, 200)
})

test("session cap is enforceable and provider exceptions never expose their messages", async t => {
    const { call, create } = await fixture(t, { step: async () => { throw Object.assign(Error("NEVER_EXPOSE_KEY_OR_ENEMY_STATE"), { status: 400, code: "PRIVATE_PROVIDER_DEBUG" }) } }, { maxSessions: 1 })
    const game = await create(), endpoint = `/api/games/${game.id}`
    const full = await call("/api/games", { method: "POST", data: { players: { Japan: "human", Allies: "llm:minimax" } } })
    assert.equal(full.body.error.code, "SESSION_LIMIT")
    const failed = await call(endpoint + "/step", { token: game.sessionToken, method: "POST", data: { revision: 0, candidateId: "safe-choice" } })
    assert.equal(failed.status, 500)
    assert.equal(failed.body.error.code, "INTERNAL_ERROR")
    assert.equal(JSON.stringify(failed.body).includes("NEVER_EXPOSE"), false)
    assert.equal((await call(endpoint, { token: game.sessionToken })).status, 200)
    assert.equal((await call(endpoint, { token: game.sessionToken, method: "DELETE" })).status, 200)
    await create()
})


test("untrusted snapshot errors and prototype-like exception codes stay private", async t => {
    const normal = api()
    const { call, create } = await fixture(t, {
        snapshot: (session, role) => ({ ...normal.snapshot(session, role), error: { code: "__proto__", message: "NEVER_EXPOSE_SNAPSHOT_DEBUG" } }),
        step: async () => { throw Object.assign(Error("NEVER_EXPOSE_THROW_DEBUG"), { code: "__proto__" }) }
    })
    const game = await create()
    assert.deepEqual(game.snapshot.error, { code: "INTERNAL_ERROR", message: "上次动作未完成；请检查配置或重试。" })
    const out = await call(`/api/games/${game.id}/step`, { token: game.sessionToken, method: "POST", data: { revision: 0, candidateId: "safe-choice" } })
    assert.equal(out.status, 500)
    assert.equal(out.body.error.code, "INTERNAL_ERROR")
    assert.equal(JSON.stringify(out.body).includes("NEVER_EXPOSE"), false)
})
