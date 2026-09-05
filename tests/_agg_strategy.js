"use strict"
// 汇总 _strategy-*.json: 终局原因、结束回合、AP/JP 夺格的地域分布、PW 损耗原因、日本本土终态。
const fs = require("fs")
const path = require("path")
const file = path.resolve(process.argv[2] || "tests/results/_strategy-10-20260903-headless.json")
const o = JSON.parse(fs.readFileSync(file, "utf8"))
const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "common", "data_map.js"), "utf8")
const idxOf = id => (Math.floor(id / 100) - 10) * 29 + id % 100
const byIdx = {}
const re = /\{\s*id:\s*(\d+)\s*,/g
let m
while ((m = re.exec(SRC))) {
    const id = +m[1]
    const s = SRC.indexOf("{", m.index)
    let d = 0, j = s
    for (; j < SRC.length; j++) { const c = SRC[j]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) break } }
    const b = SRC.slice(s, j + 1)
    const e = byIdx[idxOf(id)] || (byIdx[idxOf(id)] = {})
    const rg = (b.match(/region:\s*"([^"]+)"/) || [])[1]
    const nm = (b.match(/name:\s*"([^"]+)"/) || [])[1]
    const city = (b.match(/city:\s*(\w+)/) || [])[1]
    if (rg) e.region = rg
    if (nm) e.name = nm
    if (city) e.city = city
}
const gs = o.games
const agg = { end: {}, apRegion: {}, jpRegion: {}, pwCauses: {}, apHomeCap: 0 }
const endTurns = []
gs.forEach(x => {
    endTurns.push(x.endTurn)
    agg.end[x.endMessage || x.winner] = (agg.end[x.endMessage || x.winner] || 0) + 1
    for (const k in x.pwCauses) agg.pwCauses[k] = (agg.pwCauses[k] || 0) + x.pwCauses[k]
    for (const s of x.apCapSamples) {
        const idx = +s.split(":")[0]
        const e = byIdx[idx] || {}
        const r = e.region || "?"
        agg.apRegion[r] = (agg.apRegion[r] || 0) + 1
        if (e.city === "JAPANESE_CITY" || r === "Japan") agg.apHomeCap++
    }
    for (const s of x.jpCapSamples) {
        const idx = +s.split(":")[0]
        const e = byIdx[idx] || {}
        agg.jpRegion[e.region || "?"] = (agg.jpRegion[e.region || "?"] || 0) + 1
    }
})
console.log(`games=${gs.length} headless=${o.headless} seeds ${o.baseSeed}-${o.baseSeed + gs.length - 1}`)
console.log("endTurns:", JSON.stringify(endTurns.sort((a, b) => a - b)))
console.log("ends:", JSON.stringify(agg.end, null, 0))
console.log("AP home-region/city captures:", agg.apHomeCap)
console.log("AP captured regions:", JSON.stringify(Object.entries(agg.apRegion).sort((a, b) => b[1] - a[1])))
console.log("JP captured regions:", JSON.stringify(Object.entries(agg.jpRegion).sort((a, b) => b[1] - a[1])))
console.log("PW causes:", JSON.stringify(agg.pwCauses, null, 0))
console.log("final Japan-region jp avg:", (gs.reduce((s, x) => s + (x.homeCtrl.Japan ? x.homeCtrl.Japan.jp : 0), 0) / gs.length).toFixed(2), "/11")
const apSamples = [...new Set(gs.flatMap(x => x.apCapSamples))]
console.log("distinct AP captured (name):", apSamples.join(", "))
