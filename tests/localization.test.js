"use strict"

const assert = require("assert")
const fs = require("fs")
const path = require("path")
const vm = require("vm")

const root = path.resolve(__dirname, "..")
const context = {}
vm.createContext(context)
vm.runInContext(fs.readFileSync(path.join(root, "js/common/locale_zh.js"), "utf8"), context)
const dictionaries = context.EOTS_ZH_NAMES

function namesFrom(file, pattern) {
	return [...fs.readFileSync(path.join(root, file), "utf8").matchAll(pattern)].map(match => match[1])
}

const sources = {
	cards: namesFrom("js/common/data_cards.js", /(?:"name"|name):\s*"([^"]+)"/g),
	units: namesFrom("js/common/data_pieces.js", /(?:"name"|name):\s*"([^"]+)"/g),
	places: namesFrom("js/common/data_map.js", /name:\s*"([^"]+)"/g),
}
for (const [kind, names] of Object.entries(sources)) {
	const missing = [...new Set(names)].filter(name => !dictionaries[kind][name])
	assert.deepEqual(missing, [], `${kind} missing translations: ${missing.join(", ")}`)
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "docs/localization/assets-manifest.json"), "utf8"))
assert.equal(manifest.assets.filter(asset => asset.object_id.startsWith("card:")).length, 344)
assert.equal(manifest.assets.filter(asset => asset.object_id.startsWith("map:")).length, 4)
for (const asset of manifest.assets)
	assert(fs.existsSync(path.join(root, asset.target)), `missing asset ${asset.target}`)

console.log("Localization data and asset coverage tests passed")

