"use strict"

const assert = require("assert")
const rules = require("../rules.js")

const scenario = "1942-1945 (The Shortened Campaign)"
const JP_CONTROLLED = 1 << 23

function setup() {
    const state = rules.setup(990901, scenario, {})
    const initial = rules.query(state, "Allies", "atomic_bomb_strategy_status")
    state.turn = 12
    state.events[6] = 9 // STRAT_BOMBING_CAMPAIGN：从 T9 起连续成功
    return { state, initial }
}

// 已发生苏联事件：资源上限为 3。
{
    const { state, initial } = setup()
    state.removed[1].push(initial.sovietCardId)
    let status = rules.query(state, "Allies", "atomic_bomb_strategy_status")
    assert.equal(status.resourceLimit, 3)
    assert.equal(status.met, false, "4 个资源格不满足已发生苏联事件后的 ≤3 门槛")
    state.supply_cache[status.jpResourceHexes[0]] &= ~JP_CONTROLLED
    status = rules.query(state, "Allies", "atomic_bomb_strategy_status")
    assert.equal(status.jpResources, 3)
    assert.equal(status.met, true)
}

// 苏联事件尚未发生，但盟军持有且 Tojo 条件已满足：资源上限为 5。
{
    const { state, initial } = setup()
    state.hand[1].push(initial.sovietCardId)
    state.hand[1].sort((a, b) => a - b)
    state.events[26] = 8 // TOJO
    const status = rules.query(state, "Allies", "atomic_bomb_strategy_status")
    assert.equal(status.sovietOccurred, false)
    assert.equal(status.sovietPlayable, true)
    assert.equal(status.resourceLimit, 5)
    assert.equal(status.met, true)
}

// T9 后中断过轰炸：即使苏联与资源条件满足也不得进入原子弹胜利。
{
    const { state, initial } = setup()
    state.removed[1].push(initial.sovietCardId)
    state.events[6] = 10
    for (const h of rules.query(state, "Allies", "atomic_bomb_strategy_status").jpResourceHexes.slice(0, 2))
        state.supply_cache[h] &= ~JP_CONTROLLED
    const status = rules.query(state, "Allies", "atomic_bomb_strategy_status")
    assert.equal(status.noStrategicBombingFailure, false)
    assert.equal(status.met, false)
}

console.log("Atomic bomb strategy criteria: 3 cases passed")
