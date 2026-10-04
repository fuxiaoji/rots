"use strict"

// Verify the published AI-WIN-01 gzip replays against the bundled rule versions.
// Usage: node tools/verify-ai-win-archive.js [seed ...]
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const crypto = require("crypto")
const os = require("os")
const { verifyReplay } = require("../tests/match-run")

const root = path.resolve(__dirname, "../replays/ai-win-01")
const index = JSON.parse(fs.readFileSync(path.join(root, "index.json"), "utf8"))
const selected = new Set(process.argv.slice(2).map(Number))
if (selected.size && [...selected].some(n => !Number.isSafeInteger(n))) throw new Error("seeds must be integers")
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex")

let checked = 0
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-win-01-"))
try {
    for (const entry of index.entries) {
        if (selected.size && !selected.has(entry.seed)) continue
        const compressed = fs.readFileSync(path.join(root, entry.archive))
        if (sha256(compressed) !== entry.archiveSha256) throw new Error(`archive SHA-256 differs: ${entry.seed}`)
        const raw = zlib.gunzipSync(compressed)
        if (sha256(raw) !== entry.rawReplaySha256) throw new Error(`raw replay SHA-256 differs: ${entry.seed}`)
        const replay = JSON.parse(raw)
        const bundlePaths = {}
        for (const role of ["Japan", "Allies"]) {
            const hash = replay.metadata.bundles[role].sha256
            const bundleArchive = path.join(root, "bundles", `${hash}.js.gz`)
            const packed = fs.readFileSync(bundleArchive)
            if (sha256(packed) !== index.bundleArchives[hash]) throw new Error(`bundle archive SHA-256 differs: ${entry.seed} ${role}`)
            const bundle = zlib.gunzipSync(packed)
            if (sha256(bundle) !== hash) throw new Error(`bundle SHA-256 differs: ${entry.seed} ${role}`)
            bundlePaths[role] = path.join(tempDir, `${hash}.js`)
            if (!fs.existsSync(bundlePaths[role])) fs.writeFileSync(bundlePaths[role], bundle)
        }
        const result = verifyReplay(replay, { bundlePaths })
        if (!result.verified || result.winner !== "Allies" || result.finalStateSha256 !== entry.finalStateSha256 ||
            result.actions !== entry.actions || result.won_text !== entry.victory)
            throw new Error(`result differs: ${entry.seed}`)
        console.log(`${entry.seed} verified: ${result.won_text} T${entry.turn}, ${result.actions} actions`)
        checked++
    }
} finally { fs.rmSync(tempDir, { recursive: true, force: true }) }
if (selected.size !== 0 && checked !== selected.size) throw new Error("one or more selected seeds are missing")
if (checked === 0) throw new Error("no replay was selected")
console.log(`Verified ${checked} archived Allied wins.`)
