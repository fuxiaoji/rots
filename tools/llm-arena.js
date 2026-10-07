#!/usr/bin/env node
"use strict"
// LLM-ARENA-01: local, paused, creator-authenticated arena. No RTT installation needed.
const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const LOCAL_ERROR = Symbol("arena-error")
const ROLES = ["Japan", "Allies"]
const SNAPSHOT_FIELDS = ["revision", "role", "active", "turn", "prompt", "observation", "candidates", "boardSvg", "log", "lastDecision", "stats", "status", "result", "error"]
const SAFE_ERRORS = {
    CONFIG: [400, "所选玩家不支持此剧本，或模型 / 预算配置无效。"], VIEW_ROLE: [403, "本局视角已经固定。"],
    BUSY: [409, "本局已有请求正在执行。"], STALE: [409, "棋局已更新，请刷新后重试。"],
    COMPLETE: [409, "对局已经结束。"], ACTION_LIMIT: [409, "动作预算已用尽。"],
    ROLE: [400, "此阵营当前不能行动。"], ILLEGAL: [400, "候选动作已失效或不合法。"],
    FORMAT: [502, "模型未返回合法候选；对局已暂停。"], BUDGET: [409, "模型请求或 token 预算已耗尽；对局已暂停。"],
    NO_CANDIDATES: [409, "当前窗口没有可执行候选，请检查规则接口。"], NO_PROGRESS: [409, "对局反复回到相同状态，已暂停供调试。"], ENGINE: [500, "规则引擎未完成动作；棋局保持不变。"],
    PROVIDER: [502, "模型接口请求失败；对局已暂停。"], COMMITTED_VIEW_ERROR: [500, "动作已执行，但视图显示失败；请刷新核对局面。"], RULES_CHANGED: [409, "规则文件变化或归档规则不可用；请重启服务核对版本。"], POLICY_CHANGED: [409, "接口策略版本变化；请用CLI明确迁移存档后恢复。"],
    EOTS_LLM_NOT_CONFIGURED: [400, "尚未配置此模型。"], EOTS_LLM_TIMEOUT: [504, "模型请求超时；对局已暂停。"],
    EOTS_LLM_NETWORK_ERROR: [502, "无法连接模型服务；对局已暂停。"],
    EOTS_LLM_HTTP_ERROR: [502, "模型服务返回 HTTP 错误，请检查凭据及额度。"],
    EOTS_LLM_PROVIDER_ERROR: [502, "模型服务拒绝了请求，请检查配置及额度。"],
    EOTS_LLM_INVALID_RESPONSE: [502, "模型服务返回格式无效。"], EOTS_LLM_TRUNCATED_RESPONSE: [502, "模型响应被截断，请检查输出预算。"],
    EOTS_LLM_RESPONSE_TOO_LARGE: [502, "模型响应超过安全大小限制。"],
    EOTS_LLM_CONFIG_BOOLEAN: [400, "模型布尔配置无效。"], EOTS_LLM_CONFIG_INTEGER: [400, "模型整数配置无效。"],
    EOTS_LLM_CONFIG_EXTRA_BODY: [400, "模型附加参数配置无效。"], EOTS_LLM_JSON_UNSUPPORTED: [400, "所选模型不支持当前 JSON 配置。"],
    EOTS_LLM_UNKNOWN_PROFILE: [400, "未知模型配置。"], EOTS_LLM_CONFIG_URL: [400, "模型端点配置无效。"],
    EOTS_LLM_INVALID_MESSAGES: [400, "模型请求消息无效。"], EOTS_LLM_VISION_UNSUPPORTED: [400, "此模型未启用视觉能力。"],
    INVALID_OPTIONS: [400, "对局参数无效。"], INVALID_ROLE: [400, "阵营无效。"],
    INVALID_CANDIDATE: [400, "候选动作已失效或不合法。"], ILLEGAL_ACTION: [400, "动作不合法。"],
    STALE_REVISION: [409, "棋局已更新，请刷新后重试。"], REVISION_MISMATCH: [409, "棋局已更新，请刷新后重试。"],
    GAME_BUSY: [409, "本局正在执行动作，请稍后重试。"], GAME_OVER: [409, "对局已经结束。"],
    BUDGET_EXCEEDED: [409, "本局预算已用尽。"], REQUEST_BUDGET_EXCEEDED: [409, "模型请求预算已用尽。"],
    ACTION_BUDGET_EXCEEDED: [409, "动作预算已用尽。"], PROVIDER_NOT_CONFIGURED: [400, "尚未配置此模型的凭据。"],
    PROVIDER_ERROR: [502, "模型请求失败；请检查服务端配置或稍后重试。"],
    LLM_INVALID_RESPONSE: [502, "模型没有返回合法候选，请重试或查看回放。"]
}
function safeError(code) { return typeof code === "string" && Object.hasOwn(SAFE_ERRORS, code) ? SAFE_ERRORS[code] : undefined }
function fail(code, message, status = 400) { return Object.assign(new Error(message), { code, status, [LOCAL_ERROR]: true }) }
function json(res, status, data) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" })
    res.end(JSON.stringify(data))
}
function body(req, limit) {
    return new Promise((resolve, reject) => {
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) {
            req.resume(); reject(fail("JSON_REQUIRED", "请求必须使用 JSON。", 415)); return
        }
        let bytes = 0, chunks = [], exceeded = false
        req.on("data", chunk => {
            bytes += chunk.length
            if (bytes > limit) { exceeded = true; chunks = []; reject(fail("BODY_TOO_LARGE", "请求内容过大。", 413)) }
            else if (!exceeded) chunks.push(chunk)
        })
        req.on("end", () => {
            if (exceeded) return
            try {
                const value = JSON.parse(Buffer.concat(chunks).toString("utf8"))
                if (!value || typeof value !== "object" || Array.isArray(value)) throw Error()
                resolve(value)
            } catch { reject(fail("INVALID_JSON", "JSON 格式无效。")) }
        })
        req.on("error", () => reject(fail("REQUEST_ERROR", "请求未完整接收。")))
    })
}
function integer(value, fallback, min, max, field) {
    value = value === undefined ? fallback : value
    if (!Number.isSafeInteger(value) || value < min || value > max) throw fail("INVALID_OPTIONS", `${field}必须是 ${min}–${max} 的整数。`)
    return value
}
function hash(token) { return crypto.createHash("sha256").update(token).digest() }
function createArenaServer(options = {}) {
    const root = options.root || path.resolve(__dirname, "..")
    const api = options.sessionApi || require(path.join(root, "js/server/llm/session.js"))
    const providers = options.providers || require(path.join(root, "js/server/llm/providers.js"))
    const rules = options.rules || require(path.join(root, "rules.js"))
    const env = options.env || process.env
    const html = fs.readFileSync(options.htmlPath || path.join(root, "llm-arena.html"), "utf8")
    const sessions = new Map()
    const saveDir = options.persistenceDir
    if (saveDir) fs.mkdirSync(saveDir, { recursive: true, mode: 0o700 })
    function persist(id, entry) {
        if (!saveDir) return
        const data = { id, viewRole: entry.viewRole, players: entry.players, tokenHash: entry.tokenHash.toString("hex"), save: api.serializeSession(entry.session) }
        const target = path.join(saveDir, id + ".json"), temp = target + ".tmp"
        try { fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 }); fs.renameSync(temp, target) }
        catch { throw fail("SAVE_ERROR", "动作可能已执行，但私有存档写入失败；请刷新核对局面。", 500) }
    }
    const maxSessions = integer(options.maxSessions, 32, 1, 1000, "会话容量")
    const bodyLimit = integer(options.bodyLimit, 16384, 256, 1048576, "请求上限")
    let creating = 0
    if (saveDir) for (const file of fs.readdirSync(saveDir).filter(f => /^[a-f0-9]{32}\.json$/.test(f)).slice(0, maxSessions)) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(saveDir, file), "utf8"))
            if (!/^[a-f0-9]{64}$/.test(data.tokenHash)) continue
            const session = api.restoreSession(data.save)
            sessions.set(data.id, { session, viewRole: data.viewRole, players: session.options.players,
                tokenHash: Buffer.from(data.tokenHash, "hex"), pending: false })
        } catch { console.error("LLM arena: a private save could not be restored; file retained") }
    }
    function config() {
        const profiles = providers.listProfiles(env).map(p => ({ id: String(p.id), provider: String(p.provider), model: String(p.model), vision: p.vision === true, configured: p.configured === true }))
        return { scenarios: rules.scenarios.slice(), bots: Object.keys(rules.bots || {}), profiles,
            defaults: { maxRequests: 40, maxActions: 2000 }, limits: { maxRequests: 1000, maxActions: 20000, maxSessions, fastForward: 20 } }
    }
    function view(entry) {
        const source = api.snapshot(entry.session, entry.viewRole)
        const result = {}
        for (const field of SNAPSHOT_FIELDS) if (source[field] !== undefined) result[field] = source[field]
        if (result.error) {
            const known = safeError(result.error.code)
            result.error = { code: known ? result.error.code : "INTERNAL_ERROR", message: known ? known[1] : "上次动作未完成；请检查配置或重试。" }
        }
        return result
    }
    function authorize(req, entry) {
        const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || "")
        if (!match || !crypto.timingSafeEqual(hash(match[1]), entry.tokenHash)) throw fail("UNAUTHORIZED", "需要此对局的创建者令牌。", 401)
    }
    const server = http.createServer(async (req, res) => {
        try {
            const hostname = req.headers.host || ""
            const expectedPort = String(req.socket.localPort)
            const host = new URL(`http://${hostname}`)
            if (!["127.0.0.1", "localhost", "[::1]"].includes(host.hostname) || (host.port || "80") !== expectedPort)
                throw fail("FOREIGN_HOST", "仅允许本机访问。", 403)
            const url = new URL(req.url, host.origin)
            if (["POST", "DELETE"].includes(req.method) && req.headers.origin && req.headers.origin !== host.origin)
                throw fail("FOREIGN_ORIGIN", "拒绝来自其它页面的修改请求。", 403)
            if (req.method === "GET" && ["/", "/llm-arena.html"].includes(url.pathname)) {
                const nonce = crypto.randomBytes(18).toString("base64")
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`, "Referrer-Policy": "no-referrer" })
                res.end(html.replaceAll("__ARENA_NONCE__", nonce)); return
            }
            if (req.method === "GET" && url.pathname === "/api/config") { json(res, 200, config()); return }
            if (req.method === "POST" && url.pathname === "/api/games") {
                const input = await body(req, bodyLimit), cfg = config()
                if (sessions.size + creating >= maxSessions) throw fail("SESSION_LIMIT", "本机对局容量已满，请释放旧对局或重启服务。", 503)
                const players = input.players
                if (!players || typeof players !== "object" || Array.isArray(players)) throw fail("INVALID_OPTIONS", "请选择双方玩家。")
                const allowed = new Set(["human", ...cfg.bots, ...cfg.profiles.filter(p => p.configured).map(p => `llm:${p.id}`)])
                for (const role of ROLES) if (!allowed.has(players[role])) throw fail("INVALID_OPTIONS", "玩家类型无效或模型尚未配置。")
                const humans = ROLES.filter(role => players[role] === "human")
                if (humans.length > 1) throw fail("INVALID_OPTIONS", "此页面每局只支持一位人类玩家。")
                if (!cfg.scenarios.includes(input.scenario)) throw fail("INVALID_OPTIONS", "剧本无效。")
                const gameOptions = { seed: integer(input.seed, 1, 1, 0x7fffffff, "种子"), scenario: input.scenario,
                    players: { Japan: players.Japan, Allies: players.Allies },
                    maxRequests: integer(input.maxRequests, 40, 1, 1000, "请求预算"), maxActions: integer(input.maxActions, 2000, 1, 20000, "动作预算") }
                ++creating
                try {
                    const session = await api.createSession(gameOptions)
                    const id = crypto.randomBytes(16).toString("hex"), token = crypto.randomBytes(32).toString("base64url")
                    const entry = { session, viewRole: humans[0] || "Observer", players: gameOptions.players, tokenHash: hash(token), pending: false }
                    const snapshot = view(entry)
                    sessions.set(id, entry)
                    try { persist(id, entry) } catch (e) { sessions.delete(id); throw e }
                    json(res, 201, { id, sessionToken: token, viewRole: entry.viewRole, options: gameOptions, snapshot })
                } finally { --creating }
                return
            }
            const match = /^\/api\/games\/([a-f0-9]{32})(?:\/(step|replay))?$/.exec(url.pathname)
            if (!match) throw fail("NOT_FOUND", "页面或接口不存在。", 404)
            const entry = sessions.get(match[1])
            if (!entry) throw fail("NOT_FOUND", "对局不存在或服务已重启。", 404)
            authorize(req, entry)
            if (url.searchParams.has("role") && url.searchParams.get("role") !== entry.viewRole) throw fail("INVALID_ROLE", "本局视角已经固定。", 403)
            if (entry.pending) throw fail("GAME_BUSY", "本局正在执行动作，请稍后重试。", 409)
            if (req.method === "GET" && !match[2]) { json(res, 200, view(entry)); return }
            if (req.method === "GET" && match[2] === "replay") {
                if (entry.session.status !== "complete") throw fail("REPLAY_NOT_READY", "完整回放仅在终局后提供；进行中的选牌与随机种子仍属私有信息。", 409)
                json(res, 200, await api.replay(entry.session)); return
            }
            if (req.method === "DELETE" && !match[2]) { sessions.delete(match[1]); if (saveDir) fs.rmSync(path.join(saveDir, match[1] + ".json"), { force: true }); json(res, 200, { deleted: true }); return }
            if (req.method === "POST" && match[2] === "step") {
                // Reserve before reading request data: two simultaneous clients cannot pass this gate.
                entry.pending = true
                try {
                    const input = await body(req, bodyLimit)
                    if (!Number.isSafeInteger(input.revision)) throw fail("INVALID_OPTIONS", "每次动作必须携带整数版本号。")
                    if (input.revision !== entry.session.revision) throw fail("STALE_REVISION", "棋局已更新，请刷新后重试。", 409)
                    const current = api.snapshot(entry.session, entry.viewRole)
                    const active = Array.isArray(current.active) ? current.active : [current.active]
                    const role = input.role || active.find(r => ROLES.includes(r))
                    if (!ROLES.includes(role) || !active.includes(role)) throw fail("INVALID_ROLE", "此阵营当前不能行动。")
                    const stepOptions = { role, revision: input.revision }
                    if (entry.players[role] === "human") {
                        if (role !== entry.viewRole || typeof input.candidateId !== "string") throw fail("INVALID_CANDIDATE", "请选择当前合法候选。")
                        stepOptions.candidateId = input.candidateId
                    } else if (input.candidateId !== undefined) throw fail("INVALID_CANDIDATE", "机器人动作由服务端选择。")
                    await api.step(entry.session, stepOptions)
                    persist(match[1], entry)
                    json(res, 200, view(entry))
                } catch (e) { if (e.code !== "SAVE_ERROR") persist(match[1], entry); throw e }
                finally { entry.pending = false }
                return
            }
            throw fail("METHOD_NOT_ALLOWED", "此接口不支持该方法。", 405)
        } catch (error) {
            if (res.headersSent || res.destroyed) return
            // Never return engine/provider exception messages: they may contain credentials or private state.
            const known = safeError(error.code)
            const local = error[LOCAL_ERROR] === true
            const code = known ? error.code : local ? error.code : "INTERNAL_ERROR"
            const status = local ? error.status : known ? known[0] : 500
            json(res, status, { error: { code, message: local ? error.message : known ? known[1] : "服务暂时无法完成操作。" } })
        }
    })
    server.requestTimeout = 30000
    server.headersTimeout = 10000
    return server
}
async function main() {
    const root = path.resolve(__dirname, "..")
    const providers = require(path.join(root, "js/server/llm/providers.js"))
    try { providers.loadEnv(process.env.EOTS_LLM_ENV_FILE || path.join(root, ".env.llm.local")) }
    catch (error) { if (error.code !== "ENOENT") throw error }
    const host = process.env.EOTS_LLM_HOST || "127.0.0.1"
    if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw Error("EOTS_LLM_HOST must be a loopback address")
    const port = integer(process.env.EOTS_LLM_PORT === undefined ? undefined : Number(process.env.EOTS_LLM_PORT), 8090, 1, 65535, "端口")
    const server = createArenaServer({ root, providers, persistenceDir: path.join(root, "llm-private/arena") })
    server.on("error", () => { process.stderr.write("无法启动本地对战服务，请检查端口及配置。\n"); process.exitCode = 1 })
    server.listen(port, host, () => process.stdout.write(`本地对战页：http://${host === "::1" ? "[::1]" : host}:${port}/\n`))
}
if (require.main === module) main().catch(() => { process.stderr.write("本地对战配置无效或组件未构建。\n"); process.exitCode = 1 })
module.exports = { createArenaServer }
