"use strict"
const rules = require("../rules.js")
const state = rules.setup(20260903, "1942-1945 (The Shortened Campaign)", {})
// list all RESOURCE_HEX via query? try to read through map
const q = rules.query(state, "Allies", "atomic_bomb_strategy_status")
console.log("jpResources:", q.jpResources, "jpResourceHexes:", q.jpResourceHexes)
// dump ALL resource hexes with names via a fresh setup + map access
