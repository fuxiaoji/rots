"use strict"

const assert = require("assert")
const rules = require("../rules.js")

// game 17 的固定复现场景：近藤信竹 EC 给出 7+2=9 个激活上限。旧实现选第5飞行师团后
// 因当前压制目标“最低战力已满足”立即 done；新策略须继续为后续目标组织兵力/前推。
const seed = 20481408444
let state = rules.setup(seed, "1942-1945 (The Shortened Campaign)", {
    historical: true, mode: "pve", human_role: "Allies", bot_id: "erasmus-v2", headless_moves: true,
})
const setupArgs = { oos:[95,96,99,103,106,165,166,168,175,176,177,178,179,180,181,182,183], br:0 }
state = rules.action(state, "Allies", "done", setupArgs)
state = rules.action(state, "Allies", "discard", setupArgs)

let ordinal = 3, activationUnits = 0, sawSparePlan = false
while (state.active === "Japan" && ordinal < 40) {
    const view = rules.view(state, "Japan")
    const decision = rules.bots["erasmus-v2"].decide(view, { role:"Japan", seed, actionOrdinal:ordinal + 1 })
    if (/Activate units/i.test(view.prompt || "") && decision.action === "unit") activationUnits++
    if (decision.publicTrace && decision.publicTrace.activationPlan?.mode === "后续目标/前线调动") sawSparePlan = true
    state = rules.action(state, "Japan", decision.action, decision.argument)
    ordinal++
    if (/Move units/i.test(rules.view(state, "Japan").prompt || "")) break
}
assert(activationUnits > 1, `EC 不应只激活一个单位，实际 ${activationUnits}`)
assert(sawSparePlan, "当前目标达标后应明确进入后续目标/前线调动模式")
console.log(`Erasmus activation utilization passed: ${activationUnits} units activated`)
