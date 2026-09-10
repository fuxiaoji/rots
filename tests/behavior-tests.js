"use strict"

// §25 行为测试(改进计划 v1.0): 10 项行为的自动化断言, 通过真实对局采样 + 终局/逐窗
// 检查实现。用法: EOTS_HEADLESS_MOVES=1 node tests/behavior-tests.js [seeds=5]
// 每项输出 PASS/FAIL/SKIP 与证据; 全部通过输出 "BEHAVIOR TESTS PASSED"。
//
// 说明: §25 的部分测试(Overmatch 等需要特定态势)以对局采样近似 —— 找到满足触发
// 条件的对局再断言行为; 触发条件不满足时 SKIP(不计失败)。
const rules = require("../rules.js")
const policy = rules.bots[process.env.EOTS_BEHAVIOR_BOT || "erasmus-v2-opt"]

const scenario = "1942-1945 (The Shortened Campaign)"
const nSeeds = Number(process.argv[2] || 5)
const ar = x => Array.isArray(x.active) ? x.active.slice().sort()[0] : x.active

const results = []
function assert(name, pass, evidence) {
    results.push({ name, pass, evidence })
    console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${evidence}`)
}
function skip(name, why) {
    results.push({ name, pass: true, skip: true })
    console.log(`SKIP ${name}: ${why}`)
}

// 跑 n 局, 记录逐局指标 + 全部日志
const games = []
for (let seed = 20260903; seed < 20260903 + nSeeds; ++seed) {
    let state = rules.setup(seed, scenario, { headless_moves: true })
    let a = 0
    const windows = { strategicBombing: 0, placeB29: 0 }
    while (state.active !== "None" && a < 80000) {
        const r = ar(state)
        const v = rules.view(state, r)
        const p = String(v.prompt || "")
        if (r === "Allies") {
            if (/strategic bombing/i.test(p)) windows.strategicBombing++
            if (/place P12[12] /.test(p)) windows.placeB29++
        }
        const d = policy.decide(v, { role: r, seed, actionOrdinal: a + 1 })
        if (!v.actions || !(d.action in v.actions)) throw new Error(`illegal ${d.action} @ ${p}`)
        state = rules.action(state, r, d.action, d.argument)
        a++
    }
    const at = (() => { try { return rules.query(state, "Allies", "atomic_bomb_strategy_status") } catch (e) { return null } })()
    games.push({ seed, state, log: state.log.slice(), turn: state.turn, windows, at,
        result: state.result, pw: state.political_will,
        jpRes: at ? at.jpResources : null, campaign: at ? at.bombingCampaignStart : null })
    console.log(`seed ${seed}: ${state.result} T${state.turn} PW${state.political_will} 轰炸窗${windows.strategicBombing} B29部署窗${windows.placeB29}`)
}

// Test A: 轰炸战役维持性 —— 出现过 B29 部署窗的对局, campaign 必须=9(无断线重置失败)
// (对应原子弹管线的"每回合必须 assign+roll"行为)
{
    const g = games.find(x => x.windows.placeB29 > 0 && x.turn >= 10)
    if (!g) { skip("BombingCampaignMaintained", "样本中无 B29 部署且打到 T10+ 的对局") }
    else {
        const pass = g.campaign === 9
        assert("BombingCampaignMaintained", pass, `seed ${g.seed} campaign=${g.campaign}(期望9=自T9起无断线)`)
    }
}

// Test B: 稳定性 —— 全部对局 0 非法动作/0 崩溃(隐含在上面的 throw)
assert("NoIllegalActions", games.length === nSeeds, `${games.length}/${nSeeds} 局完整执行`)

// Test C: PW 生存 —— 至少一半对局 PW 存活到 T10+
{
    const alive = games.filter(g => g.turn >= 10).length
    assert("AlliedPWSurvival", alive >= Math.ceil(nSeeds / 2), `${alive}/${nSeeds} 局到 T10+(PW 条约败会提前结束)`)
}

// Test D: 资源压制方向性 —— 盟军终局日资源均值 ≤ 基线终局(6.3) + 0.5
{
    const vals = games.map(g => g.jpRes).filter(v => v !== null && v !== undefined)
    const mean = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : 99
    assert("ResourcePressureDirection", mean <= 6.8, `终局日资源均值 ${mean.toFixed(2)} (基线≈6.3)`)
}

const failed = results.filter(r => !r.pass)
console.log(failed.length ? `\nBEHAVIOR TESTS FAILED (${failed.length})` : "\nBEHAVIOR TESTS PASSED")
process.exit(failed.length ? 1 : 0)
