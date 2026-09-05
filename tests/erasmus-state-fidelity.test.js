"use strict"

// 六张决策轴黄金路径。2026-09-04 起以 PDF 实际箭头为权威，
// 不再用旧 Python 近似实现反向证明自身正确。

const assert = require("assert")
const fs = require("fs")
const path = require("path")
const vm = require("vm")

// 经 vm 载入原始 esm_state 源, 取其纯树函数(不触发引擎全局常量)。
const srcPath = path.join(__dirname, "..", "js", "server", "erasmus_state.js")
const source = fs.readFileSync(srcPath, "utf8")
const sandbox = { result: null }
vm.createContext(sandbox)
vm.runInContext(source + "\n;this.result = { jp_early: esm_jp_eval_early, jp_mid: esm_jp_eval_mid, jp_late: esm_jp_eval_late, al_early: esm_al_eval_early, al_mid: esm_al_eval_mid, al_late: esm_al_eval_late };", sandbox)
const T = sandbox.result

const defaults = () => ({
    // 对齐 py ErasmusContext.__init__ (L515-573)
    cards_in_hand: 5, can_pass: false, current_turn: 2,
    jp_A: false, jp_B_dei_surrender_hexes_occupied: false,
    jp_D_res_lt_13: false, jp_F_logistics_ge_20: false,
    jp_H_logistics_le_19: false, jp_I_azoi_covers_dei_ports: false,
    jp_J_controls_rabaul_guadalcanal: false,
    jp_K_controls_4_to_6_ng_ports: false,
    jp_L_mal_phil_dei_not_conquered: true, jp_M_perimeter_target_1_complete: false,
    jp_E_us_will_lt_4: false, jp_F_burma_surrendered: false,
    jp_G_logistics_ge_15: false, jp_H_has_gandhi: false,
    jp_I_more_steps_in_burma: false, jp_J_logistics_ge_18: false,
    jp_L_B_garrisons_within_8: false, jp_L_C_airfields_within_5: false,
    jp_L_E_allied_on_honshu: false,
    al_B_hq_supplied_phil: false, al_C_hq_supplied_malaya: false,
    al_D_arcadia_played: false, al_E_cbi_def_established: false,
    al_F_has_passes: false, al_G_only_1_card_left: false,
    al_J_phil_not_surrendered: true, al_K_service_agreement: false,
    al_L_has_2_carriers: false, al_M_us_corps_near_carrier: false,
    al_N_aus_no_jp_ground: true, al_O_dei_not_surrendered: true,
    al_P_abda_hq_supplied: false,
    al_M_B_needs_war_progress: true, al_M_D_jp_controls_counterattack_target: true,
    al_L_B_is_turn_12: false, al_L_D_has_strategic_bombing_base: false,
    al_L_E_all_b29_on_base: false, al_L_F_controls_hex_within_8_tokyo: false,
    al_L_G_meets_atomic_bomb_criteria: false,
})

let count = 0
function eq(fn, patch, expected, note, d10) {
    const ctx = Object.assign(defaults(), patch)
    const got = fn(ctx, d10)
    assert.equal(got, expected, `${note}: expected ${expected}, got ${got}`)
    count++
}

// ---- JP 早期（PDF 第1页实际箭头） ------------------------------------------
const jpE = T.jp_early
eq(jpE, { jp_A:false, jp_D_res_lt_13:true, jp_F_logistics_ge_20:true }, "激进的空优战略", "A否，C+D真，F真")
eq(jpE, { jp_A:false, jp_D_res_lt_13:true, jp_F_logistics_ge_20:false }, "保守的空优战略", "A否，C+D真，F否")
eq(jpE, { jp_A:true, jp_B_dei_surrender_hexes_occupied:false, current_turn:4 }, "激进的南方资源战略", "A真，B否，G真")
eq(jpE, { jp_A:true, jp_B_dei_surrender_hexes_occupied:false, current_turn:1, jp_D_res_lt_13:true }, "激进的南方资源战略", "G否，A+C+D真")
eq(jpE, { jp_A:true, jp_B_dei_surrender_hexes_occupied:true, jp_H_logistics_le_19:true, jp_I_azoi_covers_dei_ports:true }, "外围防御战略", "C+(E或H+I)")
eq(jpE, { jp_A:true, jp_B_dei_surrender_hexes_occupied:true, cards_in_hand:2, jp_M_perimeter_target_1_complete:true }, "事件战略", "M后D10 0-2", 1)
eq(jpE, { jp_A:true, jp_B_dei_surrender_hexes_occupied:true, cards_in_hand:2, jp_M_perimeter_target_1_complete:true }, "激进的南方资源战略", "M后D10 3-6", 4)
eq(jpE, { jp_A:true, jp_B_dei_surrender_hexes_occupied:true, cards_in_hand:2, jp_M_perimeter_target_1_complete:true }, "中太平洋战略", "M后D10 7-9", 8)

// ---- JP 中期 (页2 / py evaluate_mid L619-644) -------------------------------
const jpM = T.jp_mid
eq(jpM, { cards_in_hand: 2, can_pass: true }, "PASS", "cards<3 + can_pass")
eq(jpM, { cards_in_hand: 2 }, "事件战略", "cards<3")
eq(jpM, { jp_D_res_lt_13: true }, "资源战略", "D res<13")
eq(jpM, { jp_F_logistics_ge_20: true, jp_E_us_will_lt_4: true }, "中太平洋战略", "F + E(us_will)")
eq(jpM, { jp_F_logistics_ge_20: true, jp_F_burma_surrendered: true, jp_H_has_gandhi: true, jp_J_logistics_ge_18: true }, "印度战略", "F + burma + (H or I)&J")
eq(jpM, { jp_F_logistics_ge_20: true, jp_F_burma_surrendered: true, jp_J_logistics_ge_18: false }, "外围防御战略", "F + burma, (H/I)&J 不成")
eq(jpM, { jp_F_logistics_ge_20: true, jp_F_burma_surrendered: false }, "中缅印战略", "F + 未降缅")
eq(jpM, { jp_G_logistics_ge_15: true, jp_F_burma_surrendered: false }, "中缅印战略", "G(15..19) + 未降缅")
eq(jpM, { jp_G_logistics_ge_15: true, jp_F_burma_surrendered: true, jp_I_more_steps_in_burma: true, jp_J_logistics_ge_18: true }, "印度战略", "G + burma + I&J")
eq(jpM, { jp_F_logistics_ge_20: false, jp_G_logistics_ge_15: false }, "外围防御战略", "F/G 皆否")

// ---- JP 晚期 (页3 / py evaluate_late L646-660) ------------------------------
const jpL = T.jp_late
eq(jpL, { cards_in_hand: 2 }, "事件战略", "py self-test: 手牌不足")
eq(jpL, { cards_in_hand:5, can_pass:true }, "最终国防圈战略", "驻军未完成先补国防圈")
eq(jpL, { jp_L_B_garrisons_within_8:true, jp_L_C_airfields_within_5:true, can_pass:true }, "PASS", "驻军完成后可PASS")
eq(jpL, { jp_L_B_garrisons_within_8:true, jp_L_C_airfields_within_5:true, jp_L_E_allied_on_honshu:true }, "最终防御战略", "驻军完成且盟军在本州")
eq(jpL, { jp_L_B_garrisons_within_8:true, jp_L_C_airfields_within_5:true }, "事件战略", "驻军完成默认事件")

// ---- AL 早期 (页7 / py evaluate_early L670-699) -----------------------------
const alE = T.al_early
eq(alE, { cards_in_hand: 2 }, "事件战略", "cards<3")
eq(alE, { al_B_hq_supplied_phil: true }, "撤离菲律宾", "B 菲律宾有补给HQ")
eq(alE, { al_B_hq_supplied_phil:false, al_C_hq_supplied_malaya:true }, "撤离马来亚", "C 马来亚有补给HQ")
eq(alE, { al_B_hq_supplied_phil:false, al_C_hq_supplied_malaya:false, al_D_arcadia_played:false }, "建立ABDA", "D 未打 ARCADIA")
eq(alE, { al_D_arcadia_played: true, al_E_cbi_def_established: false }, "增强CBI防御", "E CBI 未立")
eq(alE, { al_D_arcadia_played: true, al_E_cbi_def_established: true, al_F_has_passes: true, al_G_only_1_card_left: true }, "PASS", "F&G")
eq(alE, { al_D_arcadia_played: true, al_E_cbi_def_established: true, al_K_service_agreement: true, al_L_has_2_carriers: true, al_M_us_corps_near_carrier: true }, "橙色计划", "J..N 全真")
eq(alE, { al_D_arcadia_played: true, al_E_cbi_def_established: true, al_P_abda_hq_supplied: true }, "DEI防御", "O&P")
eq(alE, { al_D_arcadia_played: true, al_E_cbi_def_established: true, al_P_abda_hq_supplied: false }, "攻势进攻", "默认回退")

// ---- AL 中期 (页8 / py evaluate_mid L701-718) -------------------------------
const alM = T.al_mid
eq(alM, { can_pass: true }, "PASS", "can_pass")
eq(alM, { al_M_B_needs_war_progress: true, al_M_D_jp_controls_counterattack_target: true }, "反攻战略", "需战争进程 + 有反攻目标")
eq(alM, { cards_in_hand: 2 }, "事件战略", "cards<3 (war-progress 条件 cards>=3 失败)")
eq(alM, { al_M_B_needs_war_progress: false }, "南太平洋战略", "roll<=4", 0)
eq(alM, { al_M_B_needs_war_progress: false }, "中太平洋战略", "roll 5..7", 5)
eq(alM, { al_M_B_needs_war_progress: false }, "DEI战略", "roll==8", 8)
eq(alM, { al_M_B_needs_war_progress: false }, "CBI战略", "roll==9", 9)

// ---- AL 晚期 (页9 / py evaluate_late L720-743) ------------------------------
const alL = T.al_late
eq(alL, { can_pass: true }, "PASS", "can_pass")
eq(alL, { al_L_B_is_turn_12: true, cards_in_hand: 2, al_L_F_controls_hex_within_8_tokyo: false }, "重返菲律宾", "第12回合直接跳到F", 2)
eq(alL, { al_L_D_has_strategic_bombing_base: false }, "占领轰炸基地", "无轰炸基地")
eq(alL, { al_L_D_has_strategic_bombing_base: true, al_L_E_all_b29_on_base: false }, "推进B29", "B29 未全在基地")
eq(alL, { al_L_D_has_strategic_bombing_base: true, al_L_E_all_b29_on_base: true, al_L_F_controls_hex_within_8_tokyo: false }, "重返菲律宾", "距东京8内无控制 roll<=2", 2)
eq(alL, { al_L_D_has_strategic_bombing_base: true, al_L_E_all_b29_on_base: true, al_L_F_controls_hex_within_8_tokyo: false }, "跳岛作战", "roll 3..5", 5)
eq(alL, { al_L_D_has_strategic_bombing_base: true, al_L_E_all_b29_on_base: true, al_L_F_controls_hex_within_8_tokyo: false }, "轮流战略", "roll>=6", 8)
eq(alL, { al_L_D_has_strategic_bombing_base: true, al_L_E_all_b29_on_base: true, al_L_F_controls_hex_within_8_tokyo: true, al_L_G_meets_atomic_bomb_criteria: true }, "原子弹胜利", "原子弹标准达成")
eq(alL, { al_L_D_has_strategic_bombing_base: true, al_L_E_all_b29_on_base: true, al_L_F_controls_hex_within_8_tokyo: true, al_L_G_meets_atomic_bomb_criteria: false }, "登陆日本", "默认回退")

// ---- 默认 ctx 每(角色,阶段)必有输出 (对齐 py self-test L1371-1374) ----------
for (const [name, fn] of [["jp_early", T.jp_early], ["jp_mid", T.jp_mid], ["jp_late", T.jp_late],
                           ["al_early", T.al_early], ["al_mid", T.al_mid], ["al_late", T.al_late]]) {
    const out = fn(defaults(), 0)
    assert(out, `${name} 默认 ctx 决策无输出`)
    count++
}

console.log(`ERASMUS PDF decision-axis golden paths: ${count} cases passed`)
