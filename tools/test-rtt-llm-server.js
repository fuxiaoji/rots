"use strict"
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), assert = require("node:assert/strict"), { spawn } = require("node:child_process")
// Isolated local RTT + loopback mock provider; never loads the private API file.
const runtime = path.resolve(process.env.RTT_RUNTIME_ROOT || "D:/desktop/rots-runtime-pve"), Database = require(runtime + "/node_modules/better-sqlite3"), WebSocket = require(runtime + "/node_modules/ws"), rules = require("../rules")
const output = path.resolve("llm-private/rtt-server-tests")
fs.mkdirSync(output, { recursive: true })
const filename = path.join(fs.mkdtempSync(path.join(output, "run-")), "db"), db = new Database(filename)
db.exec(fs.readFileSync(runtime + "/schema.sql", "utf8"))
db.exec("INSERT INTO users(user_id,name,mail) VALUES(2,'MockCreator','creator@invalid.test'),(3,'MockObserver','observer@invalid.test'); INSERT INTO titles(title_id,title_name) VALUES('empire-of-the-sun','Empire of the Sun')")
const sids = [2, 3].map(id => db.prepare("INSERT INTO logins VALUES(abs(random())%(1<<48),?,julianday()+1) RETURNING sid").pluck().get(id))
let requests = 0, gameId, waitingChecks, child
const call = (url, { user = 0, ...options } = {}) => fetch("http://localhost:8181" + url, { ...options, headers: { ...(options.headers || {}), ...(user >= 0 ? { cookie: "login=" + sids[user] } : {}) }, redirect: "manual" })
const provider = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c
    const data = JSON.parse(body), p = JSON.parse(data.messages[1].content.split("\n上次输出无效：")[0])
    requests++
    if (requests === 1) {
        const deniedDelete = await call("/api/delete/" + gameId, { method: "POST" })
        const deniedRewind = await call("/api/rewind/" + gameId, { method: "POST" })
        assert.equal(deniedDelete.status, 409)
        assert.equal(deniedRewind.status, 409)
        assert((await deniedRewind.text()).includes("请等待"))
        waitingChecks = true
    }
    const c = p.candidates.find(c => ["pass", "end", "done", "next", "skip", "no_reaction", "no"].includes(c.action)) || p.candidates[0]
    await new Promise(resolve => setTimeout(resolve, 30))
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ model: "mock", choices: [{ message: { content: JSON.stringify({ candidateId: c.id, reason: "测试用简短说明", memory: { objective: "测试计划", notes: ["仅测试接口"] } }) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }))
})
async function main() {
    // Refuse to touch an unrelated server on the test port.
    const probe = require("node:net").createServer()
    await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(8181, "localhost", () => probe.close(resolve)) })
    await new Promise(resolve => provider.listen(8117, "127.0.0.1", resolve))
    child = spawn(process.execPath, ["server.js"], { cwd: runtime, env: { ...process.env, DATABASE: filename, HTTP_PORT: "8181", EOTS_LLM_ENV_FILE: "", DEEPSEEK_API_KEY: "mock", EOTS_LLM_DEEPSEEK_BASE_URL: "http://127.0.0.1:8117", EOTS_LLM_DEEPSEEK_MODEL: "mock", EOTS_LLM_DEEPSEEK_JSON_MODE: "false", EOTS_LLM_DEEPSEEK_EXTRA_BODY: "{}" }, windowsHide: true, stdio: "ignore" })
    for (let n = 0; n < 100; n++) { try { if ((await call("/")).status === 200) break } catch {} await new Promise(r => setTimeout(r, 50)) }
    const form = new URLSearchParams({ mode: "aivai", scenario: "South Pacific", bot_id_jp: "erasmus-v2-opt-v5", bot_id_ap: "llm-deepseek", llm_requests: "100", llm_tokens: "10000", pace: "0" })
    const created = await call("/create/empire-of-the-sun", { method: "POST", body: form })
    assert.equal(created.status, 302)
    gameId = Number(new URL(created.headers.get("location"), "http://localhost:8181").searchParams.get("game"))
    const initialState = JSON.parse(db.prepare("SELECT state FROM game_state WHERE game_id=?").pluck().get(gameId))
    const marker = s => s.log.filter(l => /^@Turn \d+\./.test(l)).at(-1)
    const ws = new WebSocket(`ws://localhost:8181/play-socket?title=empire-of-the-sun&game=${gameId}&role=Observer`, { headers: { cookie: "login=" + sids[0] } })
    const details = []
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("phase timeout")), 30000); let sent = false
        ws.on("error", reject)
        ws.on("message", raw => {
            const [type, value] = JSON.parse(String(raw))
            if (type === "state" && !sent) { sent = true; ws.send('["botstep"]'); ws.send('["botstep"]') }
            if (type === "botstep") details.push(value)
            if (type === "botstep" && value.running === false) { clearTimeout(timer); ws.close(); resolve() }
        })
    })
    const state = JSON.parse(db.prepare("SELECT state FROM game_state WHERE game_id=?").pluck().get(gameId))
    assert.notEqual(marker(state), marker(initialState))
    assert(details.at(-1).detail.includes("阶段边界")); assert(waitingChecks)
    const creator = await call("/api/ai-trace/" + gameId)
    const rows = await creator.json(), llmRows = rows.filter(r => r.trace.llm), fsmRows = rows.filter(r => !r.trace.llm)
    assert(llmRows.length && fsmRows.length)
    assert(llmRows.every(r => !r.trace.memory && !r.trace.observation && !r.trace.reasoning_content))
    for (const url of ["/api/ai-trace/", "/api/llm-status/"]) {
        assert.equal((await call(url + gameId, { user: 1 })).status, 403)
        assert.notEqual((await call(url + gameId, { user: -1 })).status, 200)
    }
    const stranger = new WebSocket(`ws://localhost:8181/play-socket?title=empire-of-the-sun&game=${gameId}&role=Observer`, { headers: { cookie: "login=" + sids[1] } })
    const before = requests
    await new Promise((resolve, reject) => {
        stranger.on("error", reject)
        stranger.on("open", () => stranger.send('["botstep"]'))
        stranger.on("message", raw => { const [type, value] = JSON.parse(String(raw)); if (type === "error") { assert(value.includes("创建者")); stranger.close(); resolve() } })
    })
    assert.equal(requests, before)
    let replayed
    for (const row of db.prepare("SELECT role,action,arguments FROM game_replay WHERE game_id=? ORDER BY replay_id").all(gameId)) {
        const a = row.arguments ? JSON.parse(row.arguments) : undefined
        replayed = row.action === ".setup" ? rules.setup(...a) : rules.action(replayed, row.role, row.action, a)
    }
    delete replayed.undo; delete state.undo
    assert.deepEqual(JSON.parse(JSON.stringify(replayed)), state)
    const setupArgs = JSON.parse(db.prepare("SELECT arguments FROM game_replay WHERE game_id=? AND action='.setup'").pluck().get(gameId))
    const result = { kind: "mock", gameId, scenario: "South Pacific", seed: setupArgs[0], opponent: "erasmus-v2-opt-v5", requests, llmActions: llmRows.length, fsmActions: fsmRows.length, authorizedOwner: 2, strangerDenied: true, mutationLocked: true, stageBoundary: details.at(-1).detail, replayVerified: true, completeGame: false, realApiRequests: 0 }
    fs.writeFileSync(path.join(output, "server-mock.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result))
}
main().catch(e => { console.error(e.stack); process.exitCode = 1 }).finally(() => { child?.kill(); provider.close(); db.close() })
