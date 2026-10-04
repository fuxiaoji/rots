"use strict"

// Compile the current source in memory and exercise actual card windows,
// restriction failure and rollback. No generated bundle or saved game changes.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

function expand(relative) {
    return fs.readFileSync(path.join(__dirname, "../js", relative), "utf8")
        .replace(/^\/\*\* import ([^\r\n]+)\*\/$/gm, (_, dependency) => expand(dependency.trim()))
}
const context = vm.createContext({ exports: {}, console, process: { env: {} } })
vm.runInContext(expand("rules.js") + `
    exports.cardRetryTest = {
        sandcrab: SANDCRAB, ordinary: find_card(AP, 45),
        alaska: events.ALASKA_OCCUPATION.keys.map(hex_to_int),
        notPlaced: NON_PLACED_BOX,
        refresh(state) {
            G = state; L = G.L; R = "Allies"; _load();
            check_supply(); _save();
        },
    };
`, context, { filename: "campaign-card-retry-source.js" })
const rules = context.exports
const C = rules.cardRetryTest
const clone = value => JSON.parse(JSON.stringify(value))

function fixture(playable = true) {
    const state = rules.setup(20261010, "1943-1945 (The Even Shorter Campaign)", { headless_moves: true })
    assert.equal(state.active, "Allies")
    assert.equal(state.L.P, "offensive_segment")
    state.hand[1] = [C.sandcrab, C.ordinary]
    for (let unit = 1; unit < rules.pieces.length; unit++) {
        if (rules.pieces[unit].faction === 0 && C.alaska.includes(state.location[unit]))
            state.location[unit] = C.notPlaced
    }
    if (playable) {
        const ground = rules.pieces.findIndex(piece => piece.faction === 0 && piece.class === "ground" && !piece.garrison)
        assert(ground > 0)
        state.location[ground] = C.alaska[0]
    }
    C.refresh(state)
    return state
}

function view(state) {
    const before = JSON.stringify(state)
    const result = rules.view(state, "Allies")
    assert.equal(JSON.stringify(state), before, "permission projection leaves the complete state unchanged")
    return result
}
function allowed(state, card) {
    return Array.from(view(state).ai.ownCards.find(item => item.id === card).allowed)
}
function act(state, action, argument) {
    const actions = view(state).actions
    assert(actions[action], "the engine offers " + action)
    if (Array.isArray(actions[action])) assert(actions[action].includes(argument))
    return rules.action(state, "Allies", action, argument)
}

// With Japanese units in Alaska, the original special event/discard choice
// remains exact; being unable to finish its offensive must not unlock OC/FO.
const fresh = fixture()
assert.deepEqual(allowed(fresh, C.sandcrab), ["discard", "event"])
let denied = clone(fresh)
denied.offensive.oc_denied = { [C.sandcrab]: true }
assert.deepEqual(allowed(denied, C.sandcrab), ["discard"])
denied = act(denied, "card", C.sandcrab)
const deniedActions = view(denied).actions
assert.equal(deniedActions.discard, 1)
for (const action of ["event", "ops", "future_offensive", "displace_hq", "return_hq"])
    assert(!deniedActions[action], "rejected Sandcrab does not offer " + action)
assert.throws(() => rules.action(clone(denied), "Allies", "event",
    { __ai: { version: 1, role: "Allies" }, action: undefined }), /Invalid action/,
    "the AI action boundary rejects another event")

// An ordinary card retains every nonoffensive option, while both offensive
// modes are denied. An unplayable Sandcrab still follows the ordinary OC path.
const ordinaryBefore = allowed(fresh, C.ordinary)
assert(ordinaryBefore.includes("event") && ordinaryBefore.includes("ops"))
const ordinaryDenied = clone(fresh)
ordinaryDenied.offensive.oc_denied = { [C.ordinary]: true }
assert.deepEqual(allowed(ordinaryDenied, C.ordinary), ordinaryBefore.filter(action => !["ops", "event"].includes(action)))
assert.deepEqual(allowed(ordinaryDenied, C.sandcrab), ["discard", "event"], "denial is card-specific")
const unavailable = fixture(false)
const unavailableBefore = allowed(unavailable, C.sandcrab)
assert(!unavailableBefore.includes("event") && unavailableBefore.includes("ops"))
unavailable.offensive.oc_denied = { [C.sandcrab]: true }
assert.deepEqual(allowed(unavailable, C.sandcrab), unavailableBefore.filter(action => action !== "ops"))

// Produce the denial through the real failed-commit/cancel path rather than
// merely constructing its flag. Zero activation cannot satisfy the Aleutian
// battle requirement, even though ending activation is a legal engine action.
let failed = act(clone(fresh), "card", C.sandcrab)
failed = act(failed, "event")
assert.equal(failed.L.P, "choose_hq")
failed = act(failed, "unit", view(failed).actions.unit[0])
assert.equal(failed.L.P, "activate_units")
failed = act(failed, "done")
assert.equal(failed.L.P, "commit_offensive_confirm")
assert.match(view(failed).prompt, /Aleutian/)
failed = act(failed, "cancel")
assert.equal(failed.L.P, "offensive_segment_card_action")
assert.equal(failed.offensive.oc_denied[C.sandcrab], true)
assert(failed.hand[1].includes(C.sandcrab), "failed offensive restores the card to hand")
assert.deepEqual(allowed(failed, C.sandcrab), ["discard"])
const retry = rules.bots["erasmus-campaign"].decide(view(failed), { role: "Allies", seed: 20261010, actionOrdinal: 1 })
assert.equal(retry.action, "discard", "AI selects the remaining legal exit rather than retrying the event")
assert.equal(retry.argument.__ai.profile.campaign_planner, 1, "the enhanced campaign profile must be active in this retry test")
failed = act(failed, retry.action, retry.argument)
assert(!failed.hand[1].includes(C.sandcrab), "the remaining legal exit consumes the card and breaks the retry cycle")
assert.notEqual(failed.L.P, "commit_offensive_confirm")

console.log("Campaign card retry: Sandcrab failed-commit rollback, restricted retry, ordinary-card parity and unchanged eligibility passed")
