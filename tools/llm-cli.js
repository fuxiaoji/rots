#!/usr/bin/env node
"use strict"
const fs = require("node:fs"), path = require("node:path")
const ROOT = path.resolve(__dirname, ".."), providers = require("../js/server/llm/providers")
const api = require("../js/server/llm/session")
function args(argv) { const o = { command: argv[0] || "help" }; for (let i = 1; i < argv.length; i++) { if (!argv[i].startsWith("--") || !argv[i + 1]) throw Error("参数需要 --name value"); o[argv[i].slice(2)] = argv[++i] } return o }
function secureWrite(filename, value) { fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 }); fs.writeFileSync(filename, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.chmodSync(filename, 0o600) }
async function main(argv = process.argv.slice(2)) {
    const o = args(argv), envfile = process.env.EOTS_LLM_ENV_FILE || path.join(ROOT, ".env.llm.local")
    if (fs.existsSync(envfile)) providers.loadEnv(envfile)
    if (o.command === "profiles") return console.log(JSON.stringify(providers.listProfiles(), null, 2))
    if (o.command === "inspect") {
        const saved = JSON.parse(fs.readFileSync(o.input, "utf8")), role = o.role || "Allies"
        if (!["Japan", "Allies"].includes(role)) throw Error("阵营无效")
        return console.log(JSON.stringify({ id: saved.id, role, status: saved.status,
            memory: saved.memories?.[role], stats: saved.replay.stats, requestLedger: saved.replay.requestLedger }, null, 2))
    }
    if (o.command === "verify") return console.log(JSON.stringify(api.verifyReplay(JSON.parse(fs.readFileSync(o.input, "utf8"))), null, 2))
    if (o.command === "play") {
        const role = o.role || "Allies", other = role === "Allies" ? "Japan" : "Allies"
        if (!["Japan", "Allies"].includes(role)) throw Error("--role Japan 或 Allies")
        const options = { seed: Number(o.seed || 20261005), scenario: o.scenario || "South Pacific",
            players: { [role]: "llm:" + (o.profile || "deepseek"), [other]: o.opponent || "erasmus-v2-opt-v5" },
            maxRequests: Number(o["max-requests"] || 10), maxTotalTokens: Number(o["max-tokens"] || 200000), maxActions: 60000 }
        const s = o.input ? api.restoreSession(JSON.parse(fs.readFileSync(o.input, "utf8")), { allowPolicyMigration: o["allow-policy-migration"] === "true" }) : api.createSession(options)
        const count = Number(o.steps || 10), out = path.resolve(o.out || path.join(ROOT, "llm-private", s.id))
        if (!Number.isSafeInteger(count) || count < 1 || count > 60000) throw Error("--steps 1..60000")
        let error = null
        try { for (let i = 0; i < count && s.status !== "complete"; i++) {
            await api.step(s, { revision: s.revision })
            console.log(JSON.stringify({ action: s.revision, turn: s.state.turn, role: s.lastDecision.role,
                policy: s.lastDecision.trace.policy, requests: s.stats.requests, status: s.status }))
            secureWrite(out + ".save.json", api.serializeSession(s))
        } } catch (e) { error = { code: e.code || "ERROR", message: e.code ? e.message : "CLI执行失败" } }
        secureWrite(out + ".save.json", api.serializeSession(s)); secureWrite(out + ".replay.json", api.replay(s))
        const verified = api.verifyReplay(api.replay(s))
        console.log(JSON.stringify({ status: s.status, actions: s.revision, stats: s.stats, verified, error, save: out + ".save.json" }, null, 2))
        if (error) process.exitCode = 1
        return
    }
    if (o.command === "review") {
        if (!o.input || !o.profile || !o.out) throw Error("review需要 --profile --input --out")
        const text = fs.readFileSync(o.input, "utf8")
        if (text.length > 100000) throw Error("评审上下文超过100000字符")
        const p = providers.getProfile(o.profile), begin = Date.now()
        const messages = [{ role: "system", content: "你是独立只读代码审查者。仅根据所给需求、代码和测试判断，不执行工具、不修改文件。找出具体可复现缺陷，注明严重程度、证据和最小修复；区分事实和未验证假设。" }, { role: "user", content: text }]
        let output
        try { const r = await providers.createClient(p).complete(messages); output = { ok: true, ...r } }
        catch (e) { output = { ok: false, code: e.code || "ERROR", message: e.code ? e.message : "评审接口失败" } }
        const { hash } = require("../js/server/llm/observation")
        secureWrite(o.out, { profile: p.id, requestedModel: p.model, promptHash: hash(messages), elapsedMs: Date.now() - begin,
            ...output, outputHash: output.content ? hash(output.content) : null })
        console.log(JSON.stringify({ profile: p.id, ok: output.ok, model: output.model, usage: output.usage, code: output.code, out: o.out }))
        if (!output.ok) process.exitCode = 1
        return
    }
    console.log('node tools/llm-cli.js profiles\nnode tools/llm-cli.js play --profile deepseek --role Allies --steps 10 --max-requests 10 --out llm-private/smoke\nnode tools/llm-cli.js play --input llm-private/smoke.save.json --steps 10\nnode tools/llm-cli.js verify --input llm-private/smoke.replay.json')
}
if (require.main === module) main().catch(e => { console.error(e.code || "CLI_ERROR", e.code ? e.message : "检查命令参数或输入文件"); process.exitCode = 1 })
module.exports = { main, args, secureWrite }
