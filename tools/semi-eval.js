#!/usr/bin/env node
"use strict"
// LLM-SEMI-01 评测运行器：半自动LLM(日本) vs 盟军战役AI(erasmus-campaign)，1942剧本。
// 另支持纯程序基线臂（Japan=erasmus-v2-opt-v5）。逐局 JSONL + 汇总；断点恢复；多 worker。
// 用法（父进程）：
//   node tools/semi-eval.js --arm semi --profile deepseek --games 10 --base-seed 20262701 \
//        --workers 3 --out tests/results/semi-eval-jp42-deepseek.jsonl
//   node tools/semi-eval.js --arm baseline --games 10 --base-seed 20262701 --workers 4 --out tests/results/semi-eval-jp42-baseline.jsonl
// worker：node tools/semi-eval.js --worker --arm semi --profile deepseek --seeds 20262701,20262703 --out <jsonl>
const fs = require("node:fs"), path = require("node:path"), { spawn } = require("node:child_process")
const ROOT = path.resolve(__dirname, "..")
const api = require("../js/server/llm/session")
const { visible } = require("../js/server/llm/observation")
const { classifyEnd } = require("../tests/campaign-metrics")
const SCENARIO = "1942-1945 (The Shortened Campaign)"
const ALLIES_OPPONENT = "erasmus-campaign"
const JAPAN_OPPONENT = "erasmus-japan-campaign"
const SEMI_EXECUTOR = "erasmus-v2-opt-v5"
function sidesFor(side, arm, profile) {
    // 半自动半边 + 对方战役AI；baseline 臂两侧都是程序。
    if (side === "allies") return arm === "baseline"
        ? { Japan: JAPAN_OPPONENT, Allies: ALLIES_OPPONENT }
        : { Japan: JAPAN_OPPONENT, Allies: "llmsemi:" + profile }
    return arm === "baseline"
        ? { Japan: SEMI_EXECUTOR, Allies: ALLIES_OPPONENT }
        : { Japan: "llmsemi:" + profile, Allies: ALLIES_OPPONENT }
}
const TRANSIENT = new Set(["EOTS_LLM_HTTP_ERROR", "EOTS_LLM_TIMEOUT", "EOTS_LLM_NETWORK_ERROR", "EOTS_LLM_INVALID_RESPONSE", "EOTS_LLM_PROVIDER_ERROR"])

function args(argv) {
    const o = {}
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith("--")) continue
        const key = argv[i].slice(2), value = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : true
        o[key] = value
    }
    return o
}
function loadEnvFile() {
    const envfile = process.env.EOTS_LLM_ENV_FILE || path.join(ROOT, ".env.llm.local")
    if (fs.existsSync(envfile)) require("../js/server/llm/providers").loadEnv(envfile)
}
function secureWrite(filename, value) {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 })
    const tmp = filename + ".tmp"
    fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 })
    fs.renameSync(tmp, filename)
}
function appendJsonl(file, record) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    fs.appendFileSync(file, JSON.stringify(record) + "\n")
}
function doneSeeds(file) {
    if (!fs.existsSync(file)) return new Set()
    return new Set(fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l).seed } catch { return null } }).filter(Boolean))
}
function endResources(s) {
    const hexes = visible(s.rules, s.state, "Observer").observation.hexes
    const count = control => hexes.filter(h => h.resource && h.control === control).length
    return { japanResource: count("Japan"), alliesResource: count("Allies"),
        japanNamed: hexes.filter(h => h.named && h.control === "Japan").length,
        alliesNamed: hexes.filter(h => h.named && h.control === "Allies").length }
}
function publicNations(s) {
    return visible(s.rules, s.state, "Observer").observation.scenario.nations
}
async function playOne({ seed, side = "japan", arm, profile, maxRequests, maxTotalTokens, saveFile, resumeLimit = 3, resumeDelayMs = 0 }) {
    const began = Date.now()
    const players = sidesFor(side, arm, profile)
    let s, resumed = 0, lastError = null
    const make = () => api.createSession({ seed, scenario: SCENARIO, players, semiBots: { Japan: SEMI_EXECUTOR, Allies: SEMI_EXECUTOR },
        maxRequests, maxTotalTokens, maxActions: 30000 })
    if (fs.existsSync(saveFile)) {
        try { s = api.restoreSession(JSON.parse(fs.readFileSync(saveFile, "utf8")), { allowPolicyMigration: true }) }
        catch (e) { s = make() }
    } else s = make()
    const checkpoint = () => { try { secureWrite(saveFile, api.serializeSession(s)) } catch (e) { /* 磁盘问题不改变对局 */ } }
    while (s.status !== "complete") {
        try { await api.step(s, { revision: s.revision }) }
        catch (e) {
            lastError = { code: e.code || "ENGINE", message: e.code ? e.message : "engine" }
            const transient = TRANSIENT.has(lastError.code)
            if (transient && resumed < resumeLimit) {
                resumed++; checkpoint()
                if (resumeDelayMs > 0) await new Promise(resolve => setTimeout(resolve, resumeDelayMs))
                s = api.restoreSession(JSON.parse(fs.readFileSync(saveFile, "utf8")), { allowPolicyMigration: true })
                continue
            }
            break
        }
        if (s.revision % 50 === 0) checkpoint()
        if (fs.existsSync(path.join(ROOT, "llm-private", "semi-eval", "STOP"))) break
    }
    checkpoint()
    const replay = api.replay(s)
    const verified = s.actions.length ? api.verifyReplay(replay) : { verified: false, actions: 0 }
    const facts = publicNations(s)
    const end = classifyEnd(s.state)
    const strategyCounts = {}
    for (const x of s.strategyLog || []) {
        const key = x.role + ":" + (x.strategy || "program-default")
        strategyCounts[key] = (strategyCounts[key] || 0) + 1
    }
    const resources = endResources(s)
    return { schemaVersion: 1, kind: "eots-semi-eval-game", side, arm, seed, scenario: SCENARIO,
        players: s.options.players, executor: arm === "baseline" ? null : s.options.semiBots[side === "allies" ? "Allies" : "Japan"],
        status: s.status, error: s.error || lastError, resumed,
        result: s.state.result || null, turn: s.state.turn, actions: s.actions.length,
        end: { termination: end.termination, winner: end.winner, wonText: end.won_text, natural: end.natural, earlyTreatyDefeat: end.earlyTreatyDefeat },
        politicalWill: s.state.political_will ?? null, powRequired: s.state.pow ?? null,
        powHeld: (s.state.capture || []).filter(h => { const bits = (s.state.supply_cache || [])[h]; return bits && (bits & (1 << 24)) && !(bits & (1 << 23)) }).length,
        resources, nations: facts.map(n => ({ key: n.key, surrenderedTurn: n.surrenderedTurn,
            remainingKeyCount: n.remainingKeys.length, allJapanControlled: n.allJapanControlled })),
        llm: arm === "baseline" ? null : { profile, side, requests: s.stats.requests, retries: s.stats.retries,
            failedRequests: s.stats.failedRequests, invalidResponses: s.stats.invalidResponses,
            promptTokens: s.stats.promptTokens, completionTokens: s.stats.completionTokens, totalTokens: s.stats.totalTokens,
            strategyDecisions: (s.strategyLog || []).length, sourceLlm: (s.strategyLog || []).filter(x => x.source === "llm").length,
            sourceDefault: (s.strategyLog || []).filter(x => x.source === "program-default").length, strategyCounts },
        rulesSha256: s.rulesSha256, verified: !!verified.verified, finalStateHash: replay.finalStateHash,
        durationMs: Date.now() - began, finishedAt: new Date().toISOString() }
}

async function runWorker(o) {
    loadEnvFile()
    const seeds = String(o.seeds).split(",").map(Number).filter(Number.isSafeInteger)
    const out = path.resolve(o.out)
    const file = doneSeeds(out)
    for (const seed of seeds) {
        if (file.has(seed)) { process.stderr.write(`skip ${seed}\n`); continue }
        const saveFile = path.join(ROOT, "llm-private", "semi-eval", `${o.arm}-${o.profile || "baseline"}-${seed}.save.json`)
        const record = await playOne({ seed, side: o.side || "japan", arm: o.arm, profile: o.profile,
            maxRequests: Number(o["max-requests"] || 400), maxTotalTokens: Number(o["max-tokens"] || 8000000), saveFile,
            resumeLimit: Number(o["resume-limit"] || 3), resumeDelayMs: Number(o["resume-delay-ms"] || 0) })
        appendJsonl(out, record)
        for (const suffix of [".save.json"]) { try { fs.unlinkSync(saveFile) } catch { } }
        process.stderr.write(`done ${seed}: ${record.status} winner=${record.end.winner} turn=${record.turn} surrenders=${record.nations.filter(n => n.surrenderedTurn > 0).length} llmReq=${record.llm ? record.llm.requests : 0} tokens=${record.llm ? record.llm.totalTokens : 0}\n`)
    }
}

function summarize(out) {
    const rows = fs.readFileSync(out, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l))
    const complete = rows.filter(r => r.status === "complete")
    const nats = rows.map(r => r.nations.filter(n => n.surrenderedTurn > 0).length)
    const summary = { schemaVersion: 1, kind: "eots-semi-eval-summary", file: path.basename(out), games: rows.length,
        complete: complete.length, japanWins: complete.filter(r => r.end.winner === "Japan").length,
        alliesWins: complete.filter(r => r.end.winner === "Allies").length,
        naturalEnds: complete.filter(r => r.end.termination === "natural").length,
        verifiedWins: complete.filter(r => r.end.winner === "Japan" && r.verified).length,
        avgTurns: complete.length ? +(complete.reduce((a, r) => a + r.turn, 0) / complete.length).toFixed(2) : null,
        surrenderCounts: { ph: rows.filter(r => r.nations[0].surrenderedTurn > 0).length,
            malaya: rows.filter(r => r.nations[1].surrenderedTurn > 0).length,
            dei: rows.filter(r => r.nations[2].surrenderedTurn > 0).length,
            burma: rows.filter(r => r.nations[3].surrenderedTurn > 0).length,
            avgPerGame: +(nats.reduce((a, b) => a + b, 0) / rows.length).toFixed(2) },
        avgJapanResourcesAtEnd: +(rows.reduce((a, r) => a + r.resources.japanResource, 0) / rows.length).toFixed(2),
        avgPoliticalWill: +(rows.reduce((a, r) => a + (r.politicalWill ?? 0), 0) / rows.length).toFixed(2),
        llmTotals: rows.some(r => r.llm) ? { requests: rows.reduce((a, r) => a + (r.llm?.requests || 0), 0),
            totalTokens: rows.reduce((a, r) => a + (r.llm?.totalTokens || 0), 0),
            invalidResponses: rows.reduce((a, r) => a + (r.llm?.invalidResponses || 0), 0),
            strategyDecisions: rows.reduce((a, r) => a + (r.llm?.strategyDecisions || 0), 0),
            sourceLlm: rows.reduce((a, r) => a + (r.llm?.sourceLlm || 0), 0) } : null }
    return summary
}

async function main() {
    const o = args(process.argv.slice(2))
    if (o.worker) return runWorker(o)
    const games = Number(o.games || 10), baseSeed = Number(o["base-seed"] || 20262701), workers = Number(o.workers || 1)
    const arm = o.arm || "semi", profile = o.profile || "deepseek", side = o.side || "japan"
    const out = path.resolve(o.out || path.join(ROOT, "tests", "results", `semi-eval-${side === "allies" ? "ap" : "jp"}42-${arm}-${profile}.jsonl`))
    const seeds = Array.from({ length: games }, (_, i) => baseSeed + i).filter(seed => !doneSeeds(out).has(seed))
    if (!seeds.length) { console.log(JSON.stringify({ summary: summarize(out) }, null, 2)); return }
    if (workers <= 1) { await runWorker({ ...o, side, arm, profile, out, seeds: seeds.join(",") }) }
    else {
        const buckets = Array.from({ length: workers }, () => [])
        seeds.forEach((seed, i) => buckets[i % workers].push(seed))
        await Promise.all(buckets.filter(b => b.length).map(bucket => new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [__filename, "--worker", "--side", side, "--arm", arm, "--profile", profile,
                "--seeds", bucket.join(","), "--out", out, "--max-requests", String(o["max-requests"] || 400), "--max-tokens", String(o["max-tokens"] || 8000000),
                "--resume-limit", String(o["resume-limit"] || 3), "--resume-delay-ms", String(o["resume-delay-ms"] || 0)],
                { stdio: ["ignore", "ignore", "inherit"], env: process.env })
            child.on("exit", code => code === 0 ? resolve() : reject(new Error("worker exit " + code)))
            child.on("error", reject)
        })))
    }
    console.log(JSON.stringify({ summary: summarize(out) }, null, 2))
}
if (require.main === module) main().catch(e => { console.error(e.code || "SEMI_EVAL_ERROR", e.code ? e.message : e.message); process.exitCode = 1 })
module.exports = { playOne, summarize, endResources }
