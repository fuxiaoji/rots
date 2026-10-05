"use strict"

// Use the actual rule engine with current source sections in memory. The shared
// generated bundle is never rebuilt or changed by this focused test.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const Module = require("node:module")
const filename = path.join(__dirname, "../rules.js")
function inlineSource(file) {
    return fs.readFileSync(path.join(__dirname, "../js", file), "utf8")
        .replace(/^\/\*\* import ([^*]+)\*\/$/gm, (marker, dependency) => marker + "\n" + inlineSource(dependency) + "\n" + marker)
}
let source = fs.readFileSync(filename, "utf8")
for (const file of ["server/rules_query.js", "server/game.js"]) {
    const marker = "/** import " + file + "*/"
    const first = source.indexOf(marker), last = source.indexOf(marker, first + marker.length)
    assert(first >= 0 && last > first, "bundled section markers exist: " + file)
    source = source.slice(0, first + marker.length) + "\n" + inlineSource(file) + "\n" + source.slice(last)
}
source += `
exports.__previewTest = {
    constants: { AP, JP, EC, OC, SURPRISE, HQ_CENTRAL_PACIFIC, HQ_SOUTH_WEST,
        CHINA_BOX, NON_PLACED_BOX, NAVAL_MOVE, GROUND_MOVE, HQ_SOUTH: HQ_JP_SOUTH, COL_TSUJI },
    withCardData(c, patch, run) {
        const saved = cards[c]; cards[c] = { ...saved, ...patch };
        try { return run(); } finally { cards[c] = saved; }
    },
    withForbiddenEffects(run) {
        const old = [play_event, military_card, activate_card, discard_card, draw_card, into_turn_draw];
        const fail = () => { throw Error("preview executed a card effect"); };
        play_event = military_card = activate_card = discard_card = draw_card = into_turn_draw = fail;
        try { return run(); } finally {
            [play_event, military_card, activate_card, discard_card, draw_card, into_turn_draw] = old;
        }
    }
};`
const mod = new Module(filename, module)
mod.filename = filename
mod.paths = Module._nodeModulePaths(path.dirname(filename))
mod._compile(source, filename)
const rules = mod.exports
const C = rules.__previewTest.constants
const clone = value => JSON.parse(JSON.stringify(value))
function fixture() {
    const state = rules.setup(20261004, "1943-1945 (The Even Shorter Campaign)", { headless_moves: true })
    state.hand[C.AP] = [1, 21, 38, 45]
    assert.equal(state.active, "Allies")
    assert.equal(state.L.P, "offensive_segment")
    return state
}
function ask(state, fn, args, role = "Allies") {
    const before = JSON.stringify(state)
    const result = rules.query(state, role, { name: "rules_query", fn, args })
    assert.equal(JSON.stringify(state), before, fn + " leaves all state, RNG, hands, caches and logs unchanged")
    return result
}
function preview(state, cardId, hqId, cardMode = "event", role = "Allies") {
    return ask(state, "queryCardPreview", [cardId, { cardMode, hqId }], role)
}

const state = fixture()
const ec = preview(state, 45, C.HQ_CENTRAL_PACIFIC)
assert.equal(ec.eligible, true)
assert.equal(ec.logistic, 8, "Flintlock uses its alternate logistics at Central Pacific HQ")
assert.equal(ec.activationBudget, 11, "EC can legally activate more than an OC's six units")
assert.equal(ec.intelligence, C.SURPRISE, "absent intelligence uses reset_offensive's actual default")
assert.deepEqual([ec.navalMoveDistance, ec.groundMoveDistance, ec.airMoveDistance], [15, 6, 3])
assert.equal(preview(state, 45, C.HQ_SOUTH_WEST).logistic, 4, "alternate logistics is conditional on the chosen HQ")
assert.equal(preview(state, 21, C.HQ_SOUTH_WEST).activationBudget, 8)
assert.equal(preview(state, 45, C.HQ_CENTRAL_PACIFIC, "ops").activationBudget, 6)
assert.deepEqual(ask(state, "queryActivationCandidates", [C.HQ_CENTRAL_PACIFIC,
    { faction: C.AP, cardId: 45, cardMode: "event" }]), ec.units)

// The real action path provides the independent reference for both the HQ
// preview and the already-played card, which has now left the player's hand.
let played = clone(state)
played = rules.action(played, "Allies", "card", 45)
played = rules.action(played, "Allies", "event")
assert.equal(played.L.P, "choose_hq")
assert(!played.hand[C.AP].includes(45))
assert.deepEqual(preview(played, 45, C.HQ_CENTRAL_PACIFIC), ec,
    "pre-card and actual choose-HQ previews agree")
const naval = ec.units.find(u => rules.pieces[u].class === "naval")
assert(naval)
const movementCtx = { cardId: 45, cardMode: "event", hqId: C.HQ_CENTRAL_PACIFIC, move_type: C.NAVAL_MOVE }
const beforeMove = ask(state, "queryGroupMovementDestinations", [[naval], movementCtx])
assert(beforeMove.reachableHexes.length > 0)
assert.deepEqual(ask(played, "queryGroupMovementDestinations", [[naval], movementCtx]), beforeMove,
    "event movement previews equal the real played card")
played = rules.action(played, "Allies", "unit", C.HQ_CENTRAL_PACIFIC)
assert.equal(played.L.P, "activate_units")
assert.equal(played.offensive.type, C.EC)
assert.equal(ec.activationBudget, played.offensive.logistic + played.L.hq_bonus)
assert.deepEqual(ec.units, played.L.possible_units, "candidate IDs match actual unit activation")
assert.equal(ask(played, "queryCardPreview", [45, { hqId: C.HQ_CENTRAL_PACIFIC }]).activationBudget, 11,
    "an active EC is recognized even without an explicit card mode")
const postLoss=clone(played)
postLoss.offensive.active_units[C.AP]=[naval]
postLoss.location[naval]=C.NON_PLACED_BOX
assert.equal(ask(postLoss,"queryCardPreview",[45,{hqId:C.HQ_CENTRAL_PACIFIC}]).eligible,true,
    "a post-battle active-unit list may contain an eliminated off-map unit")

// Hook-bearing military cards remain unsupported, ordinary political events do
// not masquerade as a military preview, and rejected offenses stay rejected.
assert.equal(preview(state, 38, C.HQ_CENTRAL_PACIFIC).eligible, false)
assert.equal(preview(state, 1, C.HQ_CENTRAL_PACIFIC).eligible, false)
assert.deepEqual(ask(state, "queryActivationCandidates", [C.HQ_CENTRAL_PACIFIC,
    { cardId: 38, cardMode: "event" }]), [])
const denied = clone(state)
denied.offensive.oc_denied = { 45: true }
assert.equal(preview(denied, 45, C.HQ_CENTRAL_PACIFIC).eligible, false)
assert.equal(preview(denied, 45, C.HQ_CENTRAL_PACIFIC, "ops").eligible, false)

// No current hook-free Allied card carries an HQ restriction, so exercise the
// same real card-data restriction with an isolated, restored card definition.
rules.__previewTest.withCardData(45, { hq: [C.HQ_CENTRAL_PACIFIC] }, () => {
    assert.equal(preview(state, 45, C.HQ_CENTRAL_PACIFIC).eligible, true)
    assert.equal(preview(state, 45, C.HQ_SOUTH_WEST).eligible, false)
    assert.deepEqual(ask(state, "queryActivationCandidates", [C.HQ_SOUTH_WEST,
        { cardId: 45, cardMode: "event" }]), [])
    assert.equal(ask(state, "queryGroupMovementDestinations", [[naval],
        { ...movementCtx, hqId: C.HQ_SOUTH_WEST }]).reachableHexes.length, 0)
    assert.equal(preview(state, 45, C.HQ_SOUTH_WEST, "ops").eligible, true,
        "an event's HQ restriction does not limit its OC use")
})
rules.__previewTest.withCardData(45, { draw: true }, () => {
    rules.__previewTest.withForbiddenEffects(() => assert.equal(preview(state, 45, C.HQ_CENTRAL_PACIFIC).eligible, true))
})

const absent = clone(state)
absent.hand[C.AP] = absent.hand[C.AP].filter(c => c !== 45)
assert.equal(preview(absent, 45, C.HQ_CENTRAL_PACIFIC).eligible, false)
for (const fn of ["queryCardPreview", "queryActivationCandidates", "queryGroupMovementDestinations"]) {
    const enemyCtx = { faction: C.AP, cardId: 45, cardMode: "event", hqId: C.HQ_CENTRAL_PACIFIC }
    const args = fn === "queryCardPreview" ? [45, enemyCtx]
        : fn === "queryActivationCandidates" ? [C.HQ_CENTRAL_PACIFIC, enemyCtx] : [[naval], enemyCtx]
    assert.deepEqual(ask(state, fn, args, "Japan"), ask(absent, fn, args, "Japan"),
        "private hand membership cannot be probed by impersonating the other faction")
}

const beforeView = JSON.stringify(state)
const view = rules.view(state, "Allies")
assert.equal(JSON.stringify(state), beforeView, "new card projection is read-only")
assert.equal(view.ai.ownCards.find(c => c.id === 45).previewEvent, true)
assert.equal(view.ai.ownCards.find(c => c.id === 38).previewEvent, false)
assert.equal(view.ai.ownCards.find(c => c.id === 1).previewEvent, false)
assert.equal(rules.view(denied, "Allies").ai.ownCards.find(c => c.id === 45).previewEvent, false)

// Tsuji's sole activation hook has a declarative preview; no hook or card
// effect is executed. Compare it with the independent real event action path.
let japan = rules.setup(20261401, "1942-1945 (The Shortened Campaign)", { headless_moves: true })
for (let step = 0; step < 100 && !(japan.active === "Japan" && japan.L.P === "offensive_segment"); step++) {
    const role = japan.active
    const d = rules.bots["erasmus-v2-opt-v5"].decide(rules.view(japan, role), { role })
    japan = rules.action(japan, role, d.action, d.argument)
}
japan.hand[C.JP] = [C.COL_TSUJI]
assert.equal(japan.active, "Japan")
assert.equal(japan.L.P, "offensive_segment")
const tsuji = preview(japan, C.COL_TSUJI, C.HQ_SOUTH, "event", "Japan")
assert.equal(tsuji.eligible, true)
assert(tsuji.units.length > 0 && tsuji.units.every(u => rules.pieces[u].class === "ground"))
rules.__previewTest.withCardData(C.COL_TSUJI, { before_unit_activation() { throw Error("preview executed Tsuji hook") } }, () => {
    rules.__previewTest.withForbiddenEffects(() => assert.deepEqual(preview(japan, C.COL_TSUJI, C.HQ_SOUTH, "event", "Japan"), tsuji))
})
rules.__previewTest.withCardData(C.COL_TSUJI, { after_unit_activation() {} }, () => {
    assert.equal(preview(japan, C.COL_TSUJI, C.HQ_SOUTH, "event", "Japan").eligible, false,
        "a new hook invalidates the narrow declarative exception")
})
let tsujiPlayed = clone(japan)
tsujiPlayed = rules.action(tsujiPlayed, "Japan", "card", C.COL_TSUJI)
tsujiPlayed = rules.action(tsujiPlayed, "Japan", "event")
assert.deepEqual(preview(tsujiPlayed, C.COL_TSUJI, C.HQ_SOUTH, "event", "Japan"), tsuji)
const ground = tsuji.units.find(u => rules.pieces[u].id === "14army") || tsuji.units[0]
const tsujiMovement = { cardId: C.COL_TSUJI, cardMode: "event", hqId: C.HQ_SOUTH, move_type: C.GROUND_MOVE }
assert.deepEqual(ask(japan, "queryGroupMovementDestinations", [[ground], tsujiMovement], "Japan"),
    ask(tsujiPlayed, "queryGroupMovementDestinations", [[ground], tsujiMovement], "Japan"))
tsujiPlayed = rules.action(tsujiPlayed, "Japan", "unit", C.HQ_SOUTH)
assert.deepEqual(tsuji.units, tsujiPlayed.L.possible_units)
assert.equal(tsuji.activationBudget, tsujiPlayed.offensive.logistic + tsujiPlayed.L.hq_bonus)
const japanNaval = rules.view(japan, "Japan").ai.units.find(u => u.class === "naval").id
assert.equal(ask(japan, "queryGroupMovementDestinations", [[japanNaval], { ...tsujiMovement, move_type: C.NAVAL_MOVE }], "Japan").reason,
    "hq-activation", "a ground-only EC cannot activate naval escorts")

const boxed = clone(state)
const b29 = rules.pieces.findIndex(p => p.b29)
const ownHidden = rules.pieces.findIndex(p => p.faction === C.AP && p.class === "naval")
const enemyBoxed = rules.pieces.findIndex(p => p.faction === C.JP && p.class === "air")
boxed.location[b29] = C.CHINA_BOX
boxed.location[ownHidden] = C.NON_PLACED_BOX
boxed.location[enemyBoxed] = C.CHINA_BOX
const publicUnits = rules.view(boxed, "Allies").ai.units
const visibleB29 = publicUnits.find(u => u.id === b29)
assert(visibleB29 && visibleB29.b29 && visibleB29.definitionId === rules.pieces[b29].id)
assert.equal(typeof visibleB29.oneStep, "boolean")
assert(!publicUnits.some(u => u.id === ownHidden || u.id === enemyBoxed),
    "only one's own China Box units are added; other off-map units stay unprojected")
console.log("Campaign card preview: actual EC/OC budgets, action parity, HQ limits, no effects, private boundary and China Box passed")
