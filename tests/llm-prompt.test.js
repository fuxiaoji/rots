"use strict"
const test = require("node:test"), assert = require("node:assert/strict"), rules = require("../rules")
const { observe, visible, clone, hash } = require("../js/server/llm/observation"), { mergeMemory, commitMemory, assessment, progressSignature } = require("../js/server/llm/memory")
const { messagesFor, rulesContext } = require("../js/server/llm/prompt"), { parseAnswer } = require("../js/server/llm/harness")
function packet(seed = 20262401) { return observe(rules, rules.setup(seed, "South Pacific", { headless_moves: true }), "Allies", 1) }
test("public map edges decode direction after filtered borders; unknown links remain unknown", () => {
 const state=rules.setup(20262603,"1943-1945 (The Even Shorter Campaign)",{headless_moves:true}),before=hash(state),o=visible(rules,state,"Allies").observation
 assert.equal(hash(state),before)
 const border=o.hexes.find(h=>h.hex===0),se=border.neighborEdgeFacts.find(e=>e.to===29)
 assert.equal(se.direction,"SE");assert.equal(se.water,true);assert.equal(se.land,false)
 const south=o.hexes.find(h=>h.hex===394).neighborEdgeFacts.find(e=>e.to===395)
 assert.equal(south.direction,"S");assert.equal(south.land,true);assert.equal(south.water,true)
 const p=observe(rules,state,"Allies",1),payload=JSON.parse(messagesFor(p,null,"edge").messages[1].content)
 assert.deepEqual(payload.observation.mapSemantics.neighborEdgeColumns,["toEngineHex","land","water","road"])
 const fake={view:(...args)=>rules.view(...args),query:(...args)=>{const data=rules.query(...args);if(args[2]==="llm_public_data")data.hexes.find(h=>h.hex===0).neighbors.push(777);return data}}
 assert.deepEqual(visible(fake,state,"Allies").observation.hexes.find(h=>h.hex===0).neighborEdgeFacts.find(e=>e.to===777),{to:777,checked:false})
})
test("campaign micro map retains legal paths, PoW, formations and reaction locations without pruning candidates", () => {
 const state=rules.setup(20262603,"1943-1945 (The Even Shorter Campaign)",{headless_moves:true}),p=observe(rules,state,"Allies",7)
 const full=JSON.parse(messagesFor(p,null,"full").messages[1].content)
 const own=p.observation.units.filter(u=>u.faction===1),enemyHQ=p.observation.units.find(u=>u.faction===0&&u.class==="hq")
 const memory={campaign:{targets:[{hex:421,purpose:"future"}]},offensive:{tasks:[{targetHex:834,ground:[own[0].id],escort:[own[1].id],support:[]}]}}
 p.observation.state="move_offensive_units";p.observation.activeUnits=[own[0].id];p.observation.selectedUnits=[own[1].id];p.observation.progressOfWar.heldHexes=[979]
 p.observation.battle.hexes=[834];p.observation.taskFacts.planned=[{publicReaction:{hqOptions:[{hq:enemyHQ.id,unitIds:[enemyHQ.id]}]}}]
 p.candidates=[{id:"r7-a0",action:"move",argument:[4,1,835,834],label:"exact",effect:{targetHex:834,unitIds:[own[0].id]}}]
 const before=hash(p),micro=JSON.parse(messagesFor(p,memory,"micro").messages[1].content),hexes=new Map(micro.observation.hexes.map(h=>[h[0],h]))
 assert.equal(hash(p),before);assert.deepEqual(micro.candidates,p.candidates);assert.deepEqual(micro.observation.units,full.observation.units)
 for(const h of [421,834,835,979,own[0].location,own[1].location,enemyHQ.location])assert(hexes.has(h))
 for(const n of p.observation.scenario.nations)for(const h of n.keys)assert(hexes.has(h.hex))
 for(const near of p.observation.hexes.find(h=>h.hex===834).neighbors)if(p.observation.hexes.some(h=>h.hex===near))assert(hexes.has(near))
 assert(micro.observation.hexes.length<full.observation.hexes.length);assert(micro.observation.mapCoverage.includes("never deny a route"))
 p.observation.state="activate_units";p.observation.activation={activeCount:0};assert(JSON.parse(messagesFor(p,memory,"first").messages[1].content).observation.mapCoverage.startsWith("planning:"))
})

test("missing memory and partial patches preserve plans; explicit null clears only chosen layer", () => {
    const p = packet(), old = { objective: "保留", notes: ["旧备注"], campaign: { objective: "胜利路径" }, turnPlan: { turn: 3, objectives: ["回合目标"] }, recent: [{ action: "card" }] }
    const a = parseAnswer(JSON.stringify({ candidateId: p.candidates[0].id }), p, "id", old)
    assert.equal(a.memory.objective, "保留"); assert.deepEqual(a.memory.notes, old.notes); assert.deepEqual(a.memory.campaign, old.campaign)
    const b = mergeMemory({ notes: [], offensive: null }, a.memory, p.observation)
    assert.equal(b.objective, "保留"); assert.deepEqual(b.notes, []); assert.equal(b.offensive, null); assert.deepEqual(b.recent, old.recent)
    assert.throws(() => mergeMemory({ recent: [{ action: "forged" }] }, old, p.observation), e => e.code === "FORMAT")
})
test("bounded structured plans validate public map, own cards, own unit IDs and troop classes", () => {
    const o = packet().observation, h = o.hexes.find(h => h.named).hex, ground = o.units.find(u => u.faction === 1 && u.class === "ground"), naval = o.units.find(u => u.faction === 1 && u.class === "naval"), enemy = o.units.find(u => u.faction === 0), hq = o.units.find(u => u.faction === 1 && u.class === "hq")
    const patch = { campaign: { objective: "VP≤5", targets: [{ hex: h, purpose: "目标" }] }, turnPlan: { objectives: ["夺取目标"], constraints: ["ASP"] },
        offensive: { cardId: o.ownCards[0].id, hqId: hq.id, mode: "ops", tasks: [{ targetHex: h, intent: "capture", ground: [ground.id], escort: [naval.id], support: [], nextStep: "选择地面单位" }] } }
    const m = mergeMemory(patch, null, o)
    assert.equal(m.turnPlan.turn, o.turn); assert.equal(m.offensive.scope.instance, o.currentDecision.offensiveScope.instance)
    for (const invalid of [99999, enemy.id, naval.id]) {
        const p = clone(patch); p.offensive.tasks[0].ground = [invalid]
        assert.throws(() => mergeMemory(p, null, o), e => e.code === "FORMAT")
    }
    assert.throws(() => mergeMemory({ campaign: { targets: [{ hex: 99999, purpose: "bad" }] } }, null, o), e => e.code === "FORMAT")
})
test("program appends confirmed after facts for forced/assisted; old plans are assessed without erasing campaign", () => {
    const o = packet().observation, after = clone(o), unit = after.units.find(u => u.faction === 1)
    unit.location = o.hexes[0].hex; after.state = "move_offensive_units"
    const old = { campaign: { objective: "长期路径" }, turnPlan: { turn: o.turn - 1 }, offensive: { scope: { instance: "old" }, tasks: [] } }
    const m = commitMemory(old, o, after, { revision: 3, action: "move", policy: "forced", assisted: true })
    assert.equal(m.recent.length, 1); assert(m.recent[0].afterObserved); assert.equal(m.recent[0].stateAfter, after.state); assert.equal(m.campaign.objective, "长期路径")
    assert(assessment(m, after).issues.length >= 2)
    assert.equal(commitMemory(old, o, null, { action: "done" }).recent[0].afterObserved, false)
})
test("map transit hexes and every unit capability survive prompt; complete relevant pages replace head truncation", () => {
    const p = packet(), text = JSON.parse(messagesFor(p, null, "id").messages[1].content)
    assert.equal(text.observation.hexes.length, p.observation.hexes.length)
    assert(text.observation.hexes.some(h => h[9].length))
    const decoded = text.observation.units.map(row => Object.fromEntries(text.observation.unitColumns.map((k, i) => [k, row[i]])))
    assert(decoded.some(u => u.class === "hq" && u.cm))
    for (const unit of p.observation.units) for (const [key, value] of Object.entries(unit)) assert.deepEqual(decoded.find(u => u.id === unit.id)[key], value)
    assert(text.observation.ownUnitDefinitions.every(row => p.candidates.some(c => c.effect?.unitId === row[0])))
    const source = rulesContext({ state: "activate_units", scenario: { name: "South Pacific" } }).find(s => s.file.includes("07-offensives"))
    assert.deepEqual(source.pdfPages, [17]); assert(source.excerpt.includes("7.24")); assert.equal(source.truncated, false)
    assert(rulesContext({ state: "offensive_segment_card_action" }).some(s => s.file.includes("05-strategy-cards")))
})
test("current selected card, HQ geometry, effective budget and own supply queries do not change state/RNG", () => {
    let state = rules.setup(20262402, "South Pacific", { headless_moves: true })
    for (let step = 0; step < 80; step++) {
        const role = Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
        const before = hash(state), p = observe(rules, state, role, step)
        assert.equal(hash(state), before)
        if (p.observation.state === "activate_units") {
            assert(p.observation.currentDecision.currentCard?.id); assert(p.observation.activation.limit >= p.observation.activation.activeCount)
            assert(p.observation.cardPreviews.length); assert(p.observation.cardPreviews.every(c => c.eligible || c.reason)); assert(p.observation.units.some(u => u.faction === ["Japan", "Allies"].indexOf(role) && typeof u.supplied === "boolean")); return
        }
        const v = rules.view(state, role), d = rules.bots["erasmus-v2-opt-v5"].decide(v, { role, seed: 20262402, actionOrdinal: step })
        state = rules.action(state, role, d.action, d.argument)
    }
    assert.fail("activation fixture not reached")
})
test("loop signature excludes revision/log/model memory but includes current selection", () => {
    const o = packet().observation, same = clone(o)
    same.currentDecision.revision = 999; same.log.push("irrelevant")
    assert.equal(progressSignature(o), progressSignature(same))
    same.selectedMovementUnits = [999]; assert.notEqual(progressSignature(o), progressSignature(same))
    const changed = clone(o); changed.hexes[0].control = changed.hexes[0].control === "Japan" ? "Allies" : "Japan"
    assert.notEqual(progressSignature(o), progressSignature(changed))
})
test("selected unplayed card is private to the active role, unlike public played cards", () => {
    let state = rules.setup(20262403, "South Pacific", { headless_moves: true })
    state = rules.action(state, "Allies", "pass")
    state = rules.action(state, "Allies", "done")
    const p = observe(rules, state, "Japan", 1)
    const card = p.candidates.find(c => c.action === "card")
    assert(card)
    state = rules.action(state, "Japan", card.action, card.argument)
    const own = visible(rules, state, "Japan").observation
    assert.equal(own.currentDecision.currentCard.id, card.argument)
    for (const role of ["Observer", "Allies"]) {
        const other = visible(rules, state, role).observation
        assert.equal(other.currentDecision.currentCard, null)
    }
})
test("a constraints-only patch cannot renew obsolete goals or offensive tasks", () => {
    const o = packet().observation, old = { turnPlan: { turn: o.turn - 1, objectives: ["old"] }, offensive: { scope: { instance: "old" }, tasks: [] } }
    const m = mergeMemory({ turnPlan: { constraints: ["new constraint"] }, offensive: { stopOrReplan: ["new condition"] } }, old, o)
    assert.equal(m.turnPlan.turn, old.turnPlan.turn); assert.equal(m.offensive.scope.instance, "old")
    assert.equal(assessment(m, o).issues.length, 2)
})
test("amphibious, reaction and PBM rules include continuation pages without duplicate files", () => {
    const move = rulesContext({ state: "move_offensive_units", window: "reaction", scenario: { name: "South Pacific" } })
    assert(move.find(s => s.file.includes("08-movement")).pdfPages.includes(24))
    assert(move.find(s => s.file.includes("07-offensives")).ruleIds.includes("7.26"))
    assert.equal(new Set(move.map(s => s.file)).size, move.length)
    assert(rulesContext({ state: "move_offensive_units", window: "pbm" }).find(s => s.file.includes("09-combat")).pdfPages.includes(30))
})
