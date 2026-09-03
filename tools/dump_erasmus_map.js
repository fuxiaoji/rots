"use strict"
// 一次性导出: 从 js/common/data_map.js 抽取 hex 名称注册表 -> data/erasmus/map_names.json
// 用途: erasmus_complete_ai_execution_engine.py 把战略目标名单解析到真实 hex(idx);
//       JS 端 erasmus.js 目标聚焦层复用同一张 name->idx 表。
// 统一索引: idx = (floor(id/100)-10)*29 + id%100 (js/common/utils.js hex_to_int)。
const fs = require("fs")
const path = require("path")

const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "common", "data_map.js"), "utf8")
const idx_of = id => (Math.floor(id / 100) - 10) * 29 + (id % 100)
const hex_of = i => (Math.floor(i / 29) * 100) + 1000 + (i % 29)

const by_idx = {}
const re = /\{\s*id:\s*(\d+)\s*,/g
let m
while ((m = re.exec(SRC))) {
    const id = +m[1]
    const start = SRC.indexOf("{", m.index)
    let depth = 0, j = start
    for (; j < SRC.length; j++) { const c = SRC[j]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) break } }
    const blk = SRC.slice(start, j + 1)
    const idx = idx_of(id)
    const e = by_idx[idx] || (by_idx[idx] = { id })
    const grab = re => { const x = blk.match(re); return x ? x[1] : undefined }
    const grabN = re => { const x = blk.match(re); return x ? +x[1] : undefined }
    const region = grab(/region:\s*"([^"]+)"/)
    const name = grab(/name:\s*"([^"]+)"/)
    const city = grab(/city:\s*(\w+)/)
    if (region) e.region = region
    if (name) e.name = name
    if (city) e.city = city
    if (/resource:\s*true/.test(blk)) e.resource = true
    if (/airfield:\s*true/.test(blk)) e.airfield = true
    if (/port:\s*true/.test(blk)) e.port = true
    if (e.terrain === undefined) { const t = grabN(/terrain:\s*(\d+)/); if (t !== undefined) e.terrain = t }
    if (e.edges === undefined) { const ed = blk.match(/edges:\s*\[([^\]]*)\]/); if (ed) e.edges = ed[1].split(",").map(x => +x.trim()) }
}

// named: 有名字的 hex(目标候选); land: 有 region 的陆地/区域格(用于 id 目标、区域聚合)。
// idx 是引擎日志 H#### 的口径。
const named = {}, land = {}
for (const idx of Object.keys(by_idx)) {
    const e = by_idx[idx]
    if (e.name) {
        named[idx] = {
            id: e.id, name: e.name, region: e.region || null,
            city: e.city || null, resource: !!e.resource, airfield: !!e.airfield,
            port: !!e.port, terrain: e.terrain,
        }
    }
    if (e.region) {
        land[idx] = {
            id: e.id, name: e.name || null, region: e.region,
            city: e.city || null, resource: !!e.resource, airfield: !!e.airfield,
            port: !!e.port, terrain: e.terrain,
        }
    }
}

const out = {
    generatedFrom: "js/common/data_map.js",
    note: "idx = (floor(id/100)-10)*29 + id%100; terrain: OCEAN=0 OPEN=1 JUNGLE=2 MIXED=3 MOUNTAIN=4 ATOLL=5; 目标文本里 2912/3606 这类是地图 hex id,已由 id 换算成 idx。",
    count: Object.keys(named).length,
    landCount: Object.keys(land).length,
    hexes: named,
    landHexes: land,
}
const p = path.join(__dirname, "..", "data", "erasmus", "map_names.json")
fs.mkdirSync(path.dirname(p), { recursive: true })
fs.writeFileSync(p, JSON.stringify(out, null, 1))
console.log("wrote", p, "named:", out.count, "land:", out.landCount)
