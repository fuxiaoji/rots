"use strict"

const assert = require("assert")
const fs = require("fs")
const path = require("path")
const vm = require("vm")

// 第4页回归：有 >2 张手牌且存在可执行的无限制军事事件时，日本必须选 EC，
// 不能再由决策轴的 CONQUEST 类型绕过选牌图而拿反应牌打 OC。
{
    const sandbox = {
        JP: 0, AP: 1, MILITARY: 1,
        G: { turn: 2, inter_service: [0, 0] },
        cards: [],
        get_allowed_actions(id) { return id === 10 || id === 11 ? ["event", "ops"] : ["ops"] },
    }
    sandbox.cards[10] = { name: "Military EC low", type: 1, ops: 3, logistic: 5 }
    sandbox.cards[11] = { name: "Military EC high", type: 1, ops: 3, logistic: 7 }
    sandbox.cards[12] = { name: "Reaction as OC", type: 3, ops: 3, logistic: 4 }
    vm.createContext(sandbox)
    const source = fs.readFileSync(path.join(__dirname, "..", "js", "server", "erasmus_state.js"), "utf8")
    vm.runInContext(source + ";this.api={pick:esm_card_window_action,next:esm_card_action_window_action};", sandbox)
    const strategy = { role: "Japan", kind: "CONQUEST", name: "保守的空优战略" }
    const selected = sandbox.api.pick(strategy, { actions: { card: [10, 11, 12] } }, {})
    assert.equal(selected.argument, 11, "应选择最高后勤值的无限制军事事件")
    assert.match(selected.via, /无限制军事事件EC/)
    const use = sandbox.api.next(strategy, { actions: { event: 1, ops: 1 } }, {})
    assert.equal(use.action, "event", "下一窗口必须按 EC 打出")
}

// 第5页回归：压制编队计入可反应兵力；两栖夺占不得由纯空军/纯海军完成，
// 初次激活优先同格海军护航，随后补地面登陆单位。
{
    const pieces = []
    pieces[1] = { faction: 0, class: "air", cf: 22 }
    pieces[2] = { faction: 0, class: "air", cf: 30 }
    pieces[3] = { faction: 0, class: "naval", cf: 18 }
    pieces[4] = { faction: 0, class: "ground", cf: 12, asp: true }
    const sandbox = {
        JP: 0, AP: 1, LAST_BOARD_HEX: 100,
        pieces, G: { location: [0, 1, 2, 5, 5] },
        get_map_data(hex) { return { port: hex === 10 || hex === 20, island: hex === 20 } },
        get_distance(a, b) { return Math.abs(a - b) },
        is_space_controlled(hex, faction) { return !(hex === 20 && faction === 0) },
        esm_gate_on() { return true },
    }
    vm.createContext(sandbox)
    const source = fs.readFileSync(path.join(__dirname, "..", "js", "server", "erasmus_ops.js"), "utf8")
    vm.runInContext(source + ";this.api={set:eop_set_strategy_chain,compose:composeTaskForce};", sandbox)

    sandbox.api.set("Japan", { name: "压制", chain: [10], targetMeta: [{ hex: 10, kind: "SUPPRESS_HQ", damageLevel: .25 }] })
    const suppressionView = { active: "Japan", ai: { units: [
        { id: 1, faction: 0, class: "air", cf: 22, location: 1 },
        { id: 2, faction: 0, class: "air", cf: 30, location: 2 },
        { id: 90, faction: 1, class: "air", cf: 4, location: 10 },
        { id: 91, faction: 1, class: "air", cf: 12, br: 2, location: 8 },
    ] }, offensive: { active_units: [[1]] } }
    const suppression = sandbox.api.compose(10, null, null, suppressionView, [2], "Japan")
    assert.equal(suppression.complete, false, "一架飞机不得忽略潜在反应兵力后提前完成")
    assert.equal(suppression.potentialReactionStrength, 12)
    assert.equal(suppression.unit, 2)

    sandbox.api.set("Japan", { name: "登陆", chain: [20], targetMeta: [{ hex: 20, kind: "CONQUEST", damageLevel: 1, requiresOccupation: true }] })
    const landingBase = { active: "Japan", ai: { focusControlledBy: "Allies", units: [
        { id: 3, faction: 0, class: "naval", cf: 18, location: 5 },
        { id: 4, faction: 0, class: "ground", cf: 12, location: 5 },
    ] } }
    const escort = sandbox.api.compose(20, null, null, { ...landingBase, offensive: { active_units: [] } }, [3, 4], "Japan")
    assert.equal(escort.complete, false)
    assert.equal(escort.unit, 3, "敌控港口应先激活与地面同格的海军护航")
    const ground = sandbox.api.compose(20, null, null, { ...landingBase, offensive: { active_units: [[3]] } }, [4], "Japan")
    assert.equal(ground.complete, false)
    assert.equal(ground.unit, 4, "已有护航后应补地面登陆单位")
    const ready = sandbox.api.compose(20, null, null, { ...landingBase, offensive: { active_units: [[3, 4]] } }, [], "Japan")
    assert.equal(ready.complete, true)
    assert.equal(ready.formation, "supported-amphibious-assault")
}

console.log("Erasmus card-tree and task-force hotfix tests passed")
