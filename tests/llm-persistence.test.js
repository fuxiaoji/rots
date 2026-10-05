"use strict"
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path")
const { createArenaServer } = require("../tools/llm-arena")
async function start(dir) { const server = createArenaServer({ persistenceDir: dir }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); return { server, url: `http://127.0.0.1:${server.address().port}` } }
async function close(server) { await new Promise(resolve => server.close(resolve)) }
async function call(url, route, method = "GET", body, token) { const r = await fetch(url + route, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() } }
const options = { scenario: "South Pacific", seed: 20261005, players: { Japan: "erasmus-v2-opt-v5", Allies: "human" } }
test("server restart restores exact revision and creator token while files stay private", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eots-save-")); let run
    try {
        run = await start(dir); const created = await call(run.url, "/api/games", "POST", options); assert.equal(created.status, 201)
        const { id, sessionToken, snapshot } = created.data
        const moved = await call(run.url, `/api/games/${id}/step`, "POST", { revision: 0, role: "Allies", candidateId: snapshot.candidates[0].id }, sessionToken)
        assert.equal(moved.status, 200); assert.equal(moved.data.revision, 1)
        assert.equal(fs.statSync(path.join(dir, id + ".json")).mode & 0o777, 0o600)
        await close(run.server); run = await start(dir)
        const restored = await call(run.url, `/api/games/${id}`, "GET", undefined, sessionToken)
        assert.equal(restored.status, 200); assert.equal(restored.data.revision, 1)
        assert.deepEqual(restored.data.observation, moved.data.observation)
        assert.equal((await call(run.url, `/api/games/${id}`, "GET")).status, 401)
    } finally { if (run) await close(run.server); fs.rmSync(dir, { recursive: true, force: true }) }
})
test("save failure is returned before success and never leaves game locked", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eots-save-fail-")); const run = await start(dir)
    try {
        const created = await call(run.url, "/api/games", "POST", options); const { id, sessionToken, snapshot } = created.data
        fs.rmSync(dir, { recursive: true, force: true })
        const result = await call(run.url, `/api/games/${id}/step`, "POST", { revision: 0, role: "Allies", candidateId: snapshot.candidates[0].id }, sessionToken)
        assert.equal(result.status, 500); assert.equal(result.data.error.code, "SAVE_ERROR")
        const current = await call(run.url, `/api/games/${id}`, "GET", undefined, sessionToken)
        assert.equal(current.status, 200); assert.equal(current.data.revision, 1)
    } finally { await close(run.server); fs.rmSync(dir, { recursive: true, force: true }) }
})
