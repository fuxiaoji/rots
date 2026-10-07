"use strict"
// LLM-SEMI-01: 半自动 LLM 模式。战役状态机(erasmus-v2-opt-v5)执行全部合法动作；
// 模型只在该方每个选牌窗("Select card to play.")回答一次：
//   1) strategy —— 当前阶段战略目录中的命名战略(逐字)；
//   2) targets  —— 该战略目标地点的优先顺序(印刷mapId，可为目录默认链的子集/重排)。
// 会话层把经验证的 {name, chain} 经 context.strategyOverride 传入 esm_pin_strategy；
// 选牌/HQ/编成/移动/会战/反应/PBM 全部仍由状态机决定。模型不读敌方私有信息。
const fs = require("node:fs"), path = require("node:path")
const { hash, observe, clone, ROLES } = require("./observation")
const ROOT = path.resolve(__dirname, "../../..")
const VERSION = "eots-llm-semi-v1.0"
const MAX_TARGETS = 16
const GUIDES = ["docs/rules/llm-operational-guide.md", "docs/rules/llm-campaign-guide.md"]

function fail(code, message) { const e = new Error(message); e.code = code; return e }

// 与 erasmus_state.js 的 esm_is_card_window 保持同一判定：会话层据此在状态机
// 钉选战略之前插入一次模型决策。两边逻辑必须同步修改。
function isStrategyWindow(view) {
    const a = (view && view.actions) || {}
    return typeof a.card !== "undefined" && /select card to play/i.test(String(view.prompt || ""))
}

function rulesSources() {
    return GUIDES.map(file => {
        const text = fs.readFileSync(path.join(ROOT, file), "utf8")
        return { file, sha256: hash(text), basis: "reviewed-paraphrase-and-interface-guide", text }
    })
}

const KIND_MEANING = {
    CONQUEST: "打攻势卡OC：按链激活部队进攻；敌控格目标需地面占领，压制目标以AZOI覆盖即完成",
    EVENT: "打事件卡EC：按该战略事件清单顺序用牌；链仍给执行层提供焦点",
    ABSTRACT: "抽象战略：打攻势卡OC，按链与注释执行",
    GARRISON: "打攻势卡OC：把部队驻守到链上己方地点",
    DEFEND: "打攻势卡OC：组织防御/反击",
    PASS: "跳过这张牌（不消耗手牌）",
}

function leanUnits(o) {
    const columns = ["id", "name", "faction", "class", "type", "service", "cf", "rcf", "lf", "br", "ebr", "asp", "reduced", "locationMapId", "locationName", "supplied"]
    const role = side => ROLES[side] || null
    const rows = o.units.map(u => columns.map(k => k === "faction" ? role(u.faction) : u[k] ?? null))
    return { columns, rows, note: "双方全部公开在场单位；cf/rcf=整编/减编地面战力，lf=承受伤害；br/ebr=航空战斗航程/括号航程；asp=该单位作为地面两栖的ASP运输成本；supplied仅己方。" }
}

function leanWorld(o) {
    const unitLocs = new Set(o.units.map(u => u.location))
    const columns = ["mapId", "name", "region", "control", "port", "airfield", "resource", "terrain"]
    const rows = o.hexes.filter(h => h.named || unitLocs.has(h.hex))
        .map(h => [h.id, h.name, h.region || null, h.control, +h.port, +h.airfield, +h.resource, h.terrain])
    return { columns, rows, note: "全部命名地点与有单位驻扎的格；control为当前控制方，null=不可控或中立。mapId是印刷编号，也是targets应使用的标识。" }
}

function leanNations(o) {
    const byHex = new Map(o.hexes.map(h => [h.hex, h]))
    return (o.scenario?.nations || []).map(n => ({
        key: n.key, name: n.name, surrenderedTurn: n.surrenderedTurn, status: n.status,
        keys: n.keys.map(k => { const h = byHex.get(k.hex); return { mapId: k.mapId, name: k.name || h?.name || String(k.mapId), control: k.control,
            resource: !!h?.resource, port: !!h?.port } }),
        remainingKeys: n.remainingKeys.map(hex => byHex.get(hex)?.id || String(hex)),
        note: "全部keys被日本控制且在国家状态段结算后才正式投降；remainingKeys=仍由盟军控制的等待格。" }))
}

function leanPreviews(o) {
    const eligible = [], unavailable = []
    for (const p of o.cardPreviews || []) {
        if (p.eligible) eligible.push({ cardId: p.cardId, mode: p.cardMode, hqId: p.hqId, budget: p.activationBudget ?? null, unitCount: (p.units || []).length })
        else unavailable.push({ cardId: p.cardId, mode: p.cardMode, hqId: p.hqId, reason: p.reason || null })
    }
    return { eligible, unavailableCount: unavailable.length,
        note: "eligible行=本方可合法启动的牌×模式×HQ组合及其激活预算；预算≈牌面OV/LV+HQ效能CM。" }
}

function buildPacket(rules, state, role, { profile, strategyLog = [] } = {}) {
    if (!ROLES.includes(role)) throw fail("ROLE", "半自动观察阵营无效")
    const { observation: o } = observe(rules, state, role, 0)
    const catalog = rules.query(clone(state), role, "llm_semi_catalog")
    if (!catalog || !Array.isArray(catalog.strategies) || !catalog.strategies.length) throw fail("NO_CATALOG", "战略目录不可用")
    const mapIndex = new Map(o.hexes.map(h => [String(h.id), h.hex]))
    const byHex = new Map(o.hexes.map(h => [h.hex, h]))
    const payload = {
        interface: { version: VERSION, kind: "eots-semi-strategy", role, executor: "erasmus campaign state machine (program); the model only names the strategy and orders its targets" },
        turn: o.turn, active: o.active, windowState: o.state, scenario: { name: o.scenario?.name || null, lastTurn: o.scenario?.lastTurn ?? null,
            victoryMode: o.scenario?.victoryMode || null, victory: o.scenario?.victory || null },
        politicalWill: o.politicalWill, progressOfWar: o.progressOfWar,
        resources: o.resources, aspTracks: o.asp, passes: o.passes, handCounts: o.handCounts,
        ownFutureOffensive: o.ownFutureOffensive,
        nations: leanNations(o),
        ownCards: (o.ownCards || []).map(c => ({ id: c.id, name: c.name, ops: c.ops, logistic: c.logistic, hq: c.hq, reaction: c.reaction,
            allowed: c.allowed || null, previewEvent: typeof c.previewEvent === "string" ? c.previewEvent.slice(0, 220) : c.previewEvent ?? null,
            intelligence: c.metadata ? { oc: c.metadata.oc ?? null, ec: c.metadata.ec ?? null } : null })),
        cardPreviews: leanPreviews(o),
        units: leanUnits(o),
        world: leanWorld(o),
        strategyCatalog: { phase: catalog.phase, strategies: catalog.strategies.map(s => ({ name: s.name, kind: s.kind,
            kindMeaning: KIND_MEANING[s.kind] || s.kind, targets: s.targets, notes: s.notes,
            defaultChain: (s.defaultChain || []).map(t => ({ mapId: t.mapId, name: t.name, control: t.control, kind: t.kind,
                requiresOccupation: t.requiresOccupation, resource: t.resource, port: t.port, airfield: t.airfield })) })),
            basis: catalog.basis },
        keyDefenders: (o.taskFacts?.defenders || []).map(d => ({ mapId: byHex.get(d.hex)?.id || String(d.hex), name: byHex.get(d.hex)?.name || null,
            ground: d.ground ? { lfs: d.ground.lfs, units: (d.ground.units || []).map(u => ({ name: u.name, class: u.class, service: u.service, cf: u.cf, reduced: u.reduced })) } : null })),
        programHistory: { readonly: true, ownRecentDecisions: strategyLog.slice(-10).map(x => ({ turn: x.turn, strategy: x.strategy,
            chain: (x.chain || []).slice(0, 8), source: x.source, reason: x.reason })), logTail: o.log },
        taskFactsLimits: o.taskFacts?.limits || null,
    }
    return { role, turn: o.turn, phase: catalog.phase, payload, mapIndex, catalog, observationHash: hash(payload) }
}

function messagesFor(packet, repair) {
    const roleCn = packet.role === "Japan" ? "日本" : "盟军"
    const sources = rulesSources()
    const system = `你是《太阳帝国》的${roleCn}方战略主脑（半自动模式）。程序状态机负责执行全部合法动作；你只在该方每张牌的选牌窗回答一次：选择战略 + 排列该战略的目标地点顺序。

## 半自动模式语义
- strategy：从 payload.strategyCatalog.strategies 中逐字选择一个 name。目录只含当前阶段(${packet.phase})可用战略。
- targets：目标地点优先顺序，元素是印刷mapId字符串（world.columns/world.rows 与 catalog.defaultChain 中的 mapId）。第一位最优先。允许是 defaultChain 的子集或重排，也可以包含其他在场格；至多${MAX_TARGETS}项、去重。返回空数组=完全沿用该战略图表默认链。
- 执行语义：目标链按你给的顺序执行，首位未完成目标获得最高执行优先级，完成后再轮到下一个。
  · 敌控格=夺占(CONQUEST)：必须有地面单位合法进入并占领；海空打击单独不能取得控制；两栖登陆需同港海军护航与ASP运输预算，且敌方可反应拦截。
  · 压制(SUPPRESS/SUPPRESS_HQ)：航空/航母AZOI覆盖该格即完成，无需占领。
  · 驻守(GARRISON)：己控格放地面单位驻守防夺回。
  · 全链完成后，剩余激活量按状态机规则继续使用（向后续目标或前推）。

## 游戏机制要点（依据规则简述与接口指南，非新裁定）
- 回合流程：每游戏回合攻守双方交替轮换打完各自手牌；你方每张牌前你会被询问一次。OC(攻势卡)以牌面ops(OV)+所选HQ效能CM为激活预算，在一个HQ启动范围内激活部队，OC只宣告1个战斗格；EC(军事事件)以LV为预算，事件允许的战斗格数与限制按牌文；情报牌/反应牌由程序按规则处理。
- 移动与堆叠：激活后按地面/海军/航空方式移动；两栖登陆需同港编组（地面+护航）；每格每方地面+航空≤3、HQ≤1、海军≤6。单位表含整编/减编战力(rcf)、承受伤害(lf)、航空战斗航程(br/ebr)、两栖ASP成本(asp)。
- 地面战斗：攻方地面CF×战果倍率（修正后D10≤2=0.5x、3–6=1x、7–8=1.5x、9+=2x，向上取整）产生打击值，达到单位LF才造成一步损失。进攻地形DRM：丛林−1、混合−2、山地−3；已有敌方地面/HQ的登陆格守方+3。双方都还有地面幸存者时损失多步一方败，平手守方胜；攻方必须有幸存地面才能夺占。海空战失败则登陆地面不能参加该格地面战。
- 补给与ZOI：断补给单位战力减半且可能被歼；航空/航母投射ZOI，压制目标=消除敌方ZOI覆盖。
- 政治意志(PW)与战区征服(PoW)：PW归0日本立即胜；盟军每回合需新夺并保持≥pow个名城格，不达标PW受损。payload.progressOfWar是当前要求与保持数。
- 国家投降：只有全部要求格被日本控制并在国家状态段结算才正式投降（菲律宾2813/2915，马来亚2014/2015，荷属东印度8格，缅甸2008/2106/2206/2305）。payload.nations.remainingKeys是各国仍缺的格。
- 日本控制资源格数量与回合数决定1943+盟军原子弹/封锁/本土胜利线进度（payload.scenario.victory）。
- 规则摘录（${sources.map(s => path.basename(s.file)).join("、")}，sha256已记录）解释游戏；如资料与程序行为冲突，以程序当前合法执行为准并在reason中指出。

## 决策指导
- payload 是本次全部事实：程序记录(programHistory)只读参考，其中旧决策不高于当前局面。
- 先看：当前回合与阶段、各国remainingKeys、PW/PoW压力、本方手牌与cardPreviews预算、能打到哪些目标（keyDefenders给出守军）。
- 把本张牌最可能实际完成的目标放链首：考虑该目标守军、两栖可达性（ASP/护航）、是否已有部队在前沿。链首长期不可达会浪费整张牌。
- 投降目标要成组推进：一个国家只差最后1-2格时优先补齐；不要同时开太多轴。
- 防守需求（盟军已逼近的己方资源格/本土）可在链中加驻守格。
- PASS只在目录提供且你判断本牌不值得消耗时使用。

## 输出合同（仅输出一个JSON对象，不输出思维链）
{"strategy":"<目录name逐字>","targets":["<mapId>",...],"reason":"一句话中文摘要：为何选此战略与此顺序"}
示例中的占位不是可用值；不要照抄。targets里出现未知mapId会被丢弃并按剩余顺序执行。`

    const text = JSON.stringify(packet.payload) + (repair ? "\n上次输出无效：" + repair + "。请只按输出合同重新回答。" : "")
    return { messages: [{ role: "system", content: system }, { role: "user", content: text }],
        sources: sources.map(({ file, sha256, basis }) => ({ file, sha256, basis })),
        promptHash: hash([system, text]), version: VERSION }
}

function parseAnswer(content, packet) {
    if (typeof content !== "string" || content.length > 8000) throw fail("FORMAT", "响应为空或过长")
    let text = content.trim().replace(/<think>[\s\S]*?<\/think>/g, "").trim()
    if (/^```(?:json)?\s/.test(text)) text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")
    let answer; try { answer = JSON.parse(text) } catch { throw fail("FORMAT", "响应必须是单个JSON对象") }
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) throw fail("FORMAT", "响应必须是JSON对象")
    const name = typeof answer.strategy === "string" ? answer.strategy.trim() : ""
    if (!packet.catalog.strategies.some(s => s.name === name)) throw fail("FORMAT", "strategy不在当前阶段战略目录")
    const raw = answer.targets === undefined ? [] : answer.targets
    if (!Array.isArray(raw) || raw.length > MAX_TARGETS * 2) throw fail("FORMAT", "targets必须是数组且长度受限")
    const knownHexes = new Set(packet.mapIndex.values())
    const chain = [], dropped = []
    for (const item of raw) {
        let hex = null
        if (typeof item === "string") hex = packet.mapIndex.get(item.trim()) ?? null
        else if (Number.isSafeInteger(item) && knownHexes.has(item)) hex = item
        if (!Number.isInteger(hex)) { dropped.push(String(item).slice(0, 16)); continue }
        if (!chain.includes(hex)) chain.push(hex)
        if (chain.length >= MAX_TARGETS) break
    }
    return { name, chain, dropped: dropped.slice(0, 6),
        reason: typeof answer.reason === "string" ? answer.reason.slice(0, 300) : "" }
}

function account(stats, result, elapsedMs) {
    stats.latencyMs += result.latencyMs || elapsedMs
    const usage = result.usage || {}, total = Number(usage.total_tokens ?? ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0))) || 0
    stats.totalTokens += total; stats.promptTokens += Number(usage.prompt_tokens) || 0; stats.completionTokens += Number(usage.completion_tokens) || 0
    if (!Number.isSafeInteger(usage.total_tokens) && !(Number.isSafeInteger(usage.prompt_tokens) && Number.isSafeInteger(usage.completion_tokens))) stats.usageUnknown++
}

// 与 harness.decide 不同的合同：模型只产出战略与链；格式错误重试一次，
// 仍无效则该牌回退程序默认战略（计数并记录，不中止对局）；接口/预算失败照常抛出暂停。
async function decide(packet, { client, profile, stats, limits, decisionId, ledger = [] }) {
    if (stats.requests >= limits.maxRequests || stats.totalTokens >= limits.maxTotalTokens)
        throw fail("BUDGET", "本局模型请求或token预算已耗尽；对局暂停")
    let repair = null
    for (let attempt = 0; attempt < 2; attempt++) {
        if (stats.requests >= limits.maxRequests || stats.totalTokens >= limits.maxTotalTokens)
            throw fail("BUDGET", repair ? "预算不足以修复上次格式错误；对局暂停" : "本局模型请求或token预算已耗尽；对局暂停")
        const p = messagesFor(packet, repair)
        stats.requests++; if (attempt) stats.retries++
        const record = { ordinal: stats.requests, role: packet.role, decisionId, kind: "semi-strategy", attempt,
            requestedModel: profile.model, provider: profile.provider, promptVersion: p.version, promptHash: p.promptHash,
            sources: p.sources.map(({ file, sha256 }) => ({ file, sha256 })), observationHash: packet.observationHash }
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
        Object.assign(record, { model: result.model || profile.model, usage: result.usage || null, latencyMs: result.latencyMs, outputHash: hash(result.content) })
        if (stats.totalTokens > limits.maxTotalTokens) { record.code = "BUDGET"; throw fail("BUDGET", "响应已计费，但超过本局token预算；动作未执行") }
        try {
            const parsed = parseAnswer(result.content, packet)
            record.code = "OK"
            const override = { name: parsed.name, chain: parsed.chain, via: "llm-semi", profile: profile.id, model: profile.model,
                decisionId, reason: parsed.reason }
            return { override, name: parsed.name, chain: parsed.chain, dropped: parsed.dropped, reason: parsed.reason, phase: packet.phase,
                requests: attempt + 1, invalid: false,
                trace: { policy: "llm-semi", provider: profile.provider, model: result.model || profile.model, promptVersion: p.version,
                    promptHash: p.promptHash, outputHash: hash(result.content), observationHash: packet.observationHash,
                    sources: p.sources, usage: result.usage || null, requests: attempt + 1, latencyMs: result.latencyMs,
                    strategy: parsed.name, chain: parsed.chain, dropped: parsed.dropped, chainBound: true } }
        } catch (e) { record.code = e.code || "FORMAT"; stats.invalidResponses++; repair = e.message; if (attempt) {
            return { override: null, name: null, chain: [], reason: "LLM两次输出均无效(" + e.message + ")；本牌沿用程序默认战略", phase: packet.phase,
                requests: attempt + 1, invalid: true,
                trace: { policy: "llm-semi", provider: profile.provider, model: profile.model, promptVersion: p.version,
                    promptHash: p.promptHash, observationHash: packet.observationHash, requests: attempt + 1, strategy: null, invalid: true } }
        } }
    }
}

module.exports = { VERSION, isStrategyWindow, buildPacket, messagesFor, parseAnswer, decide }
