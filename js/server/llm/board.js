"use strict"
const zlib = require("node:zlib")
const COLORS = { Japan: [224, 80, 80], Allies: [65, 157, 238], neutral: [110, 137, 141] }
const escape = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
function geometry(o) {
    const cells = o.hexes.filter(h => h.id >= 1000 && h.id <= 9999)
    const cols = cells.map(h => Math.floor(h.id / 100)), rows = cells.map(h => h.id % 100)
    const minX = Math.min(...cols), minY = Math.min(...rows)
    const scale = Math.min(1080 / (Math.max(...cols) - minX + 2), 590 / (Math.max(...rows) - minY + 2))
    const point = h => ({ x: Math.round(40 + (Math.floor(h.id / 100) - minX) * scale),
        y: Math.round(70 + (h.id % 100 - minY + (Math.floor(h.id / 100) % 2) / 2) * scale) })
    const byHex = new Map(cells.map(h => [h.hex, h])), groups = new Map()
    for (const u of o.units) if (byHex.has(u.location)) {
        if (!groups.has(u.location)) groups.set(u.location, [])
        groups.get(u.location).push(u)
    }
    return { cells, point, groups, scale }
}
function boardSvg(o) {
    const { cells, point, groups, scale } = geometry(o)
    const parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1160 700" role="img" aria-label="阵营可见棋盘">',
        '<rect width="1160" height="700" fill="#101f2d"/>',
        '<text x="24" y="28" fill="#edf2f4" font-size="18">EOTS · 红 Japan / 蓝 Allies · 点表示兵力 · 位置为规范格号</text>']
    for (const h of cells) {
        const p = point(h), rgb = COLORS[h.control] || COLORS.neutral, color = `rgb(${rgb.join(",")})`
        const radius = Math.max(3, scale * .25)
        const unitList = groups.get(h.hex) || []
        parts.push(`<g><title>${escape(h.id + " " + h.name + " / " + (h.control || "neutral") + " / " + unitList.map(u => u.name).join(", "))}</title><circle cx="${p.x}" cy="${p.y}" r="${radius}" fill="${h.terrain === 0 ? "#162b3c" : "#486052"}" stroke="${color}" stroke-width="${h.named ? 2 : .5}"/>`)
        if (h.named || unitList.length) parts.push(`<text x="${p.x + radius + 1}" y="${p.y}" fill="#d9e6ec" font-size="8">${escape(h.id + " " + (h.named ? h.name : ""))}</text>`)
        unitList.forEach((u, i) => parts.push(`<circle cx="${p.x - radius + (i % 5) * 3}" cy="${p.y + 4 + Math.floor(i / 5) * 3}" r="1.4" fill="${u.faction === 0 ? "#ff7a70" : "#62b5ff"}"/>`))
        parts.push('</g>')
    }
    parts.push(`<text x="24" y="680" fill="#edf2f4" font-size="14">${escape(o.role)} · Turn ${o.turn} · PW ${o.politicalWill} · PoW ${o.pow}</text></svg>`)
    return parts.join("")
}
let crcTable
function crc32(b) {
    if (!crcTable) crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
    let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) { const name = Buffer.from(type), out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); name.copy(out, 4); data.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8); return out }
function boardPng(o) {
    const w = 1160, h = 700, stride = w * 3 + 1, raw = Buffer.alloc(stride * h)
    const dot = (x, y, radius, color) => { for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius || x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h) continue
        const i = (y + dy) * stride + 1 + (x + dx) * 3; raw[i] = color[0]; raw[i + 1] = color[1]; raw[i + 2] = color[2]
    } }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * stride + 1 + x * 3; raw[i] = 16; raw[i + 1] = 31; raw[i + 2] = 45 }
    const digits = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001010010010", "111101111101111", "111101111001111"]
    const number = (n, x, y) => String(n).split("").forEach((d, j) => { const bits = digits[Number(d)]; if (!bits) return; for (let i = 0; i < 15; i++) if (bits[i] === "1") dot(x + j * 4 + i % 3, y + Math.floor(i / 3), 0, [220, 233, 237]) })
    const { cells, point, groups, scale } = geometry(o)
    for (const cell of cells) {
        const p = point(cell), r = Math.max(3, Math.round(scale * .25))
        dot(p.x, p.y, r, COLORS[cell.control] || COLORS.neutral)
        dot(p.x, p.y, r - 1, cell.terrain === 0 ? [22, 43, 60] : [72, 96, 82])
        const us = groups.get(cell.hex) || []
        if (cell.named || us.length) number(cell.id, p.x + r + 1, p.y - 3)
        us.forEach((u, i) => dot(p.x - r + i % 5 * 3, p.y + 4 + Math.floor(i / 5) * 3, 1, COLORS[u.faction === 0 ? "Japan" : "Allies"]))
    }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}
module.exports = { boardSvg, boardPng }
