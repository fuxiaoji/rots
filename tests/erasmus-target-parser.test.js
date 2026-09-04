"use strict"

const assert = require("assert")
const fs = require("fs")
const path = require("path")
const vm = require("vm")

const map = [
    { id: 2320, name: "Bali", region: "DEI" },
    { id: 2517, name: "Balikpapan", region: "Borneo", resource: true },
    { id: 2616, name: "Tarakan", region: "Borneo", resource: true },
]
const sandbox = {
    LAST_BOARD_HEX: map.length - 1,
    get_map_data(index) { return map[index] },
	HQ_SOUTH_WEST: 10,
	HQ_MALAYA: 11,
	HQ_ABDA: 12,
	G: { location: { 10: 2, 11: 1, 12: 0 }, oos: new Set([11]) },
	set_has(set, value) { return set.has(value) },
}
vm.createContext(sandbox)
const source = fs.readFileSync(path.join(__dirname, "..", "js", "server", "erasmus_state.js"), "utf8")
vm.runInContext(source + `
    ;this.targetParser = {
        nameHexes: esm_name_hexes,
        parseEntry: esm_parse_entry,
        strategy: esm_lib("Japan").early["激进的南方资源战略"],
		hqTargets: esm_jp_hq_suppression_targets,
    }
`, sandbox)

const parser = sandbox.targetParser
assert.deepStrictEqual(Array.from(parser.nameHexes("Balikpapan")), [1], "Balikpapan must not prefix-match Bali")
assert.deepStrictEqual(Array.from(parser.nameHexes("Bali")), [0], "Bali must still resolve when explicitly named")

const goals = parser.parseEntry(parser.strategy, "Japan", "early")
const dei = goals.find(goal => goal.text.includes("东印度投降"))
assert(dei, "DEI surrender goal must exist")
assert.equal(dei.hexes.includes(0), false, "DEI surrender target list must not contain Bali")
assert.deepStrictEqual(Array.from(dei.hexes.slice(0, 2)), [1, 2], "DEI surrender must start with Balikpapan, Tarakan")

const hqTargets = parser.hqTargets()
assert.deepStrictEqual(Array.from(hqTargets, target => target.unit), [10, 12], "supplied HQs must retain Philippines > ABDA priority")
assert.deepStrictEqual(Array.from(hqTargets, target => target.damageLevel), [0.25, 0.5], "HQ suppression damage levels must follow chart 1")

console.log("ERASMUS target parser exact-name regression tests passed")
