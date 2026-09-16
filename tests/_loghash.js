"use strict"
// 压缩等价性取证: 同 seed 区间双方 erasmus-v2-opt 自对打, 输出 state.log.join("\n") 的 sha256
// 用法: node tests/_loghash.js <rulesPath> <count> <baseSeed> <profileTag>
const crypto = require("crypto")
const rulesPath = String(process.argv[2] || "../rules.js")
const rules = require(rulesPath)
const gameCount = Number(process.argv[3] || 5)
const baseSeed = Number(process.argv[4] || 20260910)
const bots = { Japan: rules.bots["erasmus-v2-opt"], Allies: rules.bots["erasmus-v2-opt"] }
const out = []
for (let gi = 0; gi < gameCount; ++gi) {
    const seed = baseSeed + gi
    let state = rules.setup(seed, "1942-1945 (The Shortened Campaign)", { headless_moves: true })
    let actions = 0, err = null
    try {
        while (state.active !== "None" && actions < 60000) {
            const r = Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
            const view = rules.view(state, r)
            const d = bots[r].decide(view, { role: r, seed, actionOrdinal: actions + 1 })
            if (!view.actions || !(d.action in view.actions)) throw new Error("illegal " + d.action + " @ " + view.prompt)
            state = rules.action(state, r, d.action, d.argument)
            actions++
        }
    } catch (e) { err = e.message }
    const joined = state.log.join("\n")
    out.push({ seed, actions, status: state.active, len: joined.length, sha256: crypto.createHash("sha256").update(joined, "utf8").digest("hex"), err })
}
console.log(JSON.stringify({ rulesPath, baseSeed, gameCount, games: out }, null, 1))
