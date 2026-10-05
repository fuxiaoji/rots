"use strict"

// Verify a published AI-WIN gzip archive against its bundled rule versions.
// Usage: node tools/verify-ai-win-archive.js [seed ...]
//        node tools/verify-ai-win-archive.js --archive ai-win-02 [seed ...]
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")
const crypto = require("crypto")
const os = require("os")
const { verifyReplay } = require("../tests/match-run")

const args = process.argv.slice(2)
const archiveName = args[0] === "--archive" ? args.splice(0, 2)[1] : "ai-win-01"
if (!["ai-win-01", "ai-win-02", "ai-win-03"].includes(archiveName)) throw new Error("unknown AI-WIN archive")
const root = path.resolve(__dirname, "../replays", archiveName)
const index = JSON.parse(fs.readFileSync(path.join(root, "index.json"), "utf8"))
const selected = new Set(args.map(Number))
if (selected.size && [...selected].some(n => !Number.isSafeInteger(n))) throw new Error("seeds must be integers")
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex")

let checked = 0
const foundSeeds = new Set()
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), archiveName + "-"))
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
        foundSeeds.add(entry.seed)
        checked++
    }
} finally { fs.rmSync(tempDir, { recursive: true, force: true }) }
if ([...selected].some(seed => !foundSeeds.has(seed))) throw new Error("one or more selected seeds are missing")
if (checked === 0) throw new Error("no replay was selected")
console.log(`Verified ${checked} archived Allied wins.`)
