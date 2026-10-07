"use strict"

const fs = require("node:fs")

const MAX_RESPONSE_BYTES = 1024 * 1024
const OWN_ERRORS = new WeakSet()
// Official endpoints/model IDs checked 2026-10-05. Vision is an explicit
// application capability; changing MODEL never silently enables images.
// https://platform.minimax.io/docs/api-reference/text-openai-api
// https://api-docs.deepseek.com/api/create-chat-completion/
// https://docs.z.ai/guides/llm/glm-5.3
// https://docs.z.ai/guides/vlm/glm-4.6v
const PRESETS = {
    minimax: { provider: "minimax", baseUrl: "https://api.minimax.io/v1", model: "MiniMax-M3", vision: false, extraBody: { thinking: { type: "disabled" }, reasoning_split: true }, keys: ["MINIMAX_API_KEY"] },
    deepseek: { provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-flash", vision: false, extraBody: { thinking: { type: "disabled" } }, keys: ["DEEPSEEK_API_KEY"] },
    glm: { provider: "glm", baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-5.3", vision: false, extraBody: { thinking: { type: "enabled" }, reasoning_effort: "low" }, keys: ["GLM_API_KEY", "ZAI_API_KEY"] },
    "glm-vision": { provider: "glm", baseUrl: "https://api.z.ai/api/paas/v4", model: "glm-4.6v", vision: true, extraBody: {}, keys: ["EOTS_LLM_GLM_API_KEY", "GLM_API_KEY", "ZAI_API_KEY"] },
    custom: { provider: "openai-compatible", baseUrl: "", model: "", vision: false, extraBody: {}, keys: [] },
}
const EXTRA_KEYS = new Set(["thinking", "reasoning_effort", "reasoning_split", "response_format", "top_p"])

function fail(code, status, providerCode) {
    const error = new Error(code + (status === undefined ? "" : ` (HTTP ${status})`) + (providerCode === undefined ? "" : ` (code ${providerCode})`))
    OWN_ERRORS.add(error)
    error.code = code
    if (status !== undefined) error.status = status
    if (providerCode !== undefined) error.providerCode = providerCode
    return error
}

// A deliberately small dotenv grammar. Never evaluate shell text, expand
// variables, execute substitutions, or include input values in diagnostics.
function loadEnv(filename, env = process.env) {
    const input = fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, "")
    const parsed = Object.create(null)
    for (const [index, raw] of input.split(/\r?\n/).entries()) {
        let line = raw.trim()
        if (!line || line.startsWith("#")) continue
        line = line.replace(/^export\s+/, "")
        const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
        if (!match || ["__proto__", "constructor", "prototype"].includes(match[1])) throw fail(`EOTS_LLM_ENV_LINE_${index + 1}`)
        let value = match[2]
        if (value.startsWith('"') || value.startsWith("'")) {
            const quote = value[0]
            let end = 1
            for (; end < value.length; end++) {
                if (quote === '"' && value[end] === "\\") { end++; continue }
                if (value[end] === quote) break
            }
            if (end >= value.length || !/^\s*(?:#.*)?$/.test(value.slice(end + 1))) throw fail(`EOTS_LLM_ENV_LINE_${index + 1}`)
            value = value.slice(1, end)
            if (quote === '"') value = value.replace(/\\([nrt"\\])/g, (_, c) => ({ n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" })[c])
        } else value = value.replace(/\s+#.*$/, "").trim()
        parsed[match[1]] = value
    }
    // Parse everything before applying anything, and preserve even empty env
    // values: the environment always wins over a file.
    for (const key of Object.keys(parsed)) if (!Object.hasOwn(env, key)) env[key] = parsed[key]
    return env
}

function bool(value, fallback) {
    if (value === undefined || value === "") return fallback
    if (value === "true" || value === "1") return true
    if (value === "false" || value === "0") return false
    throw fail("EOTS_LLM_CONFIG_BOOLEAN")
}

function integer(value, fallback, min, max) {
    if (value === undefined || value === "") return fallback
    if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw fail("EOTS_LLM_CONFIG_INTEGER")
    return Number(value)
}

function extraBody(value, defaults) {
    if (value === undefined || value === "") return structuredClone(defaults)
    let parsed
    try { parsed = typeof value === "string" ? JSON.parse(value) : structuredClone(value) } catch { throw fail("EOTS_LLM_CONFIG_EXTRA_BODY") }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).some(key => !EXTRA_KEYS.has(key))) throw fail("EOTS_LLM_CONFIG_EXTRA_BODY")
    return parsed
}

function getProfile(id, env = process.env) {
    if (!Object.hasOwn(PRESETS, id)) throw fail("EOTS_LLM_UNKNOWN_PROFILE")
    const preset = PRESETS[id]
    const prefix = id === "custom" ? "EOTS_LLM_" : `EOTS_LLM_${id.toUpperCase().replace(/-/g, "_")}_`
    const field = name => env[prefix + name]
    const provider = field("PROVIDER") || preset.provider, extended = provider === "deepseek"
    const profile = {
        id,
        provider,
        baseUrl: field("BASE_URL") || preset.baseUrl,
        model: field("MODEL") || preset.model,
        apiKey: field("API_KEY") !== undefined ? field("API_KEY") : preset.keys.map(key => env[key]).find(value => value !== undefined) || "",
        vision: bool(field("VISION"), preset.vision),
        timeoutMs: integer(field("TIMEOUT_MS") || env.EOTS_LLM_TIMEOUT_MS, 30000, 1, extended ? 600000 : 300000),
        maxTokens: integer(field("MAX_TOKENS") || env.EOTS_LLM_MAX_TOKENS, 4096, 1, extended ? 65536 : 32768),
        extraBody: extraBody(field("EXTRA_BODY"), preset.extraBody),
    }
    // JSON mode is opt-in and requires an explicit capability acknowledgement
    // for custom/MiniMax/vision profiles. No model-name guessing is performed.
    if (bool(field("JSON_MODE"), false)) {
        const supported = bool(field("JSON_SUPPORTED"), id === "deepseek" || id === "glm")
        if (!supported) throw fail("EOTS_LLM_JSON_UNSUPPORTED")
        profile.extraBody.response_format = { type: "json_object" }
    }
    return profile
}

function listProfiles(env = process.env) {
    return Object.keys(PRESETS).map(id => {
        const profile = getProfile(id, env)
        return { id, provider: profile.provider, model: profile.model, vision: profile.vision, configured: Boolean(profile.apiKey && profile.baseUrl && profile.model) }
    })
}

function endpoint(baseUrl) {
    let url
    try { url = new URL(baseUrl) } catch { throw fail("EOTS_LLM_CONFIG_URL") }
    const loopback = url.hostname === "localhost" || url.hostname === "[::1]" || /^127\./.test(url.hostname)
    if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || (url.protocol === "http:" && loopback))) throw fail("EOTS_LLM_CONFIG_URL")
    const basePath = url.pathname.replace(/\/+$/, "")
    url.pathname = basePath.endsWith("/chat/completions") ? basePath : basePath + "/chat/completions"
    return url.href
}

async function readBody(response, signal) {
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
        await response.body?.cancel().catch(() => {})
        throw fail("EOTS_LLM_RESPONSE_TOO_LARGE")
    }
    if (!response.body || typeof response.body.getReader !== "function") throw fail("EOTS_LLM_INVALID_RESPONSE")
    const reader = response.body.getReader()
    const onAbort = () => { reader.cancel().catch(() => {}) }
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
    const chunks = []
    let size = 0
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > MAX_RESPONSE_BYTES) { await reader.cancel().catch(() => {}); throw fail("EOTS_LLM_RESPONSE_TOO_LARGE") }
            chunks.push(Buffer.from(value))
        }
    } finally { signal.removeEventListener("abort", onAbort); reader.releaseLock() }
    try { return JSON.parse(Buffer.concat(chunks, size).toString("utf8")) } catch { throw fail("EOTS_LLM_INVALID_RESPONSE") }
}

function numericCode(value) {
    // Never echo arbitrary provider strings (which may contain prompts/keys).
    return /^-?\d{1,12}$/.test(String(value)) ? String(value) : undefined
}

function usageSummary(usage) {
    if (!usage || !Number.isSafeInteger(usage.total_tokens) && !Number.isSafeInteger(usage.prompt_tokens)) return null
    const result = {}
    for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) if (Number.isSafeInteger(usage?.[key]) && usage[key] >= 0) result[key] = usage[key]
    return result
}

function createClient(profile, { fetchImpl = fetch } = {}) {
    if (!profile || typeof profile.apiKey !== "string" || !profile.apiKey.trim() || /[^\x21-\x7e]/.test(profile.apiKey) || typeof profile.model !== "string" || !profile.model.trim()) throw fail("EOTS_LLM_NOT_CONFIGURED")
    const url = endpoint(profile.baseUrl)
    // DeepSeek supports >=64K generation (official API, checked 2026-10-07).
    // Keep application caps bounded and other providers at their reviewed caps.
    const extended = profile.provider === "deepseek"
    const timeoutMs = integer(profile.timeoutMs, 30000, 1, extended ? 600000 : 300000)
    const maxTokens = integer(profile.maxTokens, 4096, 1, extended ? 65536 : 32768)
    const extra = extraBody(profile.extraBody, {})
    return {
        async complete(messages) {
            if (!Array.isArray(messages) || !messages.length) throw fail("EOTS_LLM_INVALID_MESSAGES")
            if (!profile.vision && messages.some(message => Array.isArray(message?.content) && message.content.some(part => part?.type === "image_url"))) throw fail("EOTS_LLM_VISION_UNSUPPORTED")
            const body = JSON.stringify({ ...extra, model: profile.model, messages, max_tokens: maxTokens, temperature: 0.2, stream: false })
            const controller = new AbortController()
            const start = performance.now()
            let timer
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => { controller.abort(); reject(fail("EOTS_LLM_TIMEOUT")) }, timeoutMs)
            })
            const request = async () => {
                let response
                try {
                    response = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${profile.apiKey}` }, body, signal: controller.signal, redirect: "error" })
                } catch { throw fail(controller.signal.aborted ? "EOTS_LLM_TIMEOUT" : "EOTS_LLM_NETWORK_ERROR") }
                if (response.status !== 200) {
                    await response.body?.cancel().catch(() => {})
                    throw fail("EOTS_LLM_HTTP_ERROR", response.status)
                }
                const data = await readBody(response, controller.signal)
                const businessCode = data?.base_resp?.status_code ?? data?.code
                if (data?.error || (businessCode !== undefined && String(businessCode) !== "0")) throw fail("EOTS_LLM_PROVIDER_ERROR", response.status, numericCode(data?.error?.code ?? businessCode))
                const choice = data?.choices?.[0]
                const summary = { model: typeof data.model === "string" && data.model.length <= 128 && !data.model.includes(profile.apiKey) ? data.model : profile.model,
                    usage: usageSummary(data.usage), latencyMs: Math.round(performance.now() - start) }
                const paidFailure = code => Object.assign(fail(code), summary)
                if (choice?.finish_reason === "length") throw paidFailure("EOTS_LLM_TRUNCATED_RESPONSE")
                const content = choice?.message?.content
                if (typeof content !== "string" || !content.trim()) throw paidFailure("EOTS_LLM_INVALID_RESPONSE")
                return { content, ...summary }
            }
            try { return await Promise.race([request(), timeout]) }
            catch (error) {
                // Do not propagate raw transport/body exceptions or causes.
                if (OWN_ERRORS.has(error)) throw error
                throw fail(controller.signal.aborted ? "EOTS_LLM_TIMEOUT" : "EOTS_LLM_INVALID_RESPONSE")
            } finally { clearTimeout(timer) }
        },
    }
}

module.exports = { loadEnv, getProfile, listProfiles, createClient }
