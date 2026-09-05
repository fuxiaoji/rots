"use strict"

// Reproducible legal-action campaign evidence. No state edits, handicaps, or winner overrides.
// node tests/erasmus-campaign-evidence.js [seed] [count] [tag]
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const rules = require("../rules.js")
const policy = rules.bots["erasmus-v2"]
const baseSeed = Number(process.argv[2] || 20260903)
const count = Number(process.argv[3] || 1)
const tag = String(process.argv[4] || "evidence").replace(/[^\w-]/g, "-")
const scenario = "1942-1945 (The Shortened Campaign)"
const rulesSha256 = crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "..", "rules.js"))).digest("hex")
const reports = []
for (let index = 0; index < count; ++index) {
    const seed = baseSeed + index
    let state = rules.setup(seed, scenario, {headless_moves: true})
    const transcript = []
    const turns = []
    let actions = 0, previousTurn = -1, failure = null
    try {
        while (state.active !== "None" && actions < 60000) {
            const role = Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
            const view = rules.view(state, role)
            const decision = policy.decide(view, {role, seed, actionOrdinal: actions + 1})
            const allowed = view.actions?.[decision.action]
            if (!Object.hasOwn(view.actions || {}, decision.action) || allowed === false || allowed === 0 ||
                (Array.isArray(allowed) && !allowed.includes(decision.argument)))
                throw Error(`Illegal ${decision.action}(${decision.argument}) at ${view.prompt}`)
            if (state.turn !== previousTurn) {
                turns.push({turn: state.turn, politicalWill: state.political_will, pow: state.pow})
                previousTurn = state.turn
            }
            transcript.push({ordinal: actions + 1, turn: state.turn, role, prompt: view.prompt,
                action: decision.action, argument: decision.argument, chart: decision.publicTrace?.chart,
                node: decision.publicTrace?.node, fallback: !!decision.publicTrace?.fallback,
                strategy: decision.privateTrace?.sm?.strategy || decision.publicTrace?.sm?.strategy})
            state = rules.action(state, role, decision.action, decision.argument)
            ++actions
        }
    } catch (error) { failure = error.stack }
    const result = {seed, policy: policy.version, rulesSha256, scenario, headless_moves: true,
        status: failure ? "error" : state.active === "None" ? "complete" : "action-limit",
        winner: state.result?.won_side || state.result || null, result: state.result,
        actions, turn: state.turn, politicalWill: state.political_will, turns, failure,
        politicalWillLog: (state.log || []).filter(x => /Political will|Progress of War|progress of war|surrender/i.test(x)),
        captureLog: (state.log || []).filter(x => /^(AP|JP) captured /.test(x)),
        fallback: transcript.filter(x => x.fallback).length}
    reports.push(result)
    if (count === 1 || result.winner === "Allies" || failure) {
        fs.writeFileSync(path.join(__dirname, "results", `${tag}-${seed}-replay.json`), JSON.stringify({...result, transcript, log: state.log}, null, 2) + "\n")
    }
    process.stderr.write(`${seed}: ${result.status} ${result.winner} turn=${result.turn} actions=${actions}\n`)
}
const output = path.join(__dirname, "results", `${tag}-${baseSeed}-${count}.json`)
fs.writeFileSync(output, JSON.stringify({rulesSha256, reports}, null, 2) + "\n")
console.log(JSON.stringify({output, complete: reports.filter(x=>x.status === "complete").length,
    alliesWins: reports.filter(x=>x.winner === "Allies").length, errors: reports.filter(x=>x.status === "error").length}))
if (reports.some(x=>x.status !== "complete")) process.exitCode = 1
