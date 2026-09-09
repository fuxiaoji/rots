"use strict"

// W2.1 封锁最小割离线分析(真实地图数据):
//  1) 复刻 supply.js check_japan_resource_trace 的拓扑(8 本土城 → 任一资源格,
//     陆路走 GROUND 边 / 海路走 WATER 边, 海路可被 AP 非中立 ZOI 切断, 陆路只能被占领切断);
//  2) 求 8 城到最近资源格的最短路径, 取并集得"走廊边集"(海路部分 = ZOI 可覆盖集);
//  3) 对全图机场做贪心 set cover, 输出最小 ZOI 机场链 + 各机场的中和威胁(半径2内敌机场数)。
// 用法: node tools/blockade-cut.js
const fs = require("fs")
const vm = require("vm")
const path = require("path")

const read = f => fs.readFileSync(path.join(__dirname, "..", "js", "common", f), "utf8")
const ctx = { console, AP: 1, JP: 0 }
const src = read("library.js") + "\n" + read("utils.js") + "\n" + read("constants.js") + "\n" + read("data_map.js") +
    "\n;globalThis.__X = { MAP_DATA, LAST_BOARD_HEX, get_distance, hex_to_int, int_to_hex, WATER, GROUND }"
vm.runInNewContext(src, ctx)
const { MAP_DATA: MAP, LAST_BOARD_HEX: LAST, get_distance, hex_to_int, int_to_hex, WATER, GROUND } = ctx.__X
const TRACE_CITIES = [3307, 3704, 3407, 3506, 3507, 3607, 3706, 3705].map(hex_to_int) // JAPAN_TRACE_RESOURCES keys

function md(h) { return MAP[h] || null }
function near(h) { const m = md(h); return (m && Array.isArray(m.nh)) ? m.nh : [] }
function waterEdge(a, b) { // a→b 是否海路可通边(与 supply.js BFS 的 WATER 边口径一致)
    const m = md(a); if (!m) return false
    const list = near(a)
    for (let j = 0; j < list.length; ++j) if (list[j] === b && (m.edges_int & (WATER << 5 * j))) return true
    return false
}
function landEdge(a, b) {
    const m = md(a); if (!m) return false
    const list = near(a)
    for (let j = 0; j < list.length; ++j) if (list[j] === b && (m.edges_int & (GROUND << 5 * j))) return true
    return false
}
const RESOURCES = []
for (let h = 1; h < LAST; ++h) { const m = md(h); if (m && m.resource) RESOURCES.push(h) }

// 从 8 城出发的混合 BFS(陆/海都通, worst-case 拓扑), 记录每格前驱边; 终点=资源格。
// 走廊边 = 资源格回溯到任一城市路径上的边之并集(按层级 BFS 最短路径)。
const prev = new Map() // hex -> {from, water:bool}
{
    const q = [...TRACE_CITIES]; TRACE_CITIES.forEach(h => prev.set(h, null))
    while (q.length) {
        const item = q.shift()
        const m = md(item); if (!m) continue
        for (const nh of near(item)) {
            if (nh <= 0 || nh >= LAST || prev.has(nh)) continue
            const nm = md(nh); if (!nm) continue
            if (waterEdge(item, nh)) { prev.set(nh, { from: item, water: true }); q.push(nh) }
            else if (landEdge(item, nh)) { prev.set(nh, { from: item, water: false }); q.push(nh) }
        }
    }
}
// 资源格可达性 + 回溯走廊
const corridor = [] // {from,to,water}
for (const r of RESOURCES) {
    if (!prev.has(r)) continue
    let cur = r
    while (prev.get(cur)) {
        const p = prev.get(cur)
        corridor.push({ from: p.from, to: cur, water: p.water })
        cur = p.from
    }
}
const waterCorridor = corridor.filter(e => e.water)
console.log(`资源格 ${RESOURCES.length} 个, 走廊边 ${corridor.length} 条(海路 ${waterCorridor.length} 条)`)

// 机场覆盖: 半径2内触及走廊海路的任一端点即覆盖该边
const airfields = []
for (let h = 1; h < LAST; ++h) { const m = md(h); if (m && m.airfield) airfields.push(h) }
const cover = airfields.map(a => {
    const edges = []
    for (const e of waterCorridor) {
        if (get_distance(a, e.from) <= 2 || get_distance(a, e.to) <= 2) edges.push(e)
    }
    // 中和威胁: 半径2内的其它机场数(敌航空进驻即可抵消 ZOI 的代理指标)
    let threat = 0
    for (const b of airfields) if (b !== a && get_distance(a, b) <= 2) threat++
    return { a, edges, threat }
}).filter(x => x.edges.length)

// 贪心 set cover
const uncovered = new Set(waterCorridor)
const chain = []
while (uncovered.size) {
    let best = null
    for (const c of cover) {
        if (!c.edges.length) continue
        const gain = c.edges.filter(e => uncovered.has(e)).length
        if (gain === 0) continue
        if (!best || gain > best.gain || (gain === best.gain && c.threat < best.threat)) best = { ...c, gain }
    }
    if (!best) break
    chain.push(best)
    best.edges.forEach(e => uncovered.delete(e))
}

console.log("\n=== 最小 ZOI 机场链(贪心 set cover, 海路走廊) ===")
for (const c of chain) {
    const m = md(c.a)
    console.log(`hex ${int_to_hex(c.a)} ${m.name || m.id || ""} — 覆盖 ${c.edges.length} 边, 半径2敌机场威胁 ${c.threat}`)
}
if (uncovered.size) {
    console.log(`\nZOI 无法覆盖的走廊边 ${uncovered.size} 条(须占领端点/切断陆桥):`)
    for (const e of uncovered) console.log(`  ${e.from} → ${e.to}`)
}
const landBridge = corridor.filter(e => !e.water)
if (landBridge.length) {
    console.log(`\n陆桥边 ${landBridge.length} 条(ZOI 无效, 须地面占领端点格):`)
    for (const e of landBridge) console.log(`  ${e.from} → ${e.to}`)
}
