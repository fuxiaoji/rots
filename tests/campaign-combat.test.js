"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm")
const context = {}
vm.createContext(context)
vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/server/bots/erasmus_math.js"), "utf8")
    + ";this.api={outcome:em_ground_outcome,losses:em_ground_step_losses};", context)
const outcome = args => JSON.parse(JSON.stringify(context.api.outcome(args)))
const losses = (...args) => JSON.parse(JSON.stringify(context.api.losses(...args)))

test("legacy calls preserve their exact recorded values without optional step arrays", () => {
    const cases = [
        [{attCF:6,defCF:6,attMods:0,defMods:0,attLfs:[1],defLfs:[1]},
            {pWin:1,eOwnDamaged:1,eEnemyDamaged:1,eOwnElim:1,eEnemyElim:1,eOwnHits:6.3,eEnemyHits:6.3}],
        [{attCF:2,defCF:2,attMods:0,defMods:0,attLfs:[2],defLfs:[2]},
            {pWin:0.21,eOwnDamaged:0.7,eEnemyDamaged:0.7,eOwnElim:0,eEnemyElim:0,eOwnHits:2.1,eEnemyHits:2.1}],
        [{attCF:10,defCF:6,attMods:-1,defMods:3,attLfs:[3,4],defLfs:[2,5]},
            {pWin:0.2,eOwnDamaged:2,eEnemyDamaged:2,eOwnElim:1,eEnemyElim:0.8,eOwnHits:9,eEnemyHits:9}],
    ]
    for (const [args, expected] of cases) assert.deepEqual(outcome(args), expected)
})

test("mutual annihilation cannot count as occupation", () => {
    const result = outcome({attCF:6,defCF:6,attMods:0,defMods:0,attLfs:[1],defLfs:[1],attSteps:[2],defSteps:[2]})
    assert.equal(result.pWin, 0)
    assert.equal(result.pAttackerSurvives, 0)
    assert.equal(result.eOwnElim, 1)
    assert.equal(result.eEnemyElim, 1)
    assert.equal(result.model, "step-aware-full-first-lowest-lf")
    assert.equal(result.allocationApproximation, true)
})

test("full and reduced/one-step units consume two and one loss factors respectively", () => {
    assert.deepEqual(losses(4, [4], [2]), {lost:1,damaged:1,eliminated:0,survivors:1})
    assert.deepEqual(losses(8, [4], [2]), {lost:2,damaged:1,eliminated:1,survivors:0})
    assert.deepEqual(losses(4, [4], [1]), {lost:1,damaged:1,eliminated:1,survivors:0})
    const args = {attCF:100,defCF:4,attMods:0,defMods:0,attLfs:[4],defLfs:[1],defSteps:[1]}
    assert.equal(outcome({...args,attSteps:[2]}).pWin, 0.9)
    assert.equal(outcome({...args,attSteps:[1]}).pWin, 0.3)
    const defenders = {attCF:4,defCF:0,attMods:0,defMods:0,attLfs:[4],attSteps:[2],defLfs:[4]}
    assert.equal(outcome({...defenders,defSteps:[2]}).eEnemyElim, 0.1)
    assert.equal(outcome({...defenders,defSteps:[1]}).eEnemyElim, 0.7)
})

test("the hit pool is spent once and full units take initial losses before reduced units", () => {
    assert.deepEqual(losses(3, [2,2], [2,2]), {lost:1,damaged:1,eliminated:0,survivors:2})
    assert.deepEqual(losses(4, [2,2], [2,2]), {lost:2,damaged:2,eliminated:0,survivors:2})
    assert.deepEqual(losses(6, [2,2], [2,2]), {lost:3,damaged:2,eliminated:1,survivors:1})
    assert.deepEqual(losses(2, [3,2], [2,1]), {lost:0,damaged:0,eliminated:0,survivors:2})
})

test("actual engine blocks ordinary reduced targets while any full unit remains, even if its LF is unaffordable", () => {
    const offensive = fs.readFileSync(path.join(__dirname, "../js/server/offensive.js"), "utf8")
    const start = offensive.indexOf("function get_reduced_status("), end = offensive.indexOf("function get_ground_roll_modifiers(", start)
    assert(start >= 0 && end > start)
    const battle = { ground_stage: true, ground: [[1,2],[]], air_naval: [[],[]], damaged: [[],[]],
        amph_ground: [], critical: [false,false], hits: [0,4], distant_hits: [0,0], distant_hits_list: [[],[]],
        hit_able_units: [[],[]], total_lf: [], battle_hex: 10 }
    const engine = { G: { offensive: { battle }, reduced: [2], location: [0,10,10] }, L: {},
        pieces: [{},{lf:12},{lf:4}], CITY: 1, get_map_data: () => ({city:0}),
        set_has: (values, value) => values.includes(value), unit_on_board: () => true, trigger_event: () => {},
        map_get: (values, key, fallback) => { for (let i=0;i<values.length;i+=2) if(values[i]===key)return values[i+1]; return fallback },
        map_set: (values, key, value) => { for(let i=0;i<values.length;i+=2)if(values[i]===key){values[i+1]=value;return} values.push(key,value) },
    }
    vm.createContext(engine)
    vm.runInContext(offensive.slice(start, end) + ";this.fill=fill_hit_able_units;", engine)
    engine.fill(1)
    assert.equal(battle.hit_able_units[1].length, 0)
    assert.deepEqual(losses(4, [12,4], [2,1]), {lost:0,damaged:0,eliminated:0,survivors:2})
    engine.G.reduced = [1,2]
    engine.fill(1)
    assert.deepEqual(Array.from(battle.hit_able_units[1]), [2,4])
    assert.deepEqual(losses(4, [12,4], [1,1]), {lost:1,damaged:1,eliminated:1,survivors:1})
    // Explicitly document the model boundary: one_step is a separate eligibility
    // exception, while a bare steps=1 cannot distinguish it from ordinary reduced.
    engine.G.reduced = [2]; engine.pieces[2].one_step = true
    engine.fill(1)
    assert.deepEqual(Array.from(battle.hit_able_units[1]), [2,4])
})

test("caller supplies amphibious LF halving; the estimator does not halve it again", () => {
    const args = {attCF:100,defCF:4,attMods:0,defMods:0,defLfs:[1],attSteps:[2],defSteps:[1]}
    const normal = outcome({...args,attLfs:[4]}), landing = outcome({...args,attLfs:[2]})
    assert.equal(normal.pWin, 0.9)
    assert.equal(landing.pWin, 0.3)
    assert.equal(landing.eOwnElim, 0.7)
    assert.deepEqual(outcome({...args,attLfs:[2],amphibious:true}), landing)
})

test("optional steps must be supplied for both sides and match LF arrays", () => {
    const args = {attCF:4,defCF:4,attMods:0,defMods:0,attLfs:[2],defLfs:[2]}
    assert.throws(() => outcome({...args,attSteps:[2]}), /matching positive LFs/)
    assert.throws(() => outcome({...args,attSteps:[2],defSteps:[0]}), /matching positive LFs/)
    assert.equal(outcome({...args,attLfs:[],attSteps:[],defSteps:[1]}).pWin, 0)
})
