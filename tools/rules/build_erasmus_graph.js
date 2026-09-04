"use strict"

const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "../..")
const pageDir = path.join(root, "data/erasmus/pages")
const output = path.join(root, "data/erasmus/charts.json")
const runtimeOutput = path.join(root, "js/server/erasmus_data.js")
const files = fs.readdirSync(pageDir).filter(name => /^page-\d\d\.json$/.test(name)).sort()
const charts = files.map(filename => JSON.parse(fs.readFileSync(path.join(pageDir, filename), "utf8")))

const document = {
	schema_version: 3,
	policy_version: "erasmus-v2.0-zh.13",
	source: "伊拉斯谟v2.0_图表汉化 (1).pdf",
	charts,
}
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, JSON.stringify(document, null, 2) + "\n")
fs.writeFileSync(runtimeOutput, `// Generated from data/erasmus/pages/*.json. Do not edit by hand.\nvar ERASMUS_CHARTS = ${JSON.stringify(charts)}\n`)
