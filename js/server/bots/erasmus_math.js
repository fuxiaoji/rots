// 期望战斗数学 (Expected Battle Math) — erasmus-v2-opt 研究层。
// 与引擎结算(offensive.js)表值/语义对齐的解析近似, 为目标评分与编队边际效用提供
// 单调一致的概率估计: 兵力↑ → P(win)↑; 守军↑/地形险 → P(win)↓。
// 地面胜负判定(apply_ground_winner 3246): 受损单位数多者胜(单伤 dmg>=4 计 2);
// 海空战胜负(apply_naval_winner 3124): 力量比较 + air cover 判定, 无掷骰。
"use strict"

// 表值与 offensive.js:2518/2528 完全一致
function em_ground_table(roll) { return roll < 3 ? 0.5 : roll < 7 ? 1 : roll < 9 ? 1.5 : 2 }
function em_naval_table(roll) { return roll < 3 ? 0.25 : roll < 6 ? 0.5 : 1 }

// 地形修正 (get_ground_roll_modifiers 2656-2668): JUNGLE=2, MIXED=3, MOUNTAIN=4
function em_terrain_mods(targetHex) {
    if (typeof get_map_data !== "function") return 0
    const t = get_map_data(targetHex).terrain
    return t === 2 ? -1 : t === 3 ? -2 : t === 4 ? -3 : 0
}

// 期望命中 = (1/10) Σ ceil(cf × table(r + mod)) (execute_attack 2756)
function em_expected_hits(cf, mods, ground) {
    if (!(cf > 0)) return 0
    const table = ground ? em_ground_table : em_naval_table
    let s = 0
    for (let r = 0; r < 10; r++) s += Math.ceil(cf * table(r + mods))
    return s / 10
}

// 受损单位数估计: 引擎 fill_hit_able_units 2592 — lf <= 命中数 的单位可被标记受损。
function em_damaged_estimate(hits, lfs) {
    let n = 0
    for (const lf of lfs) if (lf > 0 && hits >= lf) n++
    return n
}

// 歼灭估计: 同一单位需累计 dmg>2(≈3×lf 命中)才被消灭 (apply_loss)。
function em_eliminated_estimate(hits, lfs) {
    let n = 0
    for (const lf of lfs) if (lf > 0 && hits >= 3 * lf) n++
    return n
}

// 计划阶段地面战斗修正估计 (get_ground_roll_modifiers 2632-2683)。
// opts: {attAir, attNaval, defAir, defNaval, amphibious, attacker(faction), targetHex}
function em_ground_mods(opts) {
    let att = 0, def = 0
    if (opts.attAir && !opts.defAir) att += 2
    if (opts.attNaval && !opts.defNaval) att += 2
    att += em_terrain_mods(opts.targetHex)
    if (opts.amphibious) def += 3 // 2670: 两栖强攻守方掷骰+3
    try {
        if (typeof ARMOR_BRIGADE !== "undefined" && G.location[ARMOR_BRIGADE] === opts.targetHex) {
            if (opts.attacker === AP) att += 1; else def += 1 // 2674: 装甲旅(AP, 攻防均+1)
        }
        if (1 - opts.attacker === JP && typeof is_event_active === "function"
            && typeof events !== "undefined" && is_event_active(events.NEW_OPERATION_PLAN)
            && get_map_data(opts.targetHex).island) def += 1 // 2678: 新作战计划岛屿防守
    } catch (e) { /* 事件层不可用时忽略 */ }
    return { att, def }
}

// 地面战斗期望结果。args: {attCF, defCF, attMods, defMods, attLfs[], defLfs[]}
// 返回 {pWin, eOwnDamaged, eEnemyDamaged, eOwnElim, eEnemyElim, eOwnHits, eEnemyHits}
function em_ground_outcome(args) {
    const zero = { pWin: 0, eOwnDamaged: 0, eEnemyDamaged: 0, eOwnElim: 0, eEnemyElim: 0, eOwnHits: 0, eEnemyHits: 0 }
    if (!(args.attCF > 0)) return zero
    if (!(args.defCF > 0)) return { pWin: 1, eOwnDamaged: 0, eEnemyDamaged: 0, eOwnElim: 0, eEnemyElim: 0, eOwnHits: 0, eEnemyHits: 0 }
    let win = 0, od = 0, ed = 0, oe = 0, ee = 0, oh = 0, eh = 0
    for (let ra = 0; ra < 10; ra++) {
        for (let rd = 0; rd < 10; rd++) {
            const ha = Math.ceil(args.attCF * em_ground_table(ra + args.attMods))
            const hd = Math.ceil(args.defCF * em_ground_table(rd + args.defMods))
            const dmgA = em_damaged_estimate(hd, args.attLfs)
            const dmgD = em_damaged_estimate(ha, args.defLfs)
            const elimA = em_eliminated_estimate(hd, args.attLfs)
            const elimD = em_eliminated_estimate(ha, args.defLfs)
            // apply_ground_winner: 受损数比较 或 守方地面清空(近似: 守方全部可歼灭)
            const winThis = dmgD > dmgA || (args.defLfs.length > 0 && elimD >= args.defLfs.length)
            if (winThis) win++
            od += dmgA; ed += dmgD; oe += elimA; ee += elimD; oh += ha; eh += hd
        }
    }
    return { pWin: win / 100, eOwnDamaged: od / 100, eEnemyDamaged: ed / 100,
        eOwnElim: oe / 100, eEnemyElim: ee / 100, eOwnHits: oh / 100, eEnemyHits: eh / 100 }
}

// 海空战胜负判定(确定性, apply_naval_winner 3124): 力量比较 + air cover。
// args: {attCF, defCF, attHasBr, defHasBr} → {pWin}
function em_naval_outcome(args) {
    if (!(args.defCF > 0)) return { pWin: 1 }
    if (!(args.attCF > 0)) return { pWin: 0 }
    const airCover = args.attHasBr || !args.defHasBr
    return { pWin: (args.attCF > args.defCF && airCover) ? 1 : 0 }
}

// 两栖登陆可行性闸门: 无海军护航必败(broken_aa); 有护航时海空战失利登陆部队不得参战
// (apply_naval_winner→ground_pbm), 守方掷骰+3。返回 {abort, reason, pNaval, pGround}。
function em_amphib_assessment(args) {
    // args: {attNavalCF, attNavalHasBr, defNavalCF, defNavalHasBr, attAirCF, defAirCF,
    //        attGroundCF, attGroundLfs[], defGroundCF, defGroundLfs[], targetHex}
    const navalCF = args.attNavalCF + args.attAirCF
    const defNavalTotal = args.defNavalCF + args.defAirCF
    const naval = em_naval_outcome({ attCF: navalCF, defCF: defNavalTotal,
        attHasBr: args.attNavalHasBr || args.attAirCF > 0, defHasBr: args.defNavalHasBr })
    const mods = em_ground_mods({ attacker: args.attacker, targetHex: args.targetHex,
        attAir: args.attAirCF > 0 || args.attNavalHasBr, attNaval: args.attNavalCF > 0,
        defAir: args.defAirCF > 0, defNaval: args.defNavalCF > 0, amphibious: true })
    const ground = em_ground_outcome({ attCF: args.attGroundCF, defCF: args.defGroundCF,
        attMods: mods.att, defMods: mods.def, attLfs: args.attGroundLfs, defLfs: args.defGroundLfs })
    // 引擎链: 海空战败 → 登陆部队不得参战 → 无地面会战 → 夺格失败; 概率上近似相乘。
    const pWin = naval.pWin * ground.pWin
    // [opt] 海空战优势边际: 引擎反应池(距离/编制细节)无法完全建模, 仅"力量多 1 点"
    // 的护航编队在 1943(联合舰队主力尚在)实测被反应舰队歼灭 → broken_aa/"could not
    // participate" + US_CASUALTIES(PW-1)。要求进攻方海空战力 ≥ margin × 防御方
    // (含反应)才放行登陆。margin 为注册参数, 仅 em_cfg 开启时生效。
    const margin = em_cfg() ? (Number(em_cfg().emAmphNavalMargin) || 1) : 1
    // [opt amph-quality] 无护航裸登陆只在实际存在敌方海空威胁(守军/反应)时才必败
    // (broken_aa 只在"守方海军在会战格+攻方无海军"时触发; 会战海空胜负也需双方有
    // 空海单位)。守军无海空时, 陆战队单独登陆是合法且常胜的 —— 旧口径一律 abort
    // 误杀大量空虚岛礁登陆。
    const noEscortAborts = defNavalTotal > 0
    let abort = false, reason = null
    if (!(navalCF > 0) && noEscortAborts) { abort = true; reason = "no-escort" }
    else if (navalCF > 0 && naval.pWin === 0) { abort = true; reason = "naval-unfavorable" }
    else if (navalCF > 0 && defNavalTotal > 0 && navalCF < margin * defNavalTotal) { abort = true; reason = "naval-margin" }
    else if (pWin < (em_cfg() ? em_cfg().emMinPWin : 0.30)) { abort = true; reason = "low-pwin" }
    return { abort, reason, pNaval: naval.pWin, pGround: ground.pWin, pWin }
}

// ============================================================================
// 决策函数: 目标价值 / 边际效用编队 / 焦点评分 (供 erasmus_ops.js 配置门控调用)
// ============================================================================

// 单位损失价值: cf 加权, 不可替换 ×1.5, CV ×1.4(空 cover 与 PW 引擎意义)。
function em_unit_loss_value(u) {
    const p = (typeof pieces !== "undefined" && pieces[u.id]) ? pieces[u.id] : u
    let v = Number(p.cf) || Number(u.cf) || 1
    if (p.notreplaceable) v *= 1.5
    if (typeof is_cv_unit === "function") { try { if (is_cv_unit(p)) v *= 1.4 } catch (e) {} }
    return v
}

// 目标战术价值 (role: "Japan"|"Allies")。资源格/城市/日本城市/PoW 配额加权;
// 具体系数为注册参数之外的固定研究常数, 消融经 flags 控制。
function em_target_value(role, hex) {
    if (!Number.isInteger(hex) || typeof get_map_data !== "function") return 1
    const md = get_map_data(hex)
    if (!md) return 1
    let v = 1
    if (md.named) v += 2
    if (md.city >= 1) v += 2
    if (md.city >= 2) v += 2 // JAPANESE_CITY: 驻军歼灭/本土威胁
    if (md.resource) v += (role === "Allies" ? 6 : 4) // 原子弹 ≤5 / VP ≤12 / 封锁判定
    try {
        const emc = em_cfg()
        if (emc && emc.allies_pow_quota && role === "Allies" && md.named
            && typeof G !== "undefined" && G && Array.isArray(G.capture)
            && Number(G.pow) > 0 && G.capture.length < Number(G.pow)) v += 4 // PoW 未达标: PW-1 风险
        if (emc && emc.allies_resource_raid && role === "Allies" && md.resource) v += 4
        if (emc && emc.japan_resource_defense && role === "Japan" && md.resource) v += 5
    } catch (e) { /* G 不可用时退化为基础价值 */ }
    return v
}

// 边际效用编队选择。ctx: {pool[view单位], committed[view单位], defenders[view单位],
// target, faction(0/1), role, landing(bool), requiresOccupation, suppress, damageLevel}
// 返回候选 id 或 null(无正效用候选, 调用方回退基线排序)。
function em_pick_taskforce_unit(ctx) {
    const emc = em_cfg()
    if (!emc) return null
    const cfOf = u => u.reduced ? (Number(u.rcf) || Math.ceil((Number(u.cf) || 0) / 2)) : (Number(u.cf) || 0)
    const lfOf = u => Number(u.lf) || Math.max(1, Math.ceil((Number(u.cf) || 1) / 3))
    const target = ctx.target
    const committed = ctx.committed || []
    const defenders = ctx.defenders || []
    const pool = ctx.pool || []
    if (!pool.length) return null
    const defGround = defenders.filter(u => u.class === "ground")
    const defGroundCF = defGround.reduce((s, u) => s + cfOf(u), 0)
    const defGroundLfs = defGround.map(lfOf)
    const hasCommittedAir = committed.some(u => u.class === "air")
    const hasCommittedNaval = committed.some(u => u.class === "naval")
    const attGround = committed.filter(u => u.class === "ground")
    const value = ctx.value || em_target_value(ctx.role, target)

    const outcomeFor = (groundUnits, airFlag, navalFlag) => {
        const attCF = groundUnits.reduce((s, u) => s + cfOf(u), 0)
        const mods = em_ground_mods({ attacker: ctx.faction, targetHex: target,
            attAir: airFlag || hasCommittedAir, attNaval: navalFlag || hasCommittedNaval,
            defAir: defenders.some(u => u.class === "air"), defNaval: defenders.some(u => u.class === "naval"),
            amphibious: !!ctx.landing })
        return em_ground_outcome({ attCF, defCF: defGroundCF, attMods: mods.att, defMods: mods.def,
            attLfs: groundUnits.map(lfOf), defLfs: defGroundLfs })
    }
    // suppress 类: 空海战力与所需伤害等级的覆盖率作为"成功度"代理。
    const asRatioFor = u => {
        const as = committed.filter(x => x.class === "air" || x.class === "naval").reduce((s, x) => s + cfOf(x), 0)
            + ((u && (u.class === "air" || u.class === "naval")) ? cfOf(u) : 0)
        const req = Math.max(1, Math.ceil((defGroundCF + defenders.filter(x => x.class !== "ground").reduce((s, x) => s + cfOf(x), 0)) / (ctx.damageLevel || 1)))
        return Math.min(1, as / req)
    }
    const baseOutcome = ctx.requiresOccupation ? outcomeFor(attGround, false, false) : null
    const baseScore = ctx.requiresOccupation ? baseOutcome.pWin : asRatioFor(null)
    let best = null, bestUtil = 1e-9
    for (const u of pool) {
        let util = 0
        if (ctx.requiresOccupation && u.class === "ground") {
            const oc = outcomeFor(attGround.concat([u]), false, false)
            util += emc.emWWin * value * (oc.pWin - baseOutcome.pWin)
            util -= emc.emWLoss * oc.eOwnHits / 10 * em_unit_loss_value(u) / Math.max(1, attGround.length + 1)
        } else if (ctx.requiresOccupation) {
            // 空海支援: 首个航空(br)/海军单位带来 +2 掷骰与护航/air cover 语义
            const isAir = u.class === "air", isNaval = u.class === "naval"
            const oc = outcomeFor(attGround, isAir, isNaval)
            util += emc.emWWin * value * (oc.pWin - baseOutcome.pWin)
            util -= emc.emWLoss * em_unit_loss_value(u) * 0.08
        } else {
            util += emc.emWWin * value * (asRatioFor(u) - baseScore)
            util -= emc.emWLoss * em_unit_loss_value(u) * 0.05
        }
        util -= emc.emWCost
        if (util > bestUtil) { bestUtil = util; best = u }
    }
    return best ? best.id : null
}

// 焦点评分: 链内未完成目标按 doctrine 权重 × 战术价值 × 可达性衰减重排。
// ctx: {role, pending:[{idx, meta}]} → 返回最佳 idx 或 null(调用方回退链首)。
function em_score_focus(role, pending) {
    const emc = em_cfg()
    if (!emc || !Array.isArray(pending) || !pending.length) return null
    let best = null, bestScore = -Infinity
    pending.forEach((p, order) => {
        const value = em_target_value(role, p.idx)
        const doctrine = Math.pow(emc.emDoctrineDecay, order)
        let reach = 1
        if (typeof get_distance === "function" && typeof eop_focus === "function") {
            // 距离衰减用当前焦点(链首)作参照, 避免远目标完全不可达却仍被选中
            const d = get_distance(p.idx, pending[0].idx)
            reach = Math.pow(emc.emScoreDistDecay, Math.max(0, d))
        }
        const score = doctrine * value * reach
        if (score > bestScore) { bestScore = score; best = p.idx }
    })
    return best
}

