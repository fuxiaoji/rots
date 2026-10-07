#!/usr/bin/env node
"use strict"
// Frozen, process-isolated real-API evaluation. Credentials never enter argv.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process")
const crypto = require("node:crypto")
const ROOT = path.resolve(__dirname, "..")
const hash = x => crypto.createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex")
function args(argv) {
    const o = {}
    for (let i = 0; i < argv.length; i += 2) {
        if (!argv[i].startsWith("--") || argv[i + 1] === undefined) throw Error("ARGS")
        o[argv[i].slice(2)] = argv[i + 1]
    }
    return o
}
function write(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const tmp = file + ".tmp"
    fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 })
    fs.renameSync(tmp, file)
}
function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")) }
function validate(manifest) {
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.jobs) || !manifest.jobs.length) throw Error("MANIFEST")
    const ids = new Set()
    for (const j of manifest.jobs) {
        if (!/^[a-z0-9-]+$/.test(j.id) || ids.has(j.id)) throw Error("JOB_ID")
        ids.add(j.id)
        if (!Number.isSafeInteger(j.index) || j.index < 0 || j.index > 9) throw Error("JOB_INDEX")
        if (!["Japan", "Allies"].includes(j.role) || !["minimax", "deepseek", "glm", "glm-vision"].includes(j.profile)) throw Error("JOB_PLAYER")
        if (!Number.isSafeInteger(j.seed) || j.seed < 1 || !j.scenario || !j.opponent) throw Error("JOB_SETUP")
        for (const k of ["maxRequests", "maxTotalTokens", "maxActions"])
            if (!Number.isSafeInteger(j.limits?.[k]) || j.limits[k] < 1 || j.limits[k] > 10000000) throw Error("JOB_LIMIT")
    }
    return manifest
}
async function worker(o, manifest) {
    const providers = require("../js/server/llm/providers")
    providers.loadEnv(path.resolve(o["env-file"]))
    const api = require("../js/server/llm/session"), { classifyEnd } = require("../tests/campaign-metrics")
    const j = manifest.jobs.find(j => j.id === o.worker)
    if (!j) throw Error("JOB_UNKNOWN")
    const out = path.resolve(o.out, j.id), resultFile = path.join(out, "result.json")
    if (fs.existsSync(resultFile)) { console.log(JSON.stringify({ id: j.id, skipped: true })); return }
    const profile = providers.getProfile(j.profile), { apiKey, ...publicProfile } = profile
    const fingerprint = hash({ manifest: hash(manifest), job: j, profile: publicProfile,
        rules: hash(fs.readFileSync(path.join(ROOT, "rules.js"), "utf8")), runner: hash(fs.readFileSync(__filename, "utf8")) })
    const setup = { scenario: j.scenario, seed: j.seed, ...j.limits,
        players: { [j.role]: "llm:" + j.profile, [j.role === "Japan" ? "Allies" : "Japan"]: j.opponent } }
    const saveFile = path.join(out, "save.json"), configFile = path.join(out, "config.json")
    let s
    if (fs.existsSync(saveFile)) {
        if (o.resume !== "true" || read(configFile).fingerprint !== fingerprint) throw Error("RESUME_CONFIG_CHANGED")
        const saved = read(saveFile)
        const reqDir = path.join(out, "requests")
        if (fs.existsSync(reqDir) && fs.readdirSync(reqDir).some(n => Number(n.replace(/\.json$/, "")) > saved.replay.stats.requests))
            throw Error("ORPHAN_REQUEST_REQUIRES_AUDIT")
        s = api.restoreSession(saved)
        if (s.options.seed !== setup.seed || s.options.scenario !== setup.scenario ||
            Object.keys(setup.players).some(r => s.options.players[r] !== setup.players[r]) ||
            Object.keys(j.limits).some(k => s.options[k] !== setup[k])) throw Error("RESUME_SETUP_CHANGED")
    } else {
        s = api.createSession(setup)
        write(configFile, { fingerprint, job: j, publicProfile, manifestHash: hash(manifest), rulesSha256: s.rulesSha256,
            moduleHashes: s.moduleHashes, sourceCommit: manifest.sourceCommit, startedAt: new Date().toISOString() })
        write(saveFile, api.serializeSession(s))
    }
    const base = providers.createClient(profile)
    s.profiles[j.profile] = profile
    s.clients[j.profile] = { async complete(messages) {
        if (JSON.stringify(messages).includes(apiKey)) throw Object.assign(Error(), { code: "CREDENTIAL_IN_PROMPT" })
        const ordinal = s.stats.requests, file = path.join(out, "requests", ordinal + ".json")
        const record = { ordinal, revision: s.revision, role: j.role, messages, messagesHash: hash(messages), requestedModel: profile.model, status: "pending" }
        write(file, record)
        try {
            const response = await base.complete(messages)
            write(file, { ...record, status: "returned", ...response, outputHash: hash(response.content) })
            return response
        } catch (e) {
            write(file, { ...record, status: "failed", code: e.code || "PROVIDER", model: e.model || null, usage: e.usage || null,
                latencyMs: e.latencyMs || null, httpStatus: e.status || null, providerCode: e.providerCode || null })
            throw e
        }
    } }
    let error = null, verified = null, lastPrint = -1
    const begin = Date.now()
    while (s.status !== "complete" && !error) {
        try { await api.step(s, { revision: s.revision }) }
        catch (e) { error = { code: e.code || "ENGINE" } }
        write(saveFile, api.serializeSession(s))
        if (s.stats.requests >= lastPrint + 5 || error || s.status === "complete") {
            console.log(JSON.stringify({ id: j.id, action: s.revision, turn: s.state.turn, requests: s.stats.requests,
                tokens: s.stats.totalTokens, status: s.status, error: error?.code || null }))
            lastPrint = s.stats.requests
        }
    }
    const replay = api.replay(s)
    write(path.join(out, "replay.json"), replay)
    try { verified = api.verifyReplay(replay) } catch (e) { error ||= { code: e.code || "REPLAY_ERROR" } }
    const end = classifyEnd(s.state)
    const complete = s.status === "complete" && verified?.complete === true && end.natural
    const result = { id: j.id, profile: j.profile, requestedModel: profile.model, role: j.role, seed: j.seed,
        scenario: j.scenario, opponent: j.opponent, fingerprint, status: s.status, naturalComplete: complete,
        winner: complete ? verified.result : null, won: complete && verified.result === j.role,
        termination: error?.code || end.termination, turn: s.state.turn, actions: s.revision, end,
        naturalEndReason: s.state.L?.message || null, stats: s.stats, verified, elapsedMs: Date.now() - begin, finishedAt: new Date().toISOString() }
    write(resultFile, result)
    console.log(JSON.stringify({ id: j.id, finished: true, naturalComplete: complete, winner: result.winner, termination: result.termination }))
}
async function main(argv = process.argv.slice(2)) {
    const o = args(argv), manifest = validate(read(path.resolve(o.manifest)))
    if (!o.out || !o["env-file"]) throw Error("ARGS")
    if (o.worker) return worker(o, manifest)
    const stage = Number(o.stage || 10), concurrency = Number(o.concurrency || 3)
    if (![1, 3, 10].includes(stage) || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 6) throw Error("RUN_LIMIT")
    const jobs = manifest.jobs.filter(j => j.index < stage)
    let cursor = 0
    async function next() {
        while (cursor < jobs.length) {
            const j = jobs[cursor++]
            await new Promise(resolve => {
                const proc = cp.spawn(process.execPath, [__filename, "--worker", j.id, "--manifest", path.resolve(o.manifest),
                    "--env-file", path.resolve(o["env-file"]), "--out", path.resolve(o.out), "--resume", o.resume || "false"],
                    { cwd: ROOT, shell: false, stdio: ["ignore", "pipe", "pipe"] })
                proc.stdout.on("data", b => process.stdout.write(b))
                proc.stderr.on("data", () => {})
                proc.on("error", () => { console.log(JSON.stringify({ id: j.id, workerError: true })); resolve() })
                proc.on("exit", code => { if (code) console.log(JSON.stringify({ id: j.id, exitCode: code })); resolve() })
            })
        }
    }
    await Promise.all(Array.from({ length: concurrency }, next))
    const results = jobs.map(j => {
        const file = path.resolve(o.out, j.id, "result.json")
        return fs.existsSync(file) ? read(file) : { id: j.id, profile: j.profile, role: j.role, naturalComplete: false, won: false, termination: "WORKER_INTERRUPTED" }
    })
    write(path.resolve(o.out, "summary-stage-" + stage + ".json"), { manifestHash: hash(manifest), results })
    console.log(JSON.stringify({ stage, attempted: results.length, complete: results.filter(r => r.naturalComplete).length, wins: results.filter(r => r.won).length }))
}
if (require.main === module) main().catch(e => { console.error(/^[A-Z_]+$/.test(e.message) ? e.message : "EVALUATION_ERROR"); process.exitCode = 1 })
module.exports = { validate, args }
