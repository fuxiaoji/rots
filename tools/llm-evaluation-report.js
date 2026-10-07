#!/usr/bin/env node
"use strict"
// Deterministic statistics over final result files; no credentials or API calls.
const fs = require("node:fs"), path = require("node:path")
function wilson(w, n) {
    if (!n) return null
    const z = 1.959963984540054, p = w / n, den = 1 + z * z / n
    const center = (p + z * z / (2 * n)) / den
    const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [Math.max(0, center - margin), Math.min(1, center + margin)]
}
function summarize(results) {
    const n = results.length, natural = results.filter(r => r.naturalComplete)
    const wins = results.filter(r => r.naturalComplete && r.won).length
    const stats = {}
    for (const key of ["requests", "retries", "failedRequests", "invalidResponses", "totalTokens", "promptTokens",
        "completionTokens", "usageUnknown", "latencyMs", "forcedActions", "assistedActions"])
        stats[key] = results.reduce((s, r) => s + (r.stats?.[key] || 0), 0)
    const terminations = {}
    for (const r of results) terminations[r.termination] = (terminations[r.termination] || 0) + 1
    return { attempts: n, wins, naturalComplete: natural.length, naturalLosses: natural.length - wins,
        incomplete: n - natural.length, winRate: n ? wins / n : null, wilson95: wilson(wins, n),
        conditionalWinRate: natural.length ? wins / natural.length : null, terminations, stats,
        meanRequestLatencyMs: stats.requests ? stats.latencyMs / stats.requests : null, cost: "unknown" }
}
function main(manifestPath, root, output) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    const results = manifest.jobs.map(j => {
        const p = path.join(root, j.id, "result.json")
        if (!fs.existsSync(p)) throw Error("RESULT_MISSING:" + j.id)
        const r = JSON.parse(fs.readFileSync(p, "utf8"))
        const save = JSON.parse(fs.readFileSync(path.join(root, j.id, "save.json"), "utf8"))
        r.invalidResponseTypes = {}
        const { parseAnswer } = require("../js/server/llm/harness")
        for (const entry of save.replay.requestLedger.filter(x => x.code === "FORMAT")) {
            const raw = JSON.parse(fs.readFileSync(path.join(root, j.id, "requests", entry.ordinal + ".json"), "utf8"))
            const content = raw.messages[1].content
            const payload = JSON.parse((typeof content === "string" ? content : content[0].text).split("\n上次输出无效：")[0])
            try { parseAnswer(raw.content, { candidates: payload.candidates }, entry.decisionId) }
            catch (error) { r.invalidResponseTypes[error.message] = (r.invalidResponseTypes[error.message] || 0) + 1 }
        }
        const lastRequest = path.join(root, j.id, "requests", r.stats.requests + ".json")
        if (r.termination.startsWith("EOTS_") && fs.existsSync(lastRequest)) {
            const request = JSON.parse(fs.readFileSync(lastRequest, "utf8"))
            r.providerFailure = { code: request.code || null, httpStatus: request.httpStatus || null,
                providerCode: request.providerCode || null, usage: request.usage || null }
        }
        if (r.seed !== j.seed || r.role !== j.role || r.profile !== j.profile || r.scenario !== j.scenario || r.opponent !== j.opponent)
            throw Error("SETUP_MISMATCH:" + j.id)
        if (r.naturalComplete && (!r.verified?.verified || !r.verified.complete || !r.end.natural || !r.winner))
            throw Error("UNVERIFIED_NATURAL:" + j.id)
        if (r.won !== (r.naturalComplete && r.winner === j.role) ||
            r.naturalComplete && r.winner !== r.verified.result || !r.naturalComplete && r.winner !== null)
            throw Error("WINNER_MISMATCH:" + j.id)
        return r
    })
    const profiles = [...new Set(results.map(r => r.profile))]
    const byProfile = Object.fromEntries(profiles.map(p => {
        const group = results.filter(r => r.profile === p)
        return [p, { ...summarize(group), byRole: Object.fromEntries(["Japan", "Allies"].map(role => [role, summarize(group.filter(r => r.role === role))])) }]
    }))
    const publicResults = results.map(({ id, profile, requestedModel, role, seed, scenario, opponent, status, naturalComplete,
        winner, won, termination, turn, actions, stats, verified, naturalEndReason, fingerprint, elapsedMs, providerFailure, invalidResponseTypes }) =>
        ({ id, profile, requestedModel, role, seed, scenario, opponent, status, naturalComplete, winner, won, termination,
            turn, actions, stats, verified, naturalEndReason, fingerprint, elapsedMs, invalidResponseTypes,
            ...(providerFailure ? { providerFailure } : {}) }))
    const value = { taskId: manifest.taskId, phase: manifest.phase, frozenAt: manifest.frozenAt,
        fileHashes: manifest.fileHashes, overall: summarize(results), byProfile, results: publicResults }
    fs.writeFileSync(output, JSON.stringify(value, null, 2) + "\n")
    console.log(JSON.stringify({ overall: value.overall, byProfile }))
    return value
}
if (require.main === module) main(...process.argv.slice(2))
module.exports = { wilson, summarize, main }
