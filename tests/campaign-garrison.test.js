"use strict"

// Exercise the actual bundled engine and current query source without rebuilding
// or changing rules.js while other agents work on the planner.
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const Module = require("node:module")
const filename = path.join(__dirname, "../rules.js")
const marker = "/** import server/rules_query.js*/"
const bundled = fs.readFileSync(filename, "utf8")
const first = bundled.indexOf(marker), last = bundled.indexOf(marker, first + marker.length)
assert(first >= 0 && last > first, "bundled engine has query section markers")
const currentQuery = fs.readFileSync(path.join(__dirname, "../js/server/rules_query.js"), "utf8")
const instrumented = bundled.slice(0, first + marker.length) + "\n" + currentQuery + "\n" + bundled.slice(last)
    + `\nexports.__actualGarrisonIds = function(state, role, hex) {
        G = state; L = G.L; R = role; _load();
        const result = rules_query_snapshot(() => get_garrison(hex).slice());
        _save(); return result;
    };`
const mod = new Module(filename, module)
mod.filename = filename
mod.paths = Module._nodeModulePaths(path.dirname(filename))
mod._compile(instrumented, filename)
const rules = mod.exports
const state = rules.setup(20261004, "1943-1945 (The Even Shorter Campaign)", { headless_moves: true })
rules.view(state, "Allies")
function ask(source, hex, faction) {
    const before = JSON.stringify(source)
    const args = faction === undefined ? [hex] : [hex, { faction }]
    const result = rules.query(source, "Allies", { name: "rules_query", fn: "queryDefendingGround", args })
    assert.equal(JSON.stringify(source), before, "query leaves state, caches, log, RNG and garrison counters unchanged")
    return result
}

const osaka = ask(state, 732)
assert.equal(osaka.faction, 0)
assert.equal(osaka.cf, 12, "Osaka's built-in garrison supplies 12 CF even before a battle")
assert.deepEqual(osaka.lfs, [12])
assert.equal(osaka.units.length, 1)
assert.equal(osaka.units[0].garrison, true)
assert.equal(osaka.units[0].reduced, true, "prepare_battle materializes garrisons reduced")
assert.equal(osaka.units[0].definitionId, "army_jp_g_mainland")
assert.deepEqual(osaka.units.map(u => u.id), rules.__actualGarrisonIds(state, "Allies", 732))

const emptyIsland = ask(state, 1001, 0)
assert.equal(emptyIsland.cf, 0, "Eniwetok has air units but no ground or intrinsic garrison")
assert.deepEqual(emptyIsland.units, [])
assert.deepEqual(rules.__actualGarrisonIds(state, "Allies", 1001), [])
assert.equal(ask(state, 732, 1).cf, 0, "Japanese garrison is never counted as Allied defense")

const eliminated = JSON.parse(JSON.stringify(state))
eliminated.garr_elim.push(732)
eliminated.garr_elim.sort((a, b) => a - b)
assert.equal(ask(eliminated, 732, 0).cf, 0, "the engine's eliminated-garrison flag remains authoritative")
assert.deepEqual(rules.__actualGarrisonIds(eliminated, "Allies", 732), [])

const lae = ask(state, 834, 0)
assert.equal(lae.cf, 18)
assert.equal(lae.units[0].garrison, false)
const reduced = JSON.parse(JSON.stringify(state))
reduced.reduced.push(lae.units[0].id)
reduced.reduced = [...new Set(reduced.reduced)].sort((a, b) => a - b)
assert.equal(ask(reduced, 834, 0).cf, rules.pieces[lae.units[0].id].rcf,
    "ordinary defending units use their true reduced combat factor")

const differentEnemyHand = JSON.parse(JSON.stringify(state))
differentEnemyHand.hand[0] = []
assert.deepEqual(ask(differentEnemyHand, 732, 0), osaka, "enemy private cards cannot affect a public ground query")
console.log("Campaign garrison query: actual Osaka, empty island, elimination, reduction and purity passed")
