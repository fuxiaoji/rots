"use strict"

// Convert the legacy runtime-mutating locale.js into data-only dictionaries.
// Usage: node tools/localization/import_legacy_locale.js <source> <output>

const fs = require("fs")
const vm = require("vm")

const [, , sourcePath, outputPath] = process.argv
if (!sourcePath || !outputPath)
	throw new Error("usage: import_legacy_locale.js <source> <output>")

const source = fs.readFileSync(sourcePath, "utf8")

function extractObject(name) {
	const marker = `var ${name} = {`
	const start = source.indexOf(marker)
	if (start < 0)
		throw new Error(`missing ${name}`)
	let depth = 0
	let quote = null
	let escaped = false
	let objectStart = source.indexOf("{", start)
	for (let i = objectStart; i < source.length; ++i) {
		const c = source[i]
		if (quote) {
			if (escaped) escaped = false
			else if (c === "\\") escaped = true
			else if (c === quote) quote = null
			continue
		}
		if (c === '"' || c === "'") quote = c
		else if (c === "{") ++depth
		else if (c === "}" && --depth === 0)
			return vm.runInNewContext(`(${source.slice(objectStart, i + 1)})`)
	}
	throw new Error(`unterminated ${name}`)
}

const dictionaries = {
	units: extractObject("locale"),
	cards: extractObject("card_locale"),
	places: extractObject("place_locale"),
}

// The legacy place strings appended the English key without a separator.
// Preserve only the reviewed Chinese prefix; English remains available from data.js.
for (const [key, value] of Object.entries(dictionaries.places)) {
	let cleaned = value
	if (cleaned.endsWith(key))
		cleaned = cleaned.slice(0, -key.length)
	cleaned = cleaned.replace(/[=P]+$/, "").trim()
	dictionaries.places[key] = cleaned || value
}

fs.mkdirSync(require("path").dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath,
	"/** Generated data-only translations; see docs/localization/assets-manifest.json. */\n" +
	"var EOTS_ZH_NAMES = " + JSON.stringify(dictionaries, null, 2) + "\n")
