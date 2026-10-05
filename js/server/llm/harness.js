"use strict"
const { hash } = require("./observation"), { messagesFor } = require("./prompt"), { boardPng } = require("./board")
function fail(code, message) { const e = new Error(message); e.code = code; return e }
function parseAnswer(content, packet, decisionId) {
    if (typeof content !== "string" || content.length > 16000) throw fail("FORMAT", "JSON响应为空或过长")
    let text = content.trim().replace(/<think>[\s\S]*?<\/think>/g, "").trim()
    if (/^```(?:json)?\s/.test(text)) text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")
    let answer; try { answer = JSON.parse(text) } catch { throw fail("FORMAT", "响应必须是单个JSON对象") }
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) throw fail("FORMAT", "响应必须是JSON对象")
    // The request is bound to this packet by the session's revision/role checks.
    // Model-echoed nonces are neither authentication nor stale-response control.
    const candidate = packet.candidates.find(c => c.id === answer.candidateId)
    if (!candidate) throw fail("FORMAT", "candidateId不在当前合法候选表")
    const m = answer.memory || {}
    if (typeof m !== "object" || Array.isArray(m) || m.objective !== undefined && typeof m.objective !== "string"
        || m.notes !== undefined && (!Array.isArray(m.notes) || m.notes.some(n => typeof n !== "string"))) throw fail("FORMAT", "memory字段格式错误")
    return { candidate, reason: typeof answer.reason === "string" ? answer.reason.slice(0, 300) : "",
        memory: { objective: (m.objective || "").slice(0, 300), notes: (m.notes || []).slice(0, 6).map(s => s.slice(0, 240)) } }
}
function account(stats, result, elapsedMs) {
    stats.latencyMs += result.latencyMs || elapsedMs
    const usage = result.usage || {}, total = Number(usage.total_tokens ?? ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0))) || 0
    stats.totalTokens += total; stats.promptTokens += Number(usage.prompt_tokens) || 0; stats.completionTokens += Number(usage.completion_tokens) || 0
    if (!Number.isSafeInteger(usage.total_tokens) && !(Number.isSafeInteger(usage.prompt_tokens) && Number.isSafeInteger(usage.completion_tokens))) stats.usageUnknown++
}
async function decide(packet, { client, profile, memory, stats, limits, decisionId, ledger = [] }) {
    if (!packet.candidates.length) throw fail("NO_CANDIDATES", "当前窗口没有可执行候选，需检查规则接口")
    // A forced action does not need model inference; keep memory intact.
    if (packet.candidates.length === 1) return { candidate: packet.candidates[0], memory,
        reason: "唯一可执行候选", trace: { policy: "forced", requests: 0, assisted: packet.candidates[0].assisted } }
    const imageUrl = profile.vision ? "data:image/png;base64," + boardPng(packet.observation).toString("base64") : undefined
    let repair = null
    for (let attempt = 0; attempt < 2; attempt++) {
        if (stats.requests >= limits.maxRequests || stats.totalTokens >= limits.maxTotalTokens)
            throw fail("BUDGET", repair ? "预算不足以修复上次格式错误；对局暂停，失败详情已入请求账本" : "本局模型请求或token预算已耗尽；对局暂停")
        const p = messagesFor(packet, memory, decisionId, repair, imageUrl)
        stats.requests++; if (attempt) stats.retries++
        const record = { ordinal: stats.requests, role: packet.observation.role, decisionId, attempt,
            requestedModel: profile.model, provider: profile.provider, promptHash: p.promptHash, promptVersion: p.version,
            sources: p.sources.map(({ file, sha256 }) => ({ file, sha256 })), observationHash: packet.observationHash, image: !!imageUrl }
        ledger.push(record)
        const begin = Date.now()
        let result
        try { result = await client.complete(p.messages) }
        catch (e) {
            stats.failedRequests++; account(stats, e, Date.now() - begin)
            Object.assign(record, { code: e.code || "PROVIDER", model: e.model || profile.model, usage: e.usage || null, latencyMs: e.latencyMs || Date.now() - begin })
            throw fail(e.code || "PROVIDER", "模型接口失败：" + (e.code || "PROVIDER"))
        }
        account(stats, result, Date.now() - begin)
        Object.assign(record, { model: result.model || profile.model, usage: result.usage || null, latencyMs: result.latencyMs,
            outputHash: hash(result.content) })
        if (stats.totalTokens > limits.maxTotalTokens) { record.code = "BUDGET"; throw fail("BUDGET", "响应已计费，但超过本局token预算；动作未执行") }
        try {
            const parsed = parseAnswer(result.content, packet, decisionId)
            record.code = "OK"
            return { ...parsed, trace: { policy: "llm", provider: profile.provider, model: result.model || profile.model,
                promptVersion: p.version, promptHash: p.promptHash, outputHash: hash(result.content), observationHash: packet.observationHash,
                sources: p.sources.map(({ file, sha256 }) => ({ file, sha256 })), usage: result.usage || null,
                requests: attempt + 1, latencyMs: result.latencyMs, image: !!imageUrl, assisted: parsed.candidate.assisted } }
        } catch (e) { record.code = e.code || "FORMAT"; stats.invalidResponses++; repair = e.message; if (attempt) throw e }
    }
}
module.exports = { decide, parseAnswer, fail }
