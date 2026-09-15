// hex id -> 名称速查(通过 rules 内部函数)
"use strict"
const rules = require("../rules.js")
const scenario = "1942-1945 (The Shortened Campaign)"
const state = rules.setup(20260903, scenario, { headless_moves: true })
const ids = process.argv.slice(2).map(Number)
// data_map.js 直读: hex_to_int(id) -> map[idx]
const fs = require("fs")
const common = require("vm").runInNewContext(fs.readFileSync("/Users/Zhuanz1/Desktop/code/eots/rots/js/common/constants.js", "utf8")
    + "\nthis.OCEAN=OCEAN;this.JUNGLE=JUNGLE;this.MIXED=MIXED;this.MOUNTAIN=MOUNTAIN;this.CITY=CITY;this.CITY_MAJOR=CITY_MAJOR;", { Math, console })
const sandbox = { OCEAN: common.OCEAN, JUNGLE: common.JUNGLE, MIXED: common.MIXED, MOUNTAIN: common.MOUNTAIN, CITY: common.CITY, CITY_MAJOR: common.CITY_MAJOR }
require("vm").runInNewContext(fs.readFileSync("/Users/Zhuanz1/Desktop/code/eots/rots/js/common/data_map.js", "utf8")
    + "\nthis.map=map;this.hex_to_int=hex_to_int;", sandbox)
for (const id of ids) {
    const idx = sandbox.hex_to_int(id)
    const md = sandbox.map[idx]
    console.log(id, "->", idx, md ? (md.name || "(unnamed)") + " " + (md.region || "") + (md.resource ? " RES" : "") + (md.port ? " PORT" : "") + (md.airfield ? " AIR" : "") : "?")
}
