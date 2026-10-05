"use strict"

const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { loadEnv, getProfile, listProfiles, createClient } = require("../js/server/llm/providers.js")

const messages = [{ role: "user", content: "Return JSON only: {\"choice\":1}" }]
const secret = "mock-secret-do-not-echo"
const profile = () => ({ ...getProfile("deepseek", {}), apiKey: secret })
const ok = () => new Response(JSON.stringify({ model: "test-model", choices: [{ message: { content: '{"choice":1}' }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7, unknown: secret } }))
async function expectCode(promise, code, status) {
    await assert.rejects(promise, error => {
        assert.equal(error.code, code)
        if (status !== undefined) assert.equal(error.status, status)
        assert(!error.message.includes(secret))
        assert.equal(error.cause, undefined)
        return true
    })
}
function withEnvFile(content, fn) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eots-env-test-"))
    const filename = path.join(directory, "fixture")
    try { fs.writeFileSync(filename, content); fn(filename) }
    finally { fs.rmSync(directory, { recursive: true, force: true }) }
}

test("dotenv supports quotes, comments, BOM, export, and environment precedence", () => {
    withEnvFile('\uFEFF# fixture\nexport KEY="file"\nEMPTY=file\nSINGLE=\'a # b\' # comment\nDOUBLE="a\\nb\\\"c"\nBARE=value # comment\nURL=https://example.test/#fragment\n', filename => {
        const env = { KEY: "existing", EMPTY: "" }
        assert.equal(loadEnv(filename, env), env)
        assert.deepEqual(env, { KEY: "existing", EMPTY: "", SINGLE: "a # b", DOUBLE: 'a\nb"c', BARE: "value", URL: "https://example.test/#fragment" })
    })
})

test("dotenv keeps shell substitutions literal and rejects invalid input atomically", () => {
    withEnvFile('LITERAL=$(touch /tmp/never-execute)\nREFERENCE=${KEY}\n', filename => {
        assert.deepEqual(loadEnv(filename, {}), { LITERAL: "$(touch /tmp/never-execute)", REFERENCE: "${KEY}" })
    })
    for (const bad of ['A=valid\nBROKEN SECRET\n', 'A=valid\nB="unterminated\n', 'A=valid\n__proto__=evil\n']) {
        withEnvFile(bad, filename => {
            const env = {}
            assert.throws(() => loadEnv(filename, env), /^Error: EOTS_LLM_ENV_LINE_2$/)
            assert.deepEqual(env, {})
        })
    }
})

test("presets declare explicit vision and do not infer it from a model override", () => {
    assert.equal(getProfile("glm", {}).model, "glm-5.3")
    assert.equal(getProfile("glm", { EOTS_LLM_GLM_MODEL: "glm-4.6v" }).vision, false)
    assert.equal(getProfile("glm-vision", {}).vision, true)
    assert.equal(getProfile("minimax", {}).model, "MiniMax-M3")
    assert.equal(getProfile("deepseek", {}).model, "deepseek-flash")
    assert.deepEqual(getProfile("glm", {}).extraBody, { thinking: { type: "enabled" }, reasoning_effort: "low" })
})

test("key aliases, shared GLM key, explicit empty key and per-profile configuration", () => {
    assert.equal(getProfile("minimax", { MINIMAX_API_KEY: secret }).apiKey, secret)
    assert.equal(getProfile("minimax", { MINIMAX_API_KEY: secret, EOTS_LLM_MINIMAX_API_KEY: "" }).apiKey, "")
    assert.equal(getProfile("glm-vision", { EOTS_LLM_GLM_API_KEY: secret }).apiKey, secret)
    assert.equal(getProfile("deepseek", { EOTS_LLM_TIMEOUT_MS: "100", EOTS_LLM_DEEPSEEK_TIMEOUT_MS: "200" }).timeoutMs, 200)
    const env = { EOTS_LLM_PROVIDER: "local", EOTS_LLM_BASE_URL: "http://127.0.0.1:8765/v1", EOTS_LLM_MODEL: "local-model", EOTS_LLM_API_KEY: secret, EOTS_LLM_VISION: "1" }
    assert.equal(getProfile("custom", env).vision, true)
    const listed = listProfiles(env)
    assert.equal(listed.find(p => p.id === "custom").configured, true)
    assert(listed.every(p => Object.keys(p).sort().join() === "configured,id,model,provider,vision"))
    assert(!JSON.stringify(listed).includes(secret))
})

test("profile configuration rejects unknown IDs, bad numbers and body overrides", () => {
    for (const id of ["missing", "__proto__", "constructor"]) assert.throws(() => getProfile(id, {}), /EOTS_LLM_UNKNOWN_PROFILE/)
    for (const value of ["NaN", "0", "300001", "-1"]) assert.throws(() => getProfile("custom", { EOTS_LLM_TIMEOUT_MS: value }), /EOTS_LLM_CONFIG_INTEGER/)
    assert.throws(() => getProfile("custom", { EOTS_LLM_VISION: "yes" }), /EOTS_LLM_CONFIG_BOOLEAN/)
    for (const value of ['{"messages":[]}', "[]", "broken"]) assert.throws(() => getProfile("custom", { EOTS_LLM_EXTRA_BODY: value }), /EOTS_LLM_CONFIG_EXTRA_BODY/)
})

test("JSON mode requires supported capability and never appears by default", () => {
    assert.equal(getProfile("deepseek", {}).extraBody.response_format, undefined)
    assert.deepEqual(getProfile("deepseek", { EOTS_LLM_DEEPSEEK_JSON_MODE: "true" }).extraBody.response_format, { type: "json_object" })
    assert.throws(() => getProfile("custom", { EOTS_LLM_JSON_MODE: "true" }), /EOTS_LLM_JSON_UNSUPPORTED/)
    assert.deepEqual(getProfile("custom", { EOTS_LLM_JSON_MODE: "true", EOTS_LLM_JSON_SUPPORTED: "true" }).extraBody.response_format, { type: "json_object" })
})

test("transport preserves base paths, limits tokens and exposes bounded usage", async () => {
    for (const [baseUrl, expected] of [["https://example.test", "https://example.test/chat/completions"], ["https://example.test/v1/", "https://example.test/v1/chat/completions"], ["https://example.test/api/paas/v4", "https://example.test/api/paas/v4/chat/completions"], ["http://127.0.0.1:9/v1/chat/completions", "http://127.0.0.1:9/v1/chat/completions"]]) {
        const client = createClient({ ...profile(), baseUrl, maxTokens: 123 }, { fetchImpl: async (url, options) => {
            assert.equal(url, expected)
            assert.equal(options.redirect, "error")
            assert.equal(options.headers.Authorization, `Bearer ${secret}`)
            const body = JSON.parse(options.body)
            assert.deepEqual(body.messages, messages)
            assert.equal(body.max_tokens, 123)
            assert.equal(body.temperature, 0.2)
            assert.equal(body.stream, false)
            assert.deepEqual(body.thinking, { type: "disabled" })
            return ok()
        } })
        const result = await client.complete(messages)
        assert.equal(result.content, '{"choice":1}')
        assert.equal(result.model, "test-model")
        assert.deepEqual(result.usage, { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 })
        assert(result.latencyMs >= 0)
    }
})

test("transport rejects credentials in URLs and remote plaintext HTTP", () => {
    for (const baseUrl of ["https://user:password@example.test/v1", "http://example.test", "file:///tmp/f", "https://example.test/v1?key=secret", "https://example.test/#secret", "not-url"]) {
        assert.throws(() => createClient({ ...profile(), baseUrl }), /EOTS_LLM_CONFIG_URL/)
    }
    for (const baseUrl of ["http://localhost:8765/v1", "http://[::1]:8765/v1"]) assert.doesNotThrow(() => createClient({ ...profile(), baseUrl }))
    assert.throws(() => createClient({ ...profile(), apiKey: "" }), /EOTS_LLM_NOT_CONFIGURED/)
})

test("vision guard rejects images for text profiles before transport", async () => {
    let called = false
    const imageMessages = [{ role: "user", content: [{ type: "text", text: "describe" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }] }]
    const fetchImpl = async () => { called = true; return ok() }
    await expectCode(createClient(profile(), { fetchImpl }).complete(imageMessages), "EOTS_LLM_VISION_UNSUPPORTED")
    assert.equal(called, false)
    await createClient({ ...profile(), vision: true }, { fetchImpl }).complete(imageMessages)
    assert.equal(called, true)
})

test("transport reports status only, never HTTP body or raw network exception", async () => {
    for (const status of [201, 302, 401, 429, 500]) await expectCode(createClient(profile(), { fetchImpl: async () => new Response(secret, { status }) }).complete(messages), "EOTS_LLM_HTTP_ERROR", status)
    await expectCode(createClient(profile(), { fetchImpl: async () => { throw new Error(secret) } }).complete(messages), "EOTS_LLM_NETWORK_ERROR")
})

test("provider business errors sanitize numeric and textual codes", async () => {
    for (const data of [{ code: 1001, message: secret }, { base_resp: { status_code: 2013, status_msg: secret } }, { error: { code: secret, message: secret } }]) {
        await expectCode(createClient(profile(), { fetchImpl: async () => new Response(JSON.stringify(data)) }).complete(messages), "EOTS_LLM_PROVIDER_ERROR", 200)
    }
    const response = { code: 0, choices: [{ message: { content: "{}" } }] }
    assert.equal((await createClient(profile(), { fetchImpl: async () => new Response(JSON.stringify(response)) }).complete(messages)).content, "{}")
})

test("malformed, empty, truncated and oversized responses fail explicitly", async () => {
    for (const data of ["bad-json", "null", "{}", JSON.stringify({ choices: [{ message: { content: "" } }] })]) await expectCode(createClient(profile(), { fetchImpl: async () => new Response(data) }).complete(messages), "EOTS_LLM_INVALID_RESPONSE")
    await expectCode(createClient(profile(), { fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "partial" }, finish_reason: "length" }] })) }).complete(messages), "EOTS_LLM_TRUNCATED_RESPONSE")
    await expectCode(createClient(profile(), { fetchImpl: async () => new Response("x", { headers: { "content-length": "1048577" } }) }).complete(messages), "EOTS_LLM_RESPONSE_TOO_LARGE")
    await expectCode(createClient(profile(), { fetchImpl: async () => new Response("x".repeat(1048577)) }).complete(messages), "EOTS_LLM_RESPONSE_TOO_LARGE")
})

test("timeout includes fetch and streaming body, including mocks ignoring abort", async () => {
    await expectCode(createClient({ ...profile(), timeoutMs: 15 }, { fetchImpl: () => new Promise(() => {}) }).complete(messages), "EOTS_LLM_TIMEOUT")
    const stream = new ReadableStream({ start() {} })
    await expectCode(createClient({ ...profile(), timeoutMs: 15 }, { fetchImpl: async () => new Response(stream) }).complete(messages), "EOTS_LLM_TIMEOUT")
})

test("untrusted stream errors cannot impersonate safe adapter errors", async () => {
    const stream = new ReadableStream({ start(controller) { const error = new Error(secret); error.code = "EOTS_LLM_FAKE"; controller.error(error) } })
    await expectCode(createClient(profile(), { fetchImpl: async () => new Response(stream) }).complete(messages), "EOTS_LLM_INVALID_RESPONSE")
})

test("paid truncated/empty responses preserve safe usage for harness accounting", async () => {
    for (const [content, finish_reason, code] of [["partial", "length", "EOTS_LLM_TRUNCATED_RESPONSE"], ["", "stop", "EOTS_LLM_INVALID_RESPONSE"]]) {
        const response = { model: "paid-model", choices: [{ message: { content }, finish_reason }], usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } }
        await assert.rejects(createClient(profile(), { fetchImpl: async () => new Response(JSON.stringify(response)) }).complete(messages), e => {
            assert.equal(e.code, code); assert.equal(e.model, "paid-model"); assert.equal(e.usage.total_tokens, 60); assert(e.latencyMs >= 0); return true
        })
    }
})
