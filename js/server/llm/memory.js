"use strict"
// Model-authored plans and program-authored execution history have separate owners.
const copy = value => JSON.parse(JSON.stringify(value))
function bad(message) { const e = new Error(message); e.code = "FORMAT"; throw e }
function text(value, limit = 240) { if (typeof value !== "string") bad("计划文本字段必须是字符串"); return value.slice(0, limit) }
function strings(value, max) { if (!Array.isArray(value) || value.length > max) bad("计划列表超出上限"); return value.map(v => text(v)) }
function object(value, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) bad("计划字段未知或结构错误")
}
function mergeMemory(patch, previous, o) {
    const prior = previous || {}, result = { schemaVersion: 2, objective: prior.objective || "", notes: copy(prior.notes || []),
        campaign: copy(prior.campaign || null), turnPlan: copy(prior.turnPlan || null), offensive: copy(prior.offensive || null), recent: copy(prior.recent || []).slice(-12) }
    if (patch === undefined) return result
    object(patch, ["objective", "notes", "campaign", "turnPlan", "offensive"])
    const hexes = new Set((o.hexes || []).map(h => h.hex)), own = new Map([...(o.ownUnitDefinitions || []), ...(o.units || [])].filter(u => u.faction === ["Japan", "Allies"].indexOf(o.role)).map(u => [u.id, u]))
    const cards = new Set((o.ownCards || []).map(c => c.id)); if (o.currentDecision?.currentCard?.id) cards.add(o.currentDecision.currentCard.id)
    function id(value, allowed, label, nullable = false) {
        if (nullable && value === null) return null
        if (!Number.isSafeInteger(value) || !allowed.has(value)) bad(label + "必须引用当前观察中有效ID")
        return value
    }
    function ids(value, max = 8) {
        if (!Array.isArray(value) || value.length > max || new Set(value).size !== value.length) bad("单位计划列表超限或重复")
        return value.map(v => id(v, own, "己方单位"))
    }
    if (patch.objective !== undefined) result.objective = text(patch.objective, 300)
    if (patch.notes !== undefined) result.notes = strings(patch.notes, 6)
    for (const field of ["campaign", "turnPlan", "offensive"]) {
        if (patch[field] === undefined) continue
        const p = patch[field]
        if (p === null) { result[field] = null; continue }
        const old = result[field] || {}
        if (field === "campaign") {
            object(p, ["objective", "victoryBasis", "targets"])
            const next = { ...old }
            for (const k of ["objective", "victoryBasis"]) if (p[k] !== undefined) next[k] = text(p[k], 300)
            if (p.targets !== undefined) {
                if (!Array.isArray(p.targets) || p.targets.length > 4) bad("战役目标最多4项")
                next.targets = p.targets.map(t => { object(t, ["hex", "purpose"]); return { hex: id(t.hex, hexes, "地图目标"), purpose: text(t.purpose) } })
            }
            result[field] = next
        } else if (field === "turnPlan") {
            object(p, ["objectives", "constraints"])
            result[field] = { ...old, turn: p.objectives !== undefined || old.turn === undefined ? o.turn : old.turn,
                ...(p.objectives !== undefined ? { objectives: strings(p.objectives, 4) } : {}),
                ...(p.constraints !== undefined ? { constraints: strings(p.constraints, 5) } : {}) }
        } else {
            object(p, ["objective", "cardId", "mode", "hqId", "tasks", "stopOrReplan"])
            const scope = o.currentDecision?.offensiveScope || { turn: o.turn }
            const rebuilt = p.tasks !== undefined && p.cardId !== undefined && p.mode !== undefined && p.hqId !== undefined
            const next = { ...old, scope: copy(!old.scope || old.scope.instance === scope.instance || rebuilt ? scope : old.scope) }
            if (p.objective !== undefined) next.objective = text(p.objective, 300)
            if (p.cardId !== undefined) next.cardId = id(p.cardId, cards, "可见卡牌", true)
            if (p.mode !== undefined) { if (!["ops", "event", "reaction", null].includes(p.mode)) bad("攻势模式错误"); next.mode = p.mode }
            if (p.hqId !== undefined) { next.hqId = id(p.hqId, own, "己方HQ", true); if (next.hqId !== null && own.get(next.hqId)?.class !== "hq") bad("hqId不是HQ") }
            if (p.tasks !== undefined) {
                if (!Array.isArray(p.tasks) || p.tasks.length > 4) bad("攻势任务最多4项")
                next.tasks = p.tasks.map(t => {
                    object(t, ["targetHex", "intent", "ground", "escort", "support", "stage", "nextStep"])
                    if (!["capture", "assemble", "defend", "support", "relocate", "withdraw"].includes(t.intent)) bad("任务intent错误")
                    return { targetHex: id(t.targetHex, hexes, "任务地图目标"), intent: t.intent,
                        ground: ids(t.ground || []), escort: ids(t.escort || []), support: ids(t.support || []),
                        stage: text(t.stage || "planned", 40), nextStep: text(t.nextStep || "") }
                })
                for (const t of next.tasks) {
                    if (t.ground.some(id => own.get(id).class !== "ground")) bad("ground列表只能引用己方地面单位")
                    if (t.escort.some(id => own.get(id).class !== "naval")) bad("escort列表只能引用己方海军单位")
                    if (t.support.some(id => !["air", "naval"].includes(own.get(id).class))) bad("support列表只能引用己方空海支援单位")
                }
            }
            if (p.stopOrReplan !== undefined) next.stopOrReplan = strings(p.stopOrReplan, 4)
            result[field] = next
        }
    }
    return result
}
function assessment(memory, o) {
    const issues = []
    if (memory?.turnPlan && memory.turnPlan.turn !== o.turn) issues.push("回合计划过期：当前回合已改变")
    if (memory?.offensive?.scope?.instance !== undefined && memory.offensive.scope.instance !== o.currentDecision?.offensiveScope?.instance) issues.push("攻势计划需重评：公开攻势实例已改变")
    if (memory?.offensive?.cardId && o.currentDecision?.currentCard?.id && memory.offensive.cardId !== o.currentDecision.currentCard.id) issues.push("计划卡牌与当前有效卡不同，需重新核对")
    if (memory?.offensive?.mode && o.currentDecision?.currentCard?.selectedMode && memory.offensive.mode !== o.currentDecision.currentCard.selectedMode) issues.push("计划模式与当前模式不同，需重新核对")
    if (memory?.offensive?.hqId && o.currentDecision?.ownHQ && memory.offensive.hqId !== o.currentDecision.ownHQ) issues.push("计划HQ与当前已选HQ不同，需重新核对")
    for (const task of memory?.offensive?.tasks || []) {
        for (const id of [...task.ground, ...task.escort, ...task.support]) if (!(o.units || []).some(u => u.id === id)) issues.push("计划单位" + id + "当前不在可见棋盘")
        if (task.intent === "capture" && o.hexes.find(h => h.hex === task.targetHex)?.control === o.role) issues.push("夺占目标" + task.targetHex + "当前已由己方控制")
    }
    return { owner: "model-authored-plan", validation: "IDs-and-format-only; not feasibility or achieved outcomes", issues: [...new Set(issues)].slice(0, 12) }
}
function commitMemory(memory, before, after, event) {
    const result = copy(memory || { objective: "", notes: [] })
    const units = new Map(before.units.map(u => [u.id, u]))
    const changes = (after?.units || []).filter(u => { const old = units.get(u.id); return old && (old.location !== u.location || old.reduced !== u.reduced) }).slice(0, 8)
        .map(u => ({ id: u.id, from: units.get(u.id).location, to: u.location, reduced: u.reduced }))
    const row = { revision: event.revision, role: before.role, turn: before.turn, stateBefore: before.state, stateAfter: after?.state || null, afterObserved: !!after,
        action: event.action, label: event.label || event.action, effect: event.effect || null, policy: event.policy,
        assisted: !!event.assisted, reason: (event.reason || "").slice(0, 300), changes,
        after: after ? { currentCardId: after.currentDecision?.currentCard?.id || null, ownHQ: after.currentDecision?.ownHQ || null,
            activeUnitIds: after.activeUnits.slice(), selectedMovementUnitIds: after.selectedMovementUnits.slice(),
            battleHexes: after.battle.hexes.slice(), ownASPRemaining: after.ownASPRemaining, activationRemaining: after.activation?.remaining ?? null } : null }
    result.schemaVersion = 2; result.recent = [...(result.recent || []), row].slice(-12)
    if (after?.currentDecision?.currentCard && result.offensive && /^(ops|event|future_offensive)$/.test(event.action) && result.offensive.cardId === after.currentDecision.currentCard.id && result.offensive.mode === after.currentDecision.currentCard.selectedMode)
        result.offensive.scope = copy(after.currentDecision.offensiveScope)
    return result
}
function progressSignature(o) {
    return require("node:crypto").createHash("sha256").update(JSON.stringify({ role: o.role, turn: o.turn, state: o.state,
        currentCard: o.currentDecision?.currentCard?.id, mode: o.currentDecision?.currentCard?.selectedMode, stage: o.currentDecision?.stage, ownHQ: o.currentDecision?.ownHQ,
        ownCards: o.ownCards.map(c => c.id), ownASPRemaining: o.ownASPRemaining, politicalWill: o.politicalWill,
        controls: o.hexes.map(h => [h.hex, h.control]), progressOfWar: o.progressOfWar, passes: o.passes, ownFutureOffensive: o.ownFutureOffensive,
        units: o.units.map(u => [u.id, u.location, u.reduced]), active: o.activeUnits, selected: o.selectedMovementUnits, battles: o.battle.hexes, activation: o.activation })).digest("hex")
}
module.exports = { mergeMemory, assessment, commitMemory, progressSignature }
