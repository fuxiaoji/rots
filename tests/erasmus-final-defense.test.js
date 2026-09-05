"use strict"

const assert = require("assert")
const fs = require("fs")
const path = require("path")
const vm = require("vm")

// 第3页脚注[2]：最终国防圈只检查日本当前控制的港口/机场。
// 敌控冲绳不能成为“待驻军”目标，也不能永久阻塞最终防御分支。
{
    const pieces = []
    pieces[1] = { faction: 0, class: "ground" }
    pieces[2] = { faction: 0, class: "air" }
    const owners = new Map([[10, 0], [11, 1], [20, 0], [21, 1]])
    const sandbox = {
        JP: 0, AP: 1, LAST_BOARD_HEX: 100,
        pieces, G: { location: [0, 10, 20] },
        is_space_controlled(hex, faction) { return owners.get(hex) === faction },
    }
    vm.createContext(sandbox)
    const source = fs.readFileSync(path.join(__dirname, "..", "js", "server", "erasmus_state.js"), "utf8")
    vm.runInContext(source + `
        esm_geo = () => ({ portsWithin8Tokyo:[10,11], airfieldsWithin5:[20,21] });
        this.api = { perimeter:esm_jp_final_perimeter_status };
    `, sandbox)
    const ok = sandbox.api.perimeter()
    assert.deepEqual(Array.from(ok.consideredPorts), [10])
    assert.deepEqual(Array.from(ok.consideredAirfields), [20])
    assert.equal(ok.portsGarrisoned, true)
    assert.equal(ok.airfieldsGarrisoned, true)

    sandbox.G.location[1] = 30
    sandbox.G.location[2] = 30
    const missing = sandbox.api.perimeter()
    assert.equal(missing.portsGarrisoned, false)
    assert.equal(missing.airfieldsGarrisoned, false)
}

// 防御战略需要激活、移动和会战；没有卡牌树明确指定事件时必须走 OC。
{
    const sandbox = {
        JP: 0, AP: 1, MILITARY: 1,
        G: { turn: 7, inter_service: [0, 0] },
        cards: [],
        get_allowed_actions() { return ["ops"] },
    }
    sandbox.cards[1] = { name: "Ops 2", type: 3, ops: 2 }
    sandbox.cards[2] = { name: "Ops 3", type: 3, ops: 3 }
    vm.createContext(sandbox)
    const source = fs.readFileSync(path.join(__dirname, "..", "js", "server", "erasmus_state.js"), "utf8")
    vm.runInContext(source + ";this.api={pick:esm_card_window_action,next:esm_card_action_window_action};", sandbox)
    const strategy = { role: "Japan", phase: "late", kind: "DEFEND", name: "最终防御战略" }
    const pick = sandbox.api.pick(strategy, { actions: { card: [1, 2] } }, {})
    assert.equal(pick.argument, 2, "最终防御应选择可用的最高 OC，而不是消耗低值事件")
    const next = sandbox.api.next(strategy, { actions: { ops: 1, event: 1 } }, {})
    assert.equal(next.action, "ops", "最终防御动作窗必须进入攻势以执行本州防御")
}

// 目标执行层：敌控地点从 GARRISON 链跳过；己控但缺少指定兵种的地点才是焦点。
// 同时验证显式空链战略会阻断旧 JP_RESOURCE 默认轴。
{
    const pieces = []
    pieces[1] = { faction: 0, class: "ground", cf: 12 }
    pieces[2] = { faction: 0, class: "air", cf: 18 }
    pieces[3] = { faction: 0, class: "naval", cf: 20 }
    const owners = new Map([[10, 1], [20, 0], [30, 0]])
    const sandbox = {
        JP: 0, AP: 1, LAST_BOARD_HEX: 100,
        pieces, G: { location: [0, 20, 40, 40], supply_cache: {} },
        is_space_controlled(hex, faction) { return owners.get(hex) === faction },
        get_distance(a, b) { return Math.abs(a - b) },
        get_map_data(hex) { return { region: hex >= 40 ? "Japan" : "Pacific", port: true } },
        get_jp_resources() { return 5 },
    }
    vm.createContext(sandbox)
    const source = fs.readFileSync(path.join(__dirname, "..", "js", "server", "erasmus_ops.js"), "utf8")
    vm.runInContext(source + ";this.api={set:eop_set_strategy_chain,axis:eop_axis,focus:eop_focus,pick:eop_pick_unit,compose:composeTaskForce};", sandbox)

    sandbox.api.set("Japan", {
        name: "最终国防圈战略", kind: "GARRISON", chain: [10, 20, 30],
        targetMeta: [
            { hex: 10, kind: "GARRISON", garrisonClass: "ground" },
            { hex: 20, kind: "GARRISON", garrisonClass: "ground" },
            { hex: 30, kind: "GARRISON", garrisonClass: "air" },
        ],
    })
    assert.equal(sandbox.api.focus("Japan"), 30, "敌控10应忽略、已有地面驻军的20应完成、缺空军的30才是焦点")
    const air = sandbox.api.compose(30, null, null, {
        active: "Japan", ai: { units: [
            { id: 1, faction: 0, class: "ground", cf: 12, location: 20 },
            { id: 2, faction: 0, class: "air", cf: 18, location: 40 },
            { id: 3, faction: 0, class: "naval", cf: 20, location: 40 },
        ] }, offensive: { active_units: [[]] },
    }, [1, 2, 3], "Japan")
    assert.equal(air.unit, 2, "机场驻军必须选择空军，不能选择航母或地面单位")

    sandbox.api.set("Japan", { name: "事件战略", kind: "EVENT", chain: [], targetMeta: [] })
    const eventAxis = sandbox.api.axis("Japan")
    assert.equal(eventAxis.id, "事件战略")
    assert.equal(eventAxis.kind, "EVENT")
    assert.deepEqual(Array.from(eventAxis.chain), [], "显式空链不得回退到南方资源轴")
}

// 真正的最终防御只围绕日本区域内的盟军地面部队建立动态目标。
{
    const pieces = []
    pieces[1] = { faction: 1, class: "ground" }
    pieces[2] = { faction: 1, class: "air" }
    pieces[3] = { faction: 1, class: "ground" }
    const sandbox = {
        JP: 0, AP: 1, LAST_BOARD_HEX: 100, TOKYO: 50,
        pieces, G: { location: [0, 45, 46, 10] },
        get_distance(a, b) { return Math.abs(a - b) },
        get_map_data(hex) { return { name: `H${hex}`, region: hex >= 40 ? "Japan" : "Pacific" } },
    }
    vm.createContext(sandbox)
    const source = fs.readFileSync(path.join(__dirname, "..", "js", "server", "erasmus_state.js"), "utf8")
    vm.runInContext(source + ";this.api={targets:esm_jp_final_defense_targets};", sandbox)
    const targets = sandbox.api.targets()
    assert.deepEqual(Array.from(targets, x => x.hex), [45])
    assert.equal(targets[0].kind, "DEFEND_HONSHU")
    assert.equal(targets[0].requiresOccupation, true, "板载冲锋以盟军本州地面部队所在格为夺回目标")
}

console.log("Erasmus final-perimeter and Honshu-defense regression tests passed")
