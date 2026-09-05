"use strict"

const assert = require("assert")
const fs = require("fs")
const path = require("path")
const vm = require("vm")

// 第4页回归：有 >2 张手牌且存在可执行的无限制军事事件时，日本必须选 EC，
// 不能再由决策轴的 CONQUEST 类型绕过选牌图而拿反应牌打 OC。
{
    const sandbox = {
        JP: 0, AP: 1, MILITARY: 1, LAST_BOARD_HEX: 100,
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

// 开局夺占目标：限定在错误 HQ、或事件效果不能同时提供地面与海军的 EC，
// 必须保留为 OC；否则会出现高 LV 牌打出后没有单位/没有登陆护航。
{
    const sandbox = {
        JP: 0, AP: 1, MILITARY: 1, LAST_BOARD_HEX: 100,
        HQ_JP_SOUTH: 7, HQ_SOUTH_SEAS: 8,
        G: { turn: 2, inter_service: [0, 0] }, cards: [],
        get_allowed_actions() { return ["event", "ops"] },
    }
    sandbox.cards[10] = { name: "Fleet-only event", type: 1, ops: 3, logistic: 7, hq: [5] }
    sandbox.cards[11] = { name: "Ground-only event", type: 1, ops: 2, logistic: 6, hq: [7],
        before_unit_activation() { filter_activation_units((u, piece) => piece.class !== "naval", 0) } }
    sandbox.cards[12] = { name: "Flexible operations", type: 3, ops: 3 }
    vm.createContext(sandbox)
    const source = fs.readFileSync(path.join(__dirname, "..", "js", "server", "erasmus_state.js"), "utf8")
    vm.runInContext(source + ";this.api={pick:esm_card_window_action};", sandbox)
    const strategy = { role: "Japan", phase: "early", kind: "CONQUEST", name: "激进的南方资源战略",
        targetMeta: [{ hex: 50, kind: "CONQUEST", requiresOccupation: true }] }
    const selected = sandbox.api.pick(strategy, { actions: { card: [10, 11, 12] } }, {})
    assert.equal(selected.argument, 12)
    assert.match(selected.via, /受限事件OC/)
}

// 胜负规则前视：PW≤2 且本回合 PoW 尚差命名格时，盟军最后一张牌不能设置 FO/弃牌，
// 必须把最大可用牌用于当前图表轴的攻势；目标轴和合法动作本身不被改写。
{
    const sandbox = {
        JP: 0, AP: 1, MILITARY: 1, LAST_BOARD_HEX: 100,
        G: { turn: 8, political_will: 2, pow: 4, capture: [10, 11, 12],
            supply_cache: {}, inter_service: [0, 0], future_offensive: [0, 0] },
        cards: [],
        is_space_controlled(hex, faction) { return faction === 1 && [10, 11, 12].includes(hex) },
        get_allowed_actions() { return ["ops", "future_offensive"] },
    }
    sandbox.cards[49] = { name: "Last usable card", type: 3, ops: 3 }
    vm.createContext(sandbox)
    const source = fs.readFileSync(path.join(__dirname, "..", "js", "server", "erasmus_state.js"), "utf8")
    vm.runInContext(source + ";this.api={pick:esm_card_window_action,next:esm_card_action_window_action};", sandbox)
    const strategy = { role: "Allies", phase: "late", kind: "CONQUEST", name: "登陆日本" }
    const picked = sandbox.api.pick(strategy, { actions: { card: [49] } }, {})
    assert.equal(picked.argument, 49)
    assert.match(picked.via, /PoW紧急攻势/)
    const use = sandbox.api.next(strategy, { actions: { ops: 1, future_offensive: 1 } }, {})
    assert.equal(use.action, "ops", "条约败在即不得把最后一张牌留作未来攻势")
    assert.deepEqual(strategy.powEmergency, { politicalWill: 2, required: 4, bank: 3 })
}

// 已进入东京8格内友军机场的B29必须留待下一战略轰炸阶段，不能被普通攻势再次激活后
// 由无头航空移动送回回合轨。
{
    const pieces = []
    pieces[5] = { faction: 1, class: "air", b29: 1 }
    pieces[6] = { faction: 1, class: "air" }
    const sandbox = {
        JP: 0, AP: 1, LAST_BOARD_HEX: 100, TOKYO: 50,
        pieces, G: { location: [0, 0, 0, 0, 0, 45, 45] },
        get_map_data(hex) { return { airfield: hex === 45 } },
        get_distance(a,b) { return Math.abs(a-b) },
        is_space_controlled(hex,faction) { return hex === 45 && faction === 1 },
    }
    vm.createContext(sandbox)
    const source = fs.readFileSync(path.join(__dirname, "..", "js", "server", "erasmus_ops.js"), "utf8")
    vm.runInContext(source + ";this.api={preserve:eop_preserve_ready_b29};", sandbox)
    assert.equal(sandbox.api.preserve(5, "Allies"), true)
    assert.equal(sandbox.api.preserve(6, "Allies"), false)
    assert.equal(sandbox.api.preserve(5, "Japan"), false)
}

// 盟军远后方 HQ 上的航空兵若连“移动一次+战斗航程”都够不到当前目标，不得为凑满
// 激活上限反复出动再 PBM 回原地；目标进入两倍扩展航程后应恢复为合法候选。
{
    const pieces = []
    pieces[1] = { faction: 1, class: "air", ebr: 4 }
    pieces[2] = { faction: 1, class: "hq" }
    const sandbox = {
        JP: 0, AP: 1, LAST_BOARD_HEX: 100, pieces,
        G: { location: [0, 10, 10] },
        get_distance(a,b) { return Math.abs(a-b) },
    }
    vm.createContext(sandbox)
    const source = fs.readFileSync(path.join(__dirname, "..", "js", "server", "erasmus_ops.js"), "utf8")
    vm.runInContext(source + ";this.api={rear:eop_preserve_rear_air};", sandbox)
    assert.equal(sandbox.api.rear(1, "Allies", 30), true)
    assert.equal(sandbox.api.rear(1, "Allies", 18), false)
    assert.equal(sandbox.api.rear(1, "Japan", 30), false)
}

// 美国舰队补员不应被缅甸地面战线吸到仰光；非 CBI 战略有合法太平洋港时应放在
// 当前图表焦点附近。战争进程前视也只能使用当前图表链，不得扫描全图制造目标。
{
    const pieces = []
    pieces[1] = { faction: 1, class: "naval", rptype: "us_navy" }
    const map = {
        10: { name: "Rangoon", region: "Burma", port: true },
        40: { name: "Noumea", region: "Pacific", port: true },
        50: { name: "Guadalcanal", region: "Pacific", port: true },
        60: { name: "Harbin", region: "Manchuria", resource: true },
    }
    const sandbox = {
        JP: 0, AP: 1, LAST_BOARD_HEX: 100, TOKYO: 90, CHINA_BOX: 101, pieces,
        G: { turn: 6, pow: 4, capture: [], location: [0, 1] },
        get_map_data(h) { return map[h] || {} },
        get_distance(a,b) { return Math.abs(a-b) },
        is_space_controlled(h,f) { return f === 0 && (h === 50 || h === 60) },
        is_controllable_hex(h) { return h === 50 || h === 60 },
        eop_focus() { return 50 },
        esm_pow_bank() { return 2 },
    }
    vm.createContext(sandbox)
    const source = fs.readFileSync(path.join(__dirname, "..", "js", "server", "erasmus_state.js"), "utf8")
    vm.runInContext(source + ";this.api={place:esm_pick_placement,progress:esm_ap_progress_targets};", sandbox)
    assert.equal(sandbox.api.place([10, 40], "Allies", 1, pieces[1]), 40,
        "美国舰队应去太平洋焦点附近，而非被仰光吸走")
    assert.deepEqual(Array.from(sandbox.api.progress([50], [{ hex: 50, objective: "图表夺岛" }])).map(x=>x.hex), [50],
        "PoW 前视不得把全图哈尔滨等非图表目标插入队首")
}

// 明确图表目标必须压过“离任意敌军最近”的通用偏好。马尼拉为焦点时，应选更靠近
// 马尼拉的两栖地面，而不是靠近婆罗洲弱敌的远方单位。
{
    const pieces = []
    pieces[1] = { faction: 0, class: "ground", cf: 18, asp: true }
    pieces[2] = { faction: 0, class: "ground", cf: 12, asp: true }
    pieces[90] = { faction: 1, class: "ground", cf: 2 }
    const sandbox = {
        JP: 0, AP: 1, LAST_BOARD_HEX: 100,
        pieces, G: { location: [], supply_cache: {} },
        get_map_data(hex) { return { port: hex === 50 } },
        get_distance(a, b) { return Math.abs(a - b) },
        is_space_controlled(hex, faction) { return !(hex === 50 && faction === 0) },
        esm_gate_on() { return true },
    }
    sandbox.G.location[1] = 10
    sandbox.G.location[2] = 45
    sandbox.G.location[90] = 11
    vm.createContext(sandbox)
    const source = fs.readFileSync(path.join(__dirname, "..", "js", "server", "erasmus_ops.js"), "utf8")
    vm.runInContext(source + ";this.api={set:eop_set_strategy_chain,pick:eop_pick_unit,compose:composeTaskForce};", sandbox)
    sandbox.api.set("Japan", { name: "菲律宾", chain: [50], targetMeta: [{ hex: 50, kind: "CONQUEST", requiresOccupation: true }] })
    assert.equal(sandbox.api.pick([1, 2], "Japan", []), 2, "激活应服从当前图表目标距离")
    const view = { active: "Japan", ai: { focusControlledBy: "Allies", units: [
        { id: 1, faction: 0, class: "ground", cf: 18, asp: true, location: 10 },
        { id: 2, faction: 0, class: "ground", cf: 12, asp: true, location: 45 },
    ] }, offensive: { active_units: [] } }
    assert.equal(sandbox.api.compose(50, null, null, view, [1, 2], "Japan").unit, 2,
        "任务部队求解不得为远方高战力牺牲本轮可达性")
}

// 第5页回归：压制编队计入可反应兵力；两栖夺占不得由纯空军/纯海军完成，
// 初次激活优先同格海军护航，随后补地面登陆单位。
{
    const pieces = []
    pieces[1] = { faction: 0, class: "air", cf: 22 }
    pieces[2] = { faction: 0, class: "air", cf: 30 }
    pieces[3] = { faction: 0, class: "naval", cf: 18, br: 3 }
    pieces[4] = { faction: 0, class: "ground", cf: 12, asp: true }
    const sandbox = {
        JP: 0, AP: 1, LAST_BOARD_HEX: 100,
        pieces, G: { location: [0, 1, 2, 5, 5] },
        get_map_data(hex) { return { port: hex === 10 || hex === 20, island: hex === 20 } },
        get_distance(a, b) { return Math.abs(a - b) },
        is_space_controlled(hex, faction) { return !((hex === 20 || hex === 30) && faction === 0) },
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
        { id: 3, faction: 0, class: "naval", cf: 18, br: 3, location: 5 },
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

// 两栖护航可以从另一基地加入同一战斗格，不能因海陆出发地不同而完全不激活海军。
// 同时 HQ 选择必须优先实际指挥范围内有兵力者，避免打出攻势后“没有单位被启动”。
{
    const pieces = []
    pieces[1] = { faction: 0, class: "naval", cf: 12 }
    pieces[2] = { faction: 0, class: "ground", cf: 9, asp: true }
    const sandbox = {
        JP: 0, AP: 1, LAST_BOARD_HEX: 100,
        pieces, G: { location: [0, 4, 8], supply_cache: {} },
        get_map_data(hex) { return { port: hex === 20 } },
        get_distance(a, b) { return Math.abs(a - b) },
        is_space_controlled(hex, faction) { return !((hex === 20 || hex === 30) && faction === 0) },
        esm_gate_on() { return true },
    }
    vm.createContext(sandbox)
    const source = fs.readFileSync(path.join(__dirname, "..", "js", "server", "erasmus_ops.js"), "utf8")
    vm.runInContext(source + ";this.api={set:eop_set_strategy_chain,pick:eop_pick_unit,hq:selectOperationalHq,next:eop_next_focus_faction};", sandbox)
    sandbox.api.set("Japan", { name: "开局马尼拉", chain: [20],
        targetMeta: [{ hex: 20, kind: "SUPPRESS_HQ", requiresOccupation: true }] })
    assert.equal(sandbox.api.pick([1, 2], "Japan", []), 1,
        "登陆军与海军不在同格时也应先激活可用护航")

    const hqView = { ai: { focus: 20, units: [
        { id: 10, name: "Preferred empty HQ", faction: 0, class: "hq", location: 18, cr: 1, cm: 3 },
        { id: 11, name: "Other usable HQ", faction: 0, class: "hq", location: 5, cr: 4, cm: 2 },
        { id: 12, name: "Army", faction: 0, class: "ground", location: 7, cf: 9 },
    ] } }
    assert.equal(sandbox.api.hq(hqView, [10, 11], "Japan"), 11,
        "范围内没有兵力的 HQ 不得压过可实际启动单位的 HQ")

    const alliedHqView = { ai: { focus: 20, units: [
        { id: 20, name: "Central Pacific HQ", faction: 1, class: "hq", location: 2, cr: 25, cm: 3 },
        { id: 21, name: "South West Pacific HQ", faction: 1, class: "hq", location: 3, cr: 20, cm: 2 },
        { id: 22, name: "US Army", faction: 1, class: "ground", location: 5, cf: 9 },
    ] } }
    sandbox.api.set("Allies", { name: "重返菲律宾", chain: [20], targetMeta: [{ hex: 20, kind: "CONQUEST" }] })
    assert.equal(sandbox.api.hq(alliedHqView, [20, 21], "Allies"), 21,
        "中文战略名必须正确选择图表指定的 SW Pacific HQ")
    sandbox.api.set("Japan", { name: "多目标", chain: [20, 30], targetMeta: [
        { hex: 20, kind: "CONQUEST", requiresOccupation: true },
        { hex: 30, kind: "CONQUEST", requiresOccupation: true },
    ] })
    assert.equal(sandbox.api.next(0, [20]).hex, 30,
        "首要目标已宣战后，下一任务部队必须沿图表链转向第二目标")
}

// 无图表日本本土目标时，盟军通用攻击排序必须禁止开局自杀式远征。
{
    const source = fs.readFileSync(path.join(__dirname, "..", "js", "server", "offensive.js"), "utf8")
    assert.match(source, /faction === AP && targetMd && targetMd\.region === "Japan"/)
    assert.match(source, /focusMd\.region !== "Japan"/)
}

console.log("Erasmus card-tree and task-force hotfix tests passed")
