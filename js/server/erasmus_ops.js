// 目标聚焦操作层 (Operational Target-Focus) — erasmus-v2.0-zh.6
//
// 与 erasmus_complete_ai_execution_engine.py 同源: 各战略的目标优先级表来自
// 伊拉斯谟 PDF 图表转录 (01/02/03/07/08/09 决策轴), 本文件把这些目标清单落成
// 可执行的主攻轴线 (convoy/岛链), 供:
//   1. js/server/bots/erasmus.js 在“选目标格/选进攻单位”时把行动聚焦到当前
//      轴线的最优先未夺目标 (消除到处乱打、无主线的空转攻势);
//   2. js/server/offensive.js 无头地面/海上推进的 target_score 就近目标转向
//      (让陆军/两栖部队沿主轴线推进, 而不是奔离轴的最近敌军)。
//
// 设计: 无跨窗口记忆 —— 每次调用按当前地图状态(G/控制位)重算“当前主轴”与
// “最优先未夺目标”。同闭包内共享, 引擎与 bot 都能调用 (function 声明提升)。
// 数字 token 按 hex id -> 内部 idx; 其余按地图 name 精确匹配 (+别名)。

var EOP_IDX_BY_NAME = null
const EOP_ALIASES = {
    "Sasebo": "Kynshu",          // 佐世保 = Kynshu (3307)
    "Timor": "Koepang",
    "Uluthi": "Ulithi",
    "Gili-Gili": "Gili Gili",
    "Buin": "Bougainville",      // 无独立 hex
    "Tinian": "Saipan",          // Saipan/Tinian 同格
    "New Hebrides": "Espiritu Santo",
    "Palau Islands": "Palau",
    "Noumea": null,              // 不在 1942-45 长剧本地图, 跳过
    "Salamaua": null,
    "Finschhafen": null,
}

const EOP_AXES = {
    // 盟军: 中太平洋主线 -> 马里亚纳 -> 硫磺岛/冲绳 -> 登陆日本。
    // 对应图表“中太平洋战略 / 跳岛作战 / 登陆日本”三张目标表按序拼接;
    // 每个命名格(或有名字的夺控格)被攻下即计入 PoW 的 G.capture。
    AP: {
        id: "AP_CENPAC_MAIN", role: "Allies",
        note: "中太平洋主线→日本 (Wake→Tarawa→Kwajalein→Eniwetok→Palau→Ulithi→Saipan→Iwo→Okinawa→日本本土)",
        tokens: ["Wake", "Tarawa", "Kwajalein", "Eniwetok", "Palau", "Ulithi",
                 "Saipan", "Iwo Jima", "Okinawa",
                 "Kynshu", "Tokyo", "Ominato", 3606, "Nagoya", "Kyoto", "Kure", "Osaka"],
    },
    // 日本: 南方资源夺控 (东印度/马来亚/菲律宾投降目标)。
    JP_RESOURCE: {
        id: "JP_SOUTH_RESOURCE", role: "Japan",
        note: "南方资源夺控 (东印度→马来亚→菲律宾, 至日本控制≥13资源)",
        tokens: ["Balikpapan", "Tarakan", "Batavia", "Tjilatjap", "Soerabaja",
                 "Bangka", "Palembang", "Medan",
                 "Kuantan", "Singapore",
                 "Manila", "Davao"],
    },
}

// ---- 地图名字 -> 内部 idx 一次性索引 --------------------------------------
function eop_ensure_name_index() {
    if (EOP_IDX_BY_NAME) return
    const m = {}
    if (typeof map === "undefined") { EOP_IDX_BY_NAME = m; return }
    for (let i = 0; i < map.length; i++) {
        const nm = map[i].name
        if (nm) m[nm.toLowerCase()] = (typeof hex_to_int === "function") ? hex_to_int(map[i].id) : null
    }
    EOP_IDX_BY_NAME = m
}

// 解析一个目标 token -> 内部 idx; 解析不到返回 null (调用方跳过, 不炸)。
function eop_resolve_token(token) {
    if (typeof token === "number") return (typeof hex_to_int === "function") ? hex_to_int(token) : null
    const t = String(token).trim()
    const num = t.match(/^(\d{4})$/)
    if (num) return (typeof hex_to_int === "function") ? hex_to_int(+num[1]) : null
    eop_ensure_name_index()
    const alias = Object.prototype.hasOwnProperty.call(EOP_ALIASES, t) ? EOP_ALIASES[t] : undefined
    if (alias === null) return null
    const key = (alias === undefined ? t : alias).toLowerCase()
    return EOP_IDX_BY_NAME[key] !== undefined ? EOP_IDX_BY_NAME[key] : null
}

// 回合级状态机外部链覆盖 (erasmus-v2.0-zh.7): erasmus_state.js 在 gate 开时于
// 每方首卡窗钉住整回合战略, 把该战略的优先目标链(epoch token 表)作为"外部主轴"
// 覆盖固定 EOP_AXES。gate 关时必须清空(否则同进程跨剧本串台)。
var EOP_OVERRIDE = { Japan: null, Allies: null }

function eop_set_strategy_chain(role, override) {
    EOP_OVERRIDE[role] = override || null
}
function eop_clear_all_chains() {
    EOP_OVERRIDE = { Japan: null, Allies: null }
}

// [opt] allies_resource_raid: 原子弹/封锁胜利的日本资源格 raid 链补充。
// 1942-45 剧本盟军唯一胜利 = 原子弹(victory_1945), 需日本控制资源 ≤5(或苏联已发生 ≤3)。
// 实测终局日本恒持 6-7 格(Kuantan/Seoul/Harbin/Mukden/Manila/Miri...)。本函数把
// "未控制且不在链上的日本资源格"按前沿距离追加到盟军当前战略链尾部(kind CONQUEST,
// requiresOccupation), 使编队在主轴目标完成后(或经 target_scoring 重排)发起两栖夺占。
// 触发条件: 日本资源 ≤ emRaidResTrigger(默认 7, 即距原子弹门槛 ≤2 格)。全部在
// em_cfg().allies_resource_raid 开关之后; 基线(配置关)不进本函数调用点。
function eop_append_resource_raid_targets() {
    const emcRR = (typeof em_cfg === "function") ? em_cfg() : null
    if (!emcRR || !emcRR.allies_resource_raid || emcRR.allies_blockade_v2) return  // v2 开启时由 eop_append_blockade_raid 接管(全量/无门槛)
    const ov = EOP_OVERRIDE.Allies
    if (!ov || !Array.isArray(ov.chain)) return
    let jpRes = 99
    if (typeof get_jp_resources === "function") { try { jpRes = get_jp_resources() } catch (e) { jpRes = 99 } }
    if (jpRes > (Number(emcRR.emRaidResTrigger) || 7)) return
    const inChain = new Set(ov.chain)
    const raids = []
    if (typeof RESOURCE_HEX !== "undefined" && Array.isArray(RESOURCE_HEX)) {
        for (const h of RESOURCE_HEX) {
            if (inChain.has(h)) continue
            const md = (typeof get_map_data === "function") ? get_map_data(h) : null
            if (!md || !md.resource) continue
            if (is_space_controlled(h, AP)) continue
            raids.push(h)
        }
    }
    if (!raids.length) return
    // 距当前焦点近者优先(逐格两栖推进可达性最高); 最多 emRaidMaxTargets(默认 3) 格。
    // 克隆 override, 不回写状态机缓存的 strategy(避免污染 esm 审计/延续判定)。
    const focus = eop_focus("Allies")
    const d = h => (focus !== null && typeof get_distance === "function") ? get_distance(h, focus) : 0
    raids.sort((a, b) => d(a) - d(b) || a - b)
    const picked = raids.slice(0, Math.max(1, Number(emcRR.emRaidMaxTargets) || 3))
    const meta = Array.isArray(ov.targetMeta) ? ov.targetMeta.slice() : []
    for (const h of picked) {
        const at = meta.findIndex(t => t.hex === h)
        if (at >= 0) meta.splice(at, 1)
        meta.push({ hex: h, kind: "CONQUEST", requiresOccupation: true, damageLevel: 1,
            objective: "资源 raid: 压低日本资源至原子弹/封锁门槛" })
    }
    EOP_OVERRIDE.Allies = Object.assign({}, ov, { chain: ov.chain.concat(picked), targetMeta: meta })
}

// [opt allies_blockade_v2] 资源封锁主路(规则 16.47 trace 胜利): 上一轮 raid(emRaidResTrigger/
// emRaidMaxTargets 门槛)只把资源格追加到链尾, 实测终局日本仍恒持 6 格。v2 改为:
//   (a) 无触发门槛、无数量上限 —— 所有非 AP 控制的资源格(RESOURCE_HEX, data_map 14 格)以
//       CONQUEST requiresOccupation damageLevel:1 加入盟军链, 插在链首至多 emBlkInsAfterPending
//       个 pending 夺占目标之后(不占绝对首位 —— PoW/progress/封锁环 overlay 在其前仍会重排);
//   (b) 已 AP 控制的资源格改为 GARRISON garrisonClass:"ground" 驻守元数据(防基线日本沿
//       JP_RESOURCE 轴夺回) —— GARRISON pending 条件=己控且地面步数 < emBlkGarrisonSteps,
//       激活窗按 eop_activation_focus_faction 的 projected 驻军逻辑补兵, 推进/焦点亦指向该格。
// 克隆 override 不回写状态机缓存(与既有 raid 相同); 基线(v2 关)不进本函数调用点。
function eop_append_blockade_raid() {
    const emcBR = (typeof em_cfg === "function") ? em_cfg() : null
    if (!emcBR || !emcBR.allies_blockade_v2) return false
    const ov = EOP_OVERRIDE.Allies
    if (!ov || !Array.isArray(ov.chain)) return false
    if (typeof RESOURCE_HEX === "undefined" || !Array.isArray(RESOURCE_HEX)) return false
    const inChain = new Set(ov.chain)
    const meta0 = Array.isArray(ov.targetMeta) ? ov.targetMeta : []
    const focus = eop_focus("Allies")
    // 排序键: 距盟军地面前沿(有地面单位可达性)近者优先 —— 焦点距在链空时为 null,
    // 用 esm_front_distance(与封锁环 overlay 同源)比"距旧焦点"更能反映两栖可达性。
    const d = h => {
        if (typeof esm_front_distance === "function") {
            try { return esm_front_distance(h, AP) } catch (e) { /* 回退 */ }
        }
        return (focus !== null && typeof get_distance === "function") ? get_distance(h, focus) : 0
    }
    const conquests = [], garrisons = []
    for (const h of RESOURCE_HEX) {
        if (!(h >= 0 && h <= LAST_BOARD_HEX)) continue
        const md = (typeof get_map_data === "function") ? get_map_data(h) : null
        if (!md || !md.resource) continue
        if (is_space_controlled(h, AP)) {
            const existing = meta0.find(t => t.hex === h)
            // 已有同格 GARRISON 且驻军已满(含链上已有)则不重复; 未驻满(或仅 CONQUEST 残留)则补 GARRISON。
            if (existing && existing.kind === "GARRISON" && inChain.has(h)
                && !eop_target_pending("Allies", h, existing)) continue
            garrisons.push(h)
        } else if (!inChain.has(h)) {
            conquests.push(h)
        }
    }
    // [allies_blockade_v2 段2] 满洲通路切断: 南方三格(304 Kuantan, 421 Miri, 535 Manila)已 AP
    // 控制且满洲/朝鲜(669 Harbin, 670 Mukden, 672 Seoul)仍有 JP 控制时, 把朝鲜陆桥唯一海跳
    // 港 Pusan(673, id 3306)加入 CONQUEST —— Pusan 为敌控后 trace 的 oversea→land 渡转
    // (supply.js: "MD.port && !enemy_port")被禁, Seoul/Mukden/Harbin 陆网整断; Seoul 672 本身
    // 是资源格(己在 RESOURCE_HEX raid 集内)。turn ≥ emBlkManchCutTurn 才启用(早期兵力不外调)。
    if (G.turn >= (Number(emcBR.emBlkManchCutTurn) || 5)) {
        const southHeld = [304, 421, 535].every(h => is_space_controlled(h, AP))
        const northJp = [669, 670, 672].some(h => is_space_controlled(h, JP))
        if (southHeld && northJp) {
            const pusan = (typeof eop_resolve_token === "function") ? eop_resolve_token("Pusan") : null
            if (pusan !== null && pusan !== undefined && pusan >= 0 && pusan <= LAST_BOARD_HEX
                && is_space_controlled(pusan, JP) && !inChain.has(pusan)) {
                conquests.push(pusan)
                if (typeof process !== "undefined" && process.env.EOTS_SW_DEBUG)
                    console.log(`[BLK] T${G.turn} manchuria-cut: Pusan(${pusan}) 加入通路切断目标`)
            }
        }
    }
    if (!conquests.length && !garrisons.length) return false
    conquests.sort((a, b) => d(a) - d(b) || a - b)
    garrisons.sort((a, b) => d(a) - d(b) || a - b)
    // 插入点: 链首连续 pending 夺占/压制目标计满 emBlkInsAfterPending(默认 2)个为止。
    let ins = 0
    const cap = Math.min(Number(emcBR.emBlkInsAfterPending) || 2, ov.chain.length)
    for (let i = 0; i < cap; ++i) {
        const m = meta0.find(t => t.hex === ov.chain[i])
        if (m && m.kind !== "GARRISON" && m.kind !== "REDEPLOY"
            && eop_target_pending("Allies", ov.chain[i], m)) ins = i + 1
        else break
    }
    const meta = meta0.slice()
    const newHexes = []
    for (const h of conquests) {
        const at = meta.findIndex(t => t.hex === h)
        if (at >= 0) meta.splice(at, 1)
        meta.push({ hex: h, kind: "CONQUEST", requiresOccupation: true, damageLevel: 1,
            objective: "封锁 raid: 夺占日本资源格(16.47 trace 断链胜利主路)",
            victoryConstraint: "JAPAN_RESOURCE_BLOCKADE" })
        newHexes.push(h)
    }
    const garrisonSteps = Math.max(1, Number(emcBR.emBlkGarrisonSteps) || 1)
    for (const h of garrisons) {
        const at = meta.findIndex(t => t.hex === h)
        if (at >= 0) meta.splice(at, 1)
        meta.push({ hex: h, kind: "GARRISON", garrisonClass: "ground",
            garrisonRequirement: { groundSteps: garrisonSteps },
            objective: "封锁驻守: 地面驻军防日本夺回资源格",
            victoryConstraint: "JAPAN_RESOURCE_BLOCKADE_HOLD" })
        newHexes.push(h)
    }
    const chain = ov.chain.slice()
    chain.splice(Math.min(ins, chain.length), 0, ...newHexes)
    EOP_OVERRIDE.Allies = Object.assign({}, ov, { chain, targetMeta: meta })
    if (typeof process !== "undefined" && process.env.EOTS_SW_DEBUG) {
        const postFocus = eop_focus("Allies")
        const nm = h => { try { return get_map_data(h).name || int_to_hex(h) } catch (e) { return String(h) } }
        console.log(`[BLK] T${G.turn} raid+=${conquests.length} garrison=${garrisons.length} ins=${ins} chain=${chain.slice(0, 6).map(nm).join(">")} preFocus=${focus} postFocus=${postFocus}${postFocus !== null ? "(" + nm(postFocus) + ")" : ""} jpRes=${(typeof get_jp_resources === "function") ? get_jp_resources() : "?"}`)
    }
    return true
}

// 当前主轴的完整目标链。外部链覆盖(erasmus_state)直接携带已解析好的有序 idx
// chain(=parse_goals 全部 hex, 忠实 py target_chain), 不走 token 二次解析;
// 默认 EOP_AXES 走 name/4-digit token -> idx。
function eop_axis_chain(role) {
    const axis = eop_axis(role)
    if (!axis) return []
    if (Array.isArray(axis.chain) && axis.chain.length) return axis.chain.slice()
    const out = []
    for (const tk of axis.tokens) {
        const idx = eop_resolve_token(tk)
        if (idx !== null && !out.includes(idx)) out.push(idx)
    }
    return out
}

// 该方当前应当遵循的主轴; 无主轴(如日本资源已足、转入防守)返回 null。
function eop_axis(role) {
    const ov = EOP_OVERRIDE[role]
    // 状态机显式给出一个战略时，即使其目标链为空（事件、已完成驻军、暂时没有本州
    // 登陆部队），也必须阻断旧的默认资源轴。旧判断会把空链战略悄悄替换成 JP_RESOURCE。
    if (ov) {
        return { id: ov.name || (role + "_AXIS"), role: role,
            note: ov.note ? `${ov.name} — ${ov.note}` : (ov.name || role + "轴"),
            kind: ov.kind || null, tokens: ov.tokens || [], chain: ov.chain || [], targetMeta: ov.targetMeta || [] }
    }
    if (role === "Allies") return EOP_AXES.AP
    // 日本: 控制资源 < 13 时抢南方资源; 达标后转入防守, 不再无谓远征。
    let jpRes = 99
    if (typeof get_jp_resources === "function") {
        try { jpRes = get_jp_resources() } catch (e) { jpRes = 99 }
    }
    if (jpRes < 13) return EOP_AXES.JP_RESOURCE
    return null
}

// 该方最优先的“未夺控”目标 (轴线链首)。链首已控则顺延到下一个, 即
// “目标达成前不换目标”——达成(夺控)才放行下一目标。
// role: "Japan" | "Allies" (或 faction 数值 0/1)。
function eop_focus(role) {
    if (typeof G === "undefined" || !G || !G.supply_cache) return null
    // [opt] target_scoring: 收集链内未完成的夺占类目标, 按价值×可达性评分选择;
    // 配置关闭时控制流与基线完全一致。
    const emc = (typeof em_cfg === "function") ? em_cfg() : null
    const emScore = !!(emc && emc.target_scoring && typeof em_score_focus === "function")
    const emPending = emScore ? [] : null
    const faction = role === "Japan" ? JP : role === "Allies" ? AP : role
    const mine = faction === JP ? JP : AP
    for (const idx of eop_axis_chain(mine === JP ? "Japan" : "Allies")) {
        if (idx < 0 || idx > LAST_BOARD_HEX) continue
        const meta = eop_target_meta(mine === JP ? "Japan" : "Allies", idx)
        if (meta) {
            if (eop_target_pending(mine === JP ? "Japan" : "Allies", idx, meta)) {
                if (emScore) { emPending.push({ idx, meta }); continue }
                return idx
            }
            continue
        }
        // 压制目标的完成条件是敌方 AZOI 不再覆盖该格，并非必须夺取控制权。
        // 因此 Jolo 即便仍由盟军控制，只要覆盖它的航空/航母 ZOI 已被消灭，就应顺延
        // 到 Makassar；夺占类目标仍严格以控制权为完成条件。
        if (meta && (meta.kind === "SUPPRESS" || meta.kind === "SUPPRESS_HQ")) {
            // 开局马尼拉采用图表脚注允许的“占领基地以压制 HQ”。在真正夺占前
            // 不能仅因某一编队进入/临时消除 AZOI 就把整支任务部队切到下一目标。
            if (meta.requiresOccupation && !is_space_controlled(idx, mine)) return idx
            if (typeof has_zoi === "function" && has_zoi(idx, 1 - mine)) return idx
            continue
        }
        // 最终国防圈[2]：只考虑仍由日本控制的地点。己控地点必须有对应兵种驻军；
        // 敌控地点既不算完成条件，也不转化成夺回目标。
        if (meta && meta.kind === "GARRISON") {
            if (!is_space_controlled(idx, mine)) continue
            const required = meta.garrisonClass || "ground"
            let occupied = false
            for (let u = 1; u < pieces.length; ++u) {
                const p = pieces[u]
                if (p && p.faction === mine && p.class === required && G.location[u] === idx) { occupied = true; break }
            }
            if (!occupied) return idx
            continue
        }
        if (!is_space_controlled(idx, mine)) {
            if (emScore) { emPending.push({ idx, meta }); continue }
            return idx
        }
    }
    if (emScore && emPending.length) {
        const picked = em_score_focus(mine === JP ? "Japan" : "Allies", emPending)
        if (picked !== null && picked !== undefined) return picked
    }
    return null
}
function eop_focus_faction(faction) {
    return eop_focus(faction === JP ? "Japan" : faction === AP ? "Allies" : faction)
}

// ---- 选目标格 (action_hex 参数) ------------------------------------------
// [opt island_sweep 段3] 申报窗多焦点: 焦点格已宣战后, EC 牌(不限 1 个新战斗格)
// 自动向岛群簇内下一个“有敌军格”申报第二战斗格 —— 同回合多路会战 → 多路夺格。
// OC 牌(new_battle_allowed 限 1)与焦点未宣时返回 undefined, 走基线 eop_pick_action_hex。
function eop_pick_declare_hex(candidates, role) {
    const emc = (typeof em_cfg === "function") ? em_cfg() : null
    if (!emc || !(emc.island_sweep || emc.erasmus_plus)) return undefined
    if (!Array.isArray(candidates) || !candidates.length) return undefined
    if (typeof G === "undefined" || !G || !G.offensive) return undefined
    let multiAllowed = false
    try { multiAllowed = G.offensive.type !== OC } catch (e) { multiAllowed = false }
    if (!multiAllowed) return undefined
    const focus = eop_focus(role)
    if (focus === null) return undefined
    try { if (!(typeof set_has === "function" && set_has(G.offensive.battle_hexes, focus))) return undefined } catch (e) { return undefined }
    const mine = role === "Japan" ? JP : AP
    if (typeof eop_island_cluster !== "function") return undefined
    const cluster = new Set(eop_island_cluster(role, focus))
    const hasEnemy = h => { try { return is_faction_units(h, 1 - mine) } catch (e) { return false } }
    // 只在簇内有敌军格时多开第二战斗格; 簇外格交回基线选格(不扩散申报范围)。
    let best = null, bestScore = null
    for (const h of candidates) {
        if (!cluster.has(h) || !hasEnemy(h)) continue
        const d = typeof get_distance === "function" ? get_distance(h, focus) : Math.abs(h - focus)
        const score = [d, h]
        if (bestScore === null || score[0] < bestScore[0]
            || (score[0] === bestScore[0] && score[1] < bestScore[1])) { best = h; bestScore = score }
    }
    return best !== null ? best : undefined
}

// ---- 选目标格 (action_hex 参数) ------------------------------------------
// 优先当前焦点; 焦点不可达时, 在候选里选距离焦点最近的格(逐步靠近主轴),
// 而不是随机散打。无焦点(= 无主轴或主轴已全达成)时返回 undefined 让原逻辑决定。
function eop_pick_action_hex(candidates, role) {
    if (!Array.isArray(candidates) || candidates.length === 0) return undefined
    const focus = eop_focus(role)
    if (focus === null) return undefined
    let best = null, bestD = Infinity
    for (const h of candidates) {
        let d
        if (h === focus) d = 0
        else if (typeof get_distance === "function") d = get_distance(h, focus)
        else d = Math.abs(h - focus)
        if (d < bestD || (d === bestD && (best === null || h < best))) { bestD = d; best = h }
    }
    return best !== null ? best : undefined
}

// [opt island_sweep 段2] 簇分流选点: 在焦点 focusHex 的岛群簇内挑下一个可编组
// “海陆同港对”的次级登陆格(已宣战/已有己方地面/无护航可会合的簇格跳过)。
// 返回 hex 或 null。第 k 支护航+地面编组自然对应第 k 个仍可编组的簇格 —— 已落格
// 被过滤, 同格海陆编组语义由 composeTaskForce 合成 meta(夺占)与 headless 同格
// 分组保证。
function eop_pick_cluster_landing(role, view, available, focusHex, dbg) {
    const emc = (typeof em_cfg === "function") ? em_cfg() : null
    if (!emc || !emc.island_sweep) return null
    if (!Array.isArray(available) || !Number.isInteger(focusHex)) return null
    if (typeof eop_island_cluster !== "function") return null
    const dlog = dbg && typeof process !== "undefined" && process.env.EOTS_SW_DEBUG ? line => console.log(`[SW] ${line}`) : null
    if (dlog) {
        const cluster = eop_island_cluster(role, focusHex)
        dlog(`clusterLanding role=${role} focus=${focusHex} avail=${available.length} cluster=[${cluster.join(",")}]`)
    }
    for (const ch of eop_island_cluster(role, focusHex)) {
        try {
            if (G.offensive && typeof set_has === "function" && set_has(G.offensive.battle_hexes, ch)) { if (dlog) dlog(`  hex=${ch} skip battleHexes`); continue }
            let ownGround = false
            for (let u = 1; u < pieces.length; ++u) {
                const p = pieces[u]
                if (p && p.faction === (role === "Japan" ? JP : AP) && p.class === "ground" && G.location[u] === ch) { ownGround = true; break }
            }
            if (ownGround) { if (dlog) dlog(`  hex=${ch} skip ownGround`); continue }
        } catch (e) { /* 状态不可用则照常尝试编组 */ }
        if (typeof eop_landing_no_escort_for === "function" && eop_landing_no_escort_for(role, view, ch)) { if (dlog) dlog(`  hex=${ch} skip noEscort`); continue }
        const plan = composeTaskForce(ch, null, null, view, available, role, { requiresOccupation: true, islandCluster: true })
        if (dlog) dlog(`  hex=${ch} plan complete=${plan.complete} unit=${plan.unit}`)
        if (!plan.complete && plan.unit !== undefined && plan.unit !== null) return ch
    }
    return null
}

// ---- 选进攻/激活单位 ------------------------------------------------------
// 敌方单位落点(任意军种), 供"靠前线"就近打分; 引擎未提供迭代器时退化为直接扫 pieces。
function eop_enemy_locs(mine) {
    if (typeof G === "undefined" || !G || !G.location) return []
    const enemy = mine === JP ? AP : JP
    const out = []
    for (let u = 1; u < pieces.length; u++) {
        const p = pieces[u]
        if (!p || p.faction !== enemy) continue
        const h = G.location[u]
        if (h >= 0 && h <= LAST_BOARD_HEX) out.push(h)
    }
    return out
}
function eop_min_dist(hex, locs) {
    if (typeof get_distance !== "function" || !locs.length) return 99
    let best = 99
    for (let i = 0; i < locs.length; i++) {
        const d = get_distance(hex, locs[i])
        if (d < best) best = d
    }
    return best
}

// 进攻单位/会战申报单位: 主键 = 到最近敌单位的距离(越靠前线, 激活后当回合即可开战夺格,
// 而非空跑一整轮又无会战可报), 次键 = 到焦点距离(保留战略方向)。此前只按"距焦点最近"
// 挑单位, 而焦点(如拉包尔)常远在战线后方, 挑出的单位离任何敌军都远 → 移动后够不着敌格
// → ~半攻势"Confirm offensive"直接跳过会战 → 每回合夺格数远低于 PoW 所需 4。
function eop_pick_unit(candidates, role, activeUnits, focusOverride) {
    if (!Array.isArray(candidates) || candidates.length === 0) return undefined
    const focus = Number.isInteger(focusOverride) ? focusOverride : eop_focus(role)
    if (typeof G === "undefined" || !G || !G.location) return undefined
    const mine = role === "Japan" ? JP : AP
    const axis = eop_axis(role)
    const focusMeta = focus === null ? null : eop_target_meta(role, focus)
    candidates = candidates.filter(u=>eop_unit_matches_target(u,role,focusMeta,focus))
    if (!candidates.length) return undefined
    if (focus !== null && axis && (axis.kind === "GARRISON" || axis.kind === "DEFEND")) {
        const required = focusMeta && focusMeta.kind === "GARRISON" && !focusMeta.garrisonRequirement ? (focusMeta.garrisonClass || "ground") : null
        const home = candidates.filter(u => {
            const p = pieces[u], h = G.location[u], md = h >= 0 && h <= LAST_BOARD_HEX ? get_map_data(h) : null
            if (!p || p.faction !== mine || !md) return false
            if (required) return p.class === required
            return md.region === "Japan" && (p.class === "ground" || p.class === "air" || p.class === "naval")
        })
        if (home.length) {
            const cls = p => axis.kind === "DEFEND" ? (p.class === "ground" ? 0 : p.class === "air" ? 1 : 2) : 0
            home.sort((a, b) => cls(pieces[a]) - cls(pieces[b])
                || get_distance(G.location[a], focus) - get_distance(G.location[b], focus)
                || (Number(pieces[b].cf) || 0) - (Number(pieces[a].cf) || 0) || a - b)
            return home[0]
        }
        // 本土防御没有合适单位时宁可不选，也不能退回最近敌军/南方资源轴。
        return undefined
    }
    const enemyLocs = eop_enemy_locs(mine)
    const activated = Array.isArray(activeUnits) ? activeUnits : []
    // 两栖登陆护航 (TF_FORMATIONS「带海上/带航空海上支援的登陆」至少 1 海军单位):
    // 敌占港口/岛屿格的两栖夺控若不带海军护航, 引擎 broken_aa 会
    // “Amphibious Assault failed due to lack of naval escort” 把登陆部队打回吃损失。
    // 只在激活窗启用(调用方传入 activeUnits), 且仅完整全图剧本(gate on) —— SP/Burma
    // 子图剧本保持 zh.6 行为不变(golden 不动)。
    const mdFocus = (focus !== null && typeof get_map_data === "function") ? get_map_data(focus) : null
    // 敌占或空敌控港口都算"需两栖登陆": 即使当前格无敌军, 敌方反应(Intercept)仍可能
    // 把海军调进来, 无护航的登陆照样在会战判 "Amphibious Assault failed"。故只在
    // "未控制港口"即触发护航, 不要求格内有敌军。
    const landing = Array.isArray(activeUnits) && focus !== null && !is_space_controlled(focus, mine)
        && mdFocus && mdFocus.port
        && (typeof esm_gate_on === "function" ? esm_gate_on() : false)
    const actNaval = activated.find(u => pieces[u] && pieces[u].class === "naval")
    const groundCandLocs = new Set()
    for (const u of candidates) { const p = pieces[u]; if (p && p.class === "ground") groundCandLocs.add(G.location[u]) }

    // 1) 先补海军护航: 只补与地面候选同格的海军(无头推进把同格海陆编成同组一起上岛)。
    //    非同格海军补了也白补 —— 无头推进按“同格编组”, 非同格海军会单独一组, 而纯海军组
    //    只能攻“敌海军格”(headless_target_score), 够不着只守地面的敌港, 地面仍无护航吃失败。
    if (landing && !actNaval) {
        // [opt taskforce_math] 目标格被敌非中立 ZOI 覆盖时, 编组须含 br∈[1,5] 航母/舰载:
        // set_zoi(supply.js:223) 中 0<br<6 单位半径2内设置 JP_ZOI_NTRL 中和敌方 ZOI,
        // 否则海军移路被敌 ZOI 阻断、登陆吃 broken_aa。中和舰优先于普通护航。
        const emcZE = (typeof em_cfg === "function") ? em_cfg() : null
        const zoiBlocked = !!(emcZE && emcZE.taskforce_math && typeof has_non_n_zoi === "function"
            && has_non_n_zoi(focus, 1 - mine))
        const neutralizes = u => { const p = pieces[u]; const br = Number(p && p.br) || 0; return br >= 1 && br < 6 }
        let best = null
        for (const u of candidates) {
            const p = pieces[u]
            if (p && p.class === "naval" && groundCandLocs.has(G.location[u])) {
                if (best === null) { best = u; continue }
                if (zoiBlocked && neutralizes(u) !== neutralizes(best)) { if (neutralizes(u)) best = u; continue }
                if (u < best) best = u
            }
        }
        if (best !== null) return best
        // 海军不必与登陆军出发时同格：它可以从另一基地移动到同一战斗格提供
        // 护航/海上支援。无头执行器会分别移动编队，再在同一格合并会战。
        const naval = candidates.filter(u => pieces[u] && pieces[u].class === "naval")
        naval.sort((a, b) => (zoiBlocked && (neutralizes(b) ? 0 : 1) - (neutralizes(a) ? 0 : 1)) || 0
            || get_distance(G.location[a], focus) - get_distance(G.location[b], focus)
            || (Number(pieces[b].cf) || 0) - (Number(pieces[a].cf) || 0) || a - b)
        if (naval.length) return naval[0]
    }

    const fd = h => (focus === null ? 99 : (typeof get_distance === "function") ? get_distance(h, focus) : Math.abs(h - focus))
    const scored = []
    for (const u of candidates) {
        const loc = G.location[u]
        if (!(loc >= 0 && loc <= LAST_BOARD_HEX)) continue
        scored.push([u, eop_min_dist(loc, enemyLocs), fd(loc)])
    }
    if (!scored.length) return undefined
    // 图表已经给出当前目标时，编队必须先围绕该目标组织；旧排序把“离任意敌军最近”
    // 放在首键，导致马尼拉为焦点时仍不断激活靠近婆罗洲小据点的单位。只有无明确
    // 目标（事件/一般前推）时才采用最近敌军排序。
    if (focusMeta) scored.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0])
    else scored.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0])
    // B: 焦点是敌占格(需“夺占”而非纯消耗)时, 若候选里有“到最近敌军距离”不比最优单位远太多的
    // 两栖地面(海军陆战队 asp / 可战略海运 strat_move), 优先选它组成登陆力量 —— 否则每次
    // 攻势总挑最近敌军的纯空/海军, 只会对岛屿做远距空袭, 永远无法登岛占格。
    // 只在 node 端用环境开关做 A/B; 浏览器 PvE(process 未定义)时默认开启该偏置。
    const biasOn = (typeof process === "undefined") || process.env.B_BIAS !== "0"
    if (biasOn && focus !== null && !is_space_controlled(focus, mine)) {
        const refD = scored[0][1]
        const cap = focusMeta ? Infinity : Math.max(3, refD + 3)
        const isGroundLanding = u => { const p = pieces[u]; return p && p.class === "ground" && (p.asp || p.strat_move) }
        // 登陆且已有海军护航时, 优先选与任一已激活海军同格的地面(编成同组一起上岛),
        // 避免海陆分处两格导致地面单独硬登陆。
        let pick = null
        if (landing && actNaval) {
            const escortLocs = new Set()
            for (const u of activated) { const p = pieces[u]; if (p && p.class === "naval") escortLocs.add(G.location[u]) }
            pick = scored.find(([u, ed]) => ed <= cap && escortLocs.has(G.location[u]) && isGroundLanding(u))
        }
        if (!pick) pick = scored.find(([u, ed]) => ed <= cap && isGroundLanding(u))
        if (pick) return pick[0]
    }
    return scored[0][0]
}

// 两栖登陆无护航可用 → 阻断硬登陆 (TF_FORMATIONS「无支援登陆」仅限空目标且无敌方反应;
// 敌占/敌控港口的两栖夺控若本窗既无已激活海军、待激活候选里也无海军, 继续激活两栖地面
// 只会被 broken_aa 判 "Amphibious Assault failed" 吃损失)。返回 true 让选牌窗在尚未激活
// 任何单位时提前 done 收尾(空攻势, 不耗单位)。仅完整全图剧本(gate on)。
// [opt island_sweep 段1] 通用化: 对任意候选目标格判"两栖无护航"。eop_landing_no_escort
// 委托 eop_focus(role); 轮换逻辑(island_sweep)用它逐目标预检, 避免顺延到无护航登陆目标
// 制造 broken_aa 损失。
function eop_landing_no_escort_for(role, view, targetHex) {
    if (typeof esm_gate_on !== "function" || !esm_gate_on()) return false
    if (!view || !view.offensive) return false
    const mine = role === "Japan" ? JP : AP
    const focus = Number.isInteger(targetHex) ? targetHex : eop_focus(role)
    if (focus === null) return false
    const meta = eop_target_meta(role, focus)
    if (!meta || !meta.requiresOccupation) return false
    const md = (typeof get_map_data === "function") ? get_map_data(focus) : null
    if (!md || !md.port) return false
    if (is_space_controlled(focus, mine)) return false
    // 可新增单位里是否同时存在海军和两栖地面。护航舰不要求与登陆军从同一港口
    // 出发；引擎只在会战结算时检查目标格内是否有进攻方海军。旧的“必须同格出发”
    // 预检会错误取消台湾陆军 + 南海舰队这类合法编成，制造空攻势。
    const cand = Array.isArray(view.actions && view.actions.unit) ? view.actions.unit : []
    const unsel = new Set(Array.isArray(view.unselect) ? view.unselect : [])
    let hasNaval = false, hasGround = false
    for (const u of cand) {
        if (unsel.has(u)) continue
        let p = null
        try { p = pieces[u] } catch (e) {}
        if (!p || p.class === "air") continue
        if (p.class === "naval") hasNaval = true
        else if (p.class === "ground" && (p.asp || p.strat_move)) hasGround = true
    }
    if (!hasGround) return false   // 无两栖地面可激活 → 不会发生无护航登陆
    // [opt] taskforce_math/island_sweep: 引擎两栖编组要求海军与登陆地面“同格编组”——AMPH
    // 路径只在海陆同组时存在(get_move_data), 纯海军组进不了敌占岛屿格(敌港不可入)。
    // 海军候选与地面候选相距过远时, 登陆会在会战结算吃 broken_aa("lack of naval escort")。
    // 因此要求存在“可会合的海陆对”: 同格, 或海军在 emAmphEscortDist(默认 4)格内
    // (一个激活+港口运输内可会合)。基线(配置关)不变。
    const emcPaired = (typeof em_cfg === "function") ? em_cfg() : null
    if (emcPaired && (emcPaired.taskforce_math || emcPaired.island_sweep)) {
        const escortDist = Number(emcPaired.emAmphEscortDist) || 4
        const groundLocsP = new Set()
        for (const u of cand) {
            if (unsel.has(u)) continue
            const p = (() => { try { return pieces[u] } catch (e) { return null } })()
            if (p && p.class === "ground" && (p.asp || p.strat_move) && G.location[u] >= 0 && G.location[u] <= LAST_BOARD_HEX) groundLocsP.add(G.location[u])
        }
        let hasPairedEscort = false
        for (const u of cand) {
            if (unsel.has(u) || hasPairedEscort) continue
            const p = (() => { try { return pieces[u] } catch (e) { return null } })()
            if (!p || p.class !== "naval" || !(G.location[u] >= 0 && G.location[u] <= LAST_BOARD_HEX)) continue
            if (groundLocsP.has(G.location[u])) { hasPairedEscort = true; break }
            if (typeof get_distance === "function") {
                for (const gl of groundLocsP) {
                    if (get_distance(G.location[u], gl) <= escortDist) { hasPairedEscort = true; break }
                }
            }
        }
        if (!hasPairedEscort) return true
        // [opt taskforce_math] ZOI 中和: 目标格被敌非中立 ZOI 覆盖时优先由 br∈[1,5] 舰载
        // 中和(set_zoi 设 JP_ZOI_NTRL)。仅作编队偏好(eop_pick_unit), 不作硬中止——
        // 配对实验实测: 无中和舰即取消会误杀大量可成功登陆(盟军夺格 -1.9/局, p=0.06),
        // 敌 ZOI 下的登陆多数仍可达成。
    }
    // [opt] 期望战斗闸门: 有护航/地面候选时, 用海空战+地面会战期望评估登陆成败。
    // 海空战必败(力量/air cover)或 pWin 低于阈值 → 取消空攻势, 避免 broken_aa/
    // US_CASUALTIES(盟军 PW-1)与整支攻势白耗。基线(配置关)保持原 !hasNaval 判定。
    // [opt island_sweep 段1] 轮换放大了两栖激活量, 同样适用该闸门(否则失败登陆
    // 的损失恶化远超容限)。
    const emc = (typeof em_cfg === "function") ? em_cfg() : null
    if (!emc || !(emc.taskforce_math || emc.island_sweep) || typeof em_amphib_assessment !== "function") return !hasNaval
    const byId = u => { try { return pieces[u] } catch (e) { return null } }
    const cfOf = u => { const p = byId(u); if (!p) return 0
        const reducedSet = (typeof G !== "undefined" && G && typeof set_has === "function") ? set_has(G.reduced, u) : false
        return reducedSet ? (Number(p.rcf) || Math.ceil((Number(p.cf) || 0) / 2)) : (Number(p.cf) || 0) }
    const lfOf = u => { const p = byId(u); return Number(p && p.lf) || 3 }
    let attNavalCF = 0, attAirCF = 0, attGroundCF = 0, attNavalHasBr = false
    const attGroundLfs = []
    for (const u of cand) {
        if (unsel.has(u)) continue
        const p = byId(u); if (!p) continue
        if (p.class === "naval") { attNavalCF += cfOf(u); if (Number(p.br) > 0) attNavalHasBr = true }
        else if (p.class === "air") attAirCF += cfOf(u)
        else if (p.class === "ground") { attGroundCF += cfOf(u); attGroundLfs.push(lfOf(u)) }
    }
    const enemy = 1 - mine
    let defNavalCF = 0, defAirCF = 0, defGroundCF = 0, defNavalHasBr = false
    const defGroundLfs = []
    const atFocusIds = new Set()
    for (let u = 1; u < pieces.length; ++u) {
        const p = pieces[u]; if (!p || p.faction !== enemy) continue
        const loc = G.location[u]
        if (loc !== focus) continue
        atFocusIds.add(u)
        if (p.class === "naval") { defNavalCF += cfOf(u); if (Number(p.br) > 0) defNavalHasBr = true }
        else if (p.class === "air") defAirCF += cfOf(u)
        else if (p.class === "ground") { defGroundCF += cfOf(u); defGroundLfs.push(lfOf(u)) }
    }
    // [opt] taskforce_math: 反应兵力改用引擎精确反应候选(含 ebr 航空/反应舰队/CV),
    // 按 emReactionWeight(默认 0.5) 折算 —— 反应需掷骰/天气/编制成立, 非必然到场;
    // 全额计反应会过度悲观(实测把大半两栖攻势误杀成空攻势)。
    try {
        if (typeof queryReactionCandidates === "function") {
            const emcRw = (typeof em_cfg === "function") ? em_cfg() : null
            const rw = emcRw ? (Number(emcRw.emReactionWeight) || 0) : 0.5
            const rc = queryReactionCandidates({ reactionFaction: enemy, targetHex: focus })
            const seen = new Set()
            for (const id of rc.air.concat(rc.carrier, rc.naval)) {
                if (atFocusIds.has(id) || seen.has(id)) continue
                seen.add(id)
                const p = pieces[id]; if (!p) continue
                if (p.class === "air") defAirCF += cfOf(id) * rw
                else if (p.class === "naval") { defNavalCF += cfOf(id) * rw; if (Number(p.br) > 0) defNavalHasBr = true }
            }
        }
    } catch (e) { /* 反应查询不可用时保留焦点守军估计 */ }
    const assess = em_amphib_assessment({ attacker: mine, targetHex: focus,
        attNavalCF, attNavalHasBr, attAirCF, attGroundCF, attGroundLfs,
        defNavalCF, defNavalHasBr, defAirCF, defGroundCF, defGroundLfs })
    return !!assess.abort
}

// 原签名保持: 激活窗(erasmus.js)对当前图表焦点调用的两栖无护航预检。
function eop_landing_no_escort(role, view) {
    return eop_landing_no_escort_for(role, view, null)
}

// [opt island_sweep 段1] 激活完成率: 通用"推进夺格"兜底选单位。
// 焦点/战略链编不出单位时, 激活窗不应提前 done 浪费预算: 激活一支地面单位,
// 无头推进的落点评分(offensive.js headless_target_score [1,nearKey] 空虚敌控分支)
// 会把它沿合法路径推向空虚敌控格 —— 地面移入即逐格 capture_hex(move.js:881),
// 攻势结束 capture_landing_hexes 再兜底占领, 直接转化为夺格。
// 地面优先(唯一能夺格的兵种, 距空虚敌控格 ≤ emSweepAdvDist 才选, 避免深处的
// 部队长途暴露行军); 无合适地面时兜底选一支靠前航空兵(前推机场, 用满预算,
// 不主动接战)。GARRISON/DEFEND 轴不动用兜底(驻军不该被拉去进攻)。海军绝不
// 兜底(纯海军组只会扑敌舰格单挑)。基线(配置关)直接返回 undefined, 维持原 done。
function eop_pick_advance_unit(candidates, role, activeUnits) {
    const emc = (typeof em_cfg === "function") ? em_cfg() : null
    if (!emc || !(emc.island_sweep || emc.erasmus_plus)) return undefined
    if (!Array.isArray(candidates) || !candidates.length) return undefined
    if (typeof G === "undefined" || !G || !G.location) return undefined
    if (typeof is_space_controlled !== "function" || typeof get_distance !== "function") return undefined
    if (typeof eop_axis === "function") {
        const axis = eop_axis(role)
        if (axis && (axis.kind === "GARRISON" || axis.kind === "DEFEND")) return undefined
    }
    const mine = role === "Japan" ? JP : AP
    // 空虚敌控格 = 敌方控制且双方皆无单位的格(有敌单位的是会战格, 不属"推进夺格")。
    const occupied = new Set()
    for (let u = 1; u < pieces.length; ++u) {
        const p = pieces[u]
        if (!p) continue
        const h = G.location[u]
        if (h >= 0 && h <= LAST_BOARD_HEX) occupied.add(h)
    }
    const emptyEnemy = []
    for (let h = 0; h <= LAST_BOARD_HEX; ++h) {
        if (!occupied.has(h) && is_space_controlled(h, 1 - mine)) emptyEnemy.push(h)
    }
    if (!emptyEnemy.length) return undefined
    const better = (a, b) => { for (let i = 0; i < a.length; ++i) { if (a[i] !== b[i]) return a[i] < b[i] } return false }
    const maxD = Number(emc.emSweepAdvDist) || 3
    let best = null, bestScore = null
    for (const u of candidates) {
        const p = (() => { try { return pieces[u] } catch (e) { return null } })()
        if (!p || p.class !== "ground") continue
        const loc = G.location[u]
        if (!(loc >= 0 && loc <= LAST_BOARD_HEX)) continue
        // 首键 = 到最近空虚敌控格的距离(越近越可能本回合就夺格; 超 emSweepAdvDist 不选);
        // 次键 = 两栖/可海运地面优先(岛屿格只有它们够得着); 再次 = 满编优先(减损单位
        // 推进遇敌易损); 末键 = id 保证确定性。
        let d = 99
        for (const h of emptyEnemy) {
            const dd = get_distance(loc, h)
            if (dd < d) d = dd
        }
        if (d > maxD) continue
        // 减损地面不参与推进兜底(1 step 损失, 被敌反攻即歼灭; 留守待整编)。
        if (G.reduced && (typeof set_has === "function" ? set_has(G.reduced, u) : G.reduced.includes(u))) continue
        const score = [d, (p.asp || p.strat_move) ? 0 : 1, u]
        if (bestScore === null || better(score, bestScore)) { best = u; bestScore = score }
    }
    if (best !== null) return best
    // 航空兜底: 无地面可推进时, 激活一支离前线最近的航空兵(前推机场+用满预算)。
    // 排除 eop_preserve_ready_b29 上游已滤; 此处再排后方空优preserve(折返跑)。
    let airBest = null, airScore = null
    const enemyLocs = eop_enemy_locs(mine)
    for (const u of candidates) {
        const p = (() => { try { return pieces[u] } catch (e) { return null } })()
        if (!p || p.class !== "air") continue
        if (typeof eop_preserve_rear_air === "function" && eop_preserve_rear_air(u, role, null)) continue
        const loc = G.location[u]
        if (!(loc >= 0 && loc <= LAST_BOARD_HEX)) continue
        const score = [eop_min_dist(loc, enemyLocs), u]
        if (airScore === null || better(score, airScore)) { airBest = u; airScore = score }
    }
    return airBest !== null ? airBest : undefined
}

// ---- 引擎无头推进就近转向 ------------------------------------------------
// 供 js/server/offensive.js 调用: 攻击方有主轴时, 用“到焦点的距离”作为
// 同等优先目标内的次级排序键, 引导地面/海军/登陆沿主轴推进。守卫在无主轴时
// (focus null) 返回 -1, 调用方保留原策略无关行为。
function eop_advance_tiebreak(hex, faction) {
    if (typeof G === "undefined" || !G) return -1
    const focus = eop_focus_faction(faction)
    if (focus === null) return -1
    return (typeof get_distance === "function") ? get_distance(hex, focus) : -1
}

// 轨迹可读: 主轴 id + 焦点(便于审计 AI 是否聚焦)。
function eop_trace(role) {
    const axis = eop_axis(role)
    return { axis: axis ? axis.id : null, axis_note: axis ? axis.note : null, focus: eop_focus(role) }
}

// 激活上限较高时，第5/11页要求“为每个目标编成一个任务部队”。激活窗尚未宣告
// 战斗格，不能依赖 battle_hexes 轮换；按每 4 个激活单位（至少两支地面、护航、
// 空海支援）预分配到下一个未完成目标，使 8/9 点事件形成两个独立且不过薄的编队。
function eop_activation_focus_faction(faction, selectedCount, view, candidates) {
    const role = faction === JP ? "Japan" : "Allies"
    const axis = eop_axis(role)
    if (!axis || !Array.isArray(axis.chain)) return eop_focus(role)
    const pending = axis.chain.filter(h => eop_target_pending(role,h,eop_target_meta(role,h)))
    if (!pending.length) return null
    const first=eop_target_meta(role,pending[0])
    if (first?.strictSequential) return pending[0]
    let eligible=first?.targetGroup!==undefined ? pending.filter(h=>eop_target_meta(role,h)?.targetGroup===first.targetGroup) : pending
    // [opt] target_scoring+taskforce_math: 激活焦点按 价值×doctrine×可达性 重排,
    // 让高价值且可达的目标(如资源 raid 格)优先获得编队, 而不是被链首远目标锁死。
    // 基线(配置关)保持链序不变。
    const emcAFo=(typeof em_cfg==="function")?em_cfg():null
    if(emcAFo&&emcAFo.taskforce_math&&emcAFo.target_scoring&&typeof em_score_focus==="function"&&eligible.length>1){
        const scoreOf=h=>{
            const m=eop_target_meta(role,h)
            const value=(typeof em_target_value==="function")?em_target_value(role,h):1
            const doctrine=Math.pow(emcAFo.emDoctrineDecay,Math.max(0,pending.indexOf(h)))
            let reach=1
            if(typeof get_distance==="function"){const d=get_distance(h,pending[0]);reach=Math.pow(emcAFo.emScoreDistDecay,Math.max(0,d))}
            return doctrine*value*reach*(m&&m.strictSequential?1e6:1)
        }
        eligible=eligible.slice().sort((a,b)=>scoreOf(b)-scoreOf(a)||a-b)
    }
    const active=new Set((view?.offensive?.active_units || G.offensive?.active_units || []).flat())
    const available=Array.isArray(candidates)?candidates.filter(u=>!active.has(u)):null
    // [opt ERASMUS_PLUS] 战役层统一分配: 候选全集(链)经 评估→姿态→价值密度 排序,
    // 取代 target_scoring/island_sweep/PoW/资源 各自为政的焦点覆盖(计划 §6"不再依赖
    // 多个互相不一致的 focus/target 变量")。队列空(全不可行)时回退链上原逻辑。
    if(emcAFo&&emcAFo.erasmus_plus&&typeof ep_allocate_targets==="function"){
        const pendingAll=(axis.chain||[]).filter(h=>eop_target_pending(role,h,eop_target_meta(role,h)))
        const planQ=ep_allocate_targets(role,view,pendingAll,null)
        if(planQ&&Array.isArray(planQ.queue)&&planQ.queue.length){
            // §10 多目标: 按价值密度序, 返回第一个"编组未达标"的目标 —— 编满者自动
            // 跳过, 预算自然扩散成多个任务部队(而非灌进单一目标)。
            for(const h of planQ.queue){
                try{
                    const pl=composeTaskForce(h,null,null,view,available,role)
                    if(pl&&!pl.complete&&pl.unit!==undefined&&pl.unit!==null)return h
                }catch(e){}
            }
            // 主目标(min-P)已达标: §13 优先岛群簇分流(island_sweep 开时), 否则空虚格扫荡
            if(emcAFo.island_sweep&&typeof eop_pick_cluster_landing==="function"){
                const chx=eop_pick_cluster_landing(role,view,available,planQ.queue[0],false)
                if(chx!==null&&chx!==undefined)return chx
            }
            if(typeof ep_pick_exploitation_hex==="function"){
                const hx=ep_pick_exploitation_hex(role)
                if(hx!==null&&hx!==undefined)return hx
            }
        }
        // 队列全空/全达标且无扫荡: 落回下方传统循环(不 return, 保留推进兜底)
    }
    // [opt W-PoW] 本回合 PoW 配额未达标 → 命名格夺占绝对优先(压过岛群簇分流)。
    // 验尸: island_sweep 扫荡无名礁格使 capRate 上升但 PoW 银行断供, PW 5-7 点/局
    // 流失、T8 条约败——B29(T9 到场)/封锁(T9+)全部活不到。bank≥pow 后自动恢复扫荡。
    // [opt W-PoW / blockade_v2] 资源格焦点首选: (a) PoW 未达标时命名格绝对优先;
    // (b) blockade_v2 开启时资源格恒为首 focus(夺取南方三格 304/421/535 = 原子弹资源
    // 门槛+封锁 trace+PoW 三赢; 实测 20260907 campaign✓ soviet✓ 资源 6 差一格即胜)。
    // 资源格本身是命名格, PoW 银行同步喂满; 编队可行性过滤兜底不可达格。
    if(emcAFo&&role==="Allies"&&(emcAFo.allies_blockade_v2||(emcAFo.allies_pow_quota&&Number(G.pow||0)>0&&Array.isArray(G.capture)&&G.capture.length<Number(G.pow)))){
        try{
            const resPending=(axis.chain||[]).filter(h=>{
                if(!eop_target_pending(role,h,eop_target_meta(role,h)))return false
                const m2=(typeof get_map_data==="function")?get_map_data(h):null
                return !!(m2&&m2.resource)
            })
            if(resPending.length){
                resPending.sort((a2,b2)=>{
                    const da=(typeof esm_front_distance==="function")?esm_front_distance(a2,AP):99
                    const db=(typeof esm_front_distance==="function")?esm_front_distance(b2,AP):99
                    return da-db||a2-b2
                })
                // [可行性过滤] 就近优先但跳过"编不出地面组"的格子(str=0 死锁焦点,
                // 实测 657 Vogelkop 无两栖可达地面时锁死整条 raid 链); 全不可行才回退最近格。
                if(view&&available){
                    for(const h of resPending){
                        try{
                            const pl=composeTaskForce(h,null,null,view,available,role)
                            if(pl&&!pl.complete&&pl.unit!==undefined&&pl.unit!==null)return h
                            if(pl&&pl.complete)continue // 已达标(已控/已驻)不该出现在 pending, 防御
                        }catch(e){}
                    }
                }
                return resPending[0]
            }
            if(emcAFo.allies_pow_quota&&Number(G.pow||0)>0&&Array.isArray(G.capture)&&G.capture.length<Number(G.pow)&&typeof esm_ap_progress_targets==="function"){
                const prog=esm_ap_progress_targets(axis.chain,axis.targetMeta||[])
                if(prog.length&&prog[0]&&prog[0].hex!==undefined&&prog[0].hex!==null)return prog[0].hex
            }
        }catch(e){/* 诊断不可用则走原逻辑 */}
    }
    if(view && available){
        // [opt island_sweep 段2] 焦点主任务编组已足(plan0.complete) → 后续海陆对优先分流
        // 到岛群簇次级登陆格(第 k 支→第 k 格), 而不是散到链上远端目标; 簇全部编不出时
        // 再回到链上轮换/推进兜底。基线(配置关)不进入该分支。
        if(emcAFo&&emcAFo.island_sweep&&eligible.length){
            const fhMeta=eop_target_meta(role,eligible[0])
            if(!fhMeta?.extraActivationOnly&&fhMeta?.kind!=="GARRISON"&&fhMeta?.kind!=="REDEPLOY"){
                const plan0=composeTaskForce(eligible[0],null,null,view,available,role)
                // “编组已足” = composeTaskForce 达标(complete) 或 已承诺战力≥目标所需
                // (strength≥required; 伤害级 2x 生存闸门太苛, 几乎永不达标, 簇分流会饿死)。
                const sufficed=plan0&&(plan0.complete
                    ||(Number(plan0.required)>0&&Number(plan0.strength)>=Number(plan0.required)))
                if(typeof process!=="undefined"&&process.env.EOTS_SW_DEBUG&&plan0)
                    console.log(`[SW] preloop focus=${eligible[0]} complete=${plan0.complete} str=${plan0.strength} req=${plan0.required} sufficed=${sufficed} avail=${available.length}`)
                if(sufficed){
                    const chx=eop_pick_cluster_landing(role,view,available,eligible[0],true)
                    if(chx!==null&&chx!==undefined)return chx
                }
            }
        }
        const reserved=new Set()
        let firstPending=eligible[0]
        let firstPendingMeta=eop_target_meta(role,firstPending)
        for(const h of eligible){
            const meta=eop_target_meta(role,h)
            if(meta?.extraActivationOnly){
                const hq=view.offensive?.active_hq?.[faction] || G.offensive?.active_hq?.[faction]
                if(!hq || get_distance(G.location[hq],h)>Number(pieces[hq]?.cr||0))continue
            }
            if(meta?.requiredUnits){
                if(meta.requiredUnits.every(u=>G.location[u]===h || active.has(u))){
                    meta.requiredUnits.forEach(u=>reserved.add(u));continue
                }
                if(!available.some(u=>eop_unit_matches_target(u,role,meta,h)))continue
                return h
            }
            if(meta?.kind==="GARRISON"){
                let projected=(view.ai?.units||[]).map(u=>({...u}))
                for(const u of projected){
                    if(eop_garrison_satisfied(role,h,meta,projected))break
                    if(active.has(u.id)&&!reserved.has(u.id)&&eop_unit_matches_target(u,role,meta,h)){
                        u.location=h;reserved.add(u.id)
                    }
                }
                if(eop_garrison_satisfied(role,h,meta,projected))continue
            }
            const plan=composeTaskForce(h,null,null,view,available,role)
            if(typeof process!=="undefined"&&process.env.EOTS_SW_DEBUG&&meta&&(meta.victoryConstraint||"").indexOf("JAPAN_RESOURCE")===0)
                console.log(`[BLK-ACT] T${G.turn} focus=${h}(${(get_map_data(h)||{}).name||h}) complete=${plan.complete} unit=${plan.unit} req=${plan.required} str=${plan.strength} pend=${eop_target_pending(role,h,meta)} avail=${available?available.length:"-"}`)
            if(!plan.complete && plan.unit!==undefined && plan.unit!==null){
                // [opt island_sweep 段1] 顺延目标的风险/产出预检(含链首): (a) 无护航可会合
                // 或期望战评估不过的两栖登陆目标必吃 broken_aa/港湾海空战, 跳过; (b) 猎杀
                // 海军(NAVAL)与非夺占(压制类)目标只生会战不生夺格 —— 预算让位给
                // requiresOccupation 夺格目标与推进兜底; (c) 港内停有强敌舰(≥emSweepHarborNav
                // cf, 通常为航母/战列)的目标, 港湾海空战我方胜率低, 换下一目标。
                if(emcAFo&&emcAFo.island_sweep){
                    if(typeof eop_landing_no_escort_for==="function"&&eop_landing_no_escort_for(role,view,h))continue
                    if(meta?.kind==="NAVAL"||!meta?.requiresOccupation)continue
                    const enemyF=role==="Japan"?AP:JP
                    let defNav=0
                    for(let u=1;u<pieces.length;++u){
                        const p=pieces[u]
                        if(!p||p.faction!==enemyF||p.class!=="naval"||G.location[u]!==h)continue
                        defNav+=p.reduced?(Number(p.rcf)||Math.ceil((Number(p.cf)||0)/2)):(Number(p.cf)||0)
                    }
                    if(defNav>=(Number(emcAFo.emSweepHarborNav)||6))continue
                }
                return h
            }
            // An inaccessible primary attack does not authorize spending its
            // activation budget on an explicitly residual attack.
            // [opt] taskforce_math: 编组完全无单位可用(plan.unit 为空)的主目标不再锁死
            // 焦点 —— 顺延到下一个可行目标(如链尾资源 raid 格), 全部不可行时回退链首
            // 供航空申报。基线(配置关)保持原"链首即焦点"行为。
            // [opt island_sweep] 激活完成率(段1): 同样顺延 —— 焦点编不出单位≠全局收工,
            // 继续沿链找下一个 pending 目标; 全链无产出时由 erasmus.js 激活窗的
            // "推进夺格"兜底吃满预算(eop_pick_advance_unit), 不在此回退链首。
            if(emcAFo&&(emcAFo.taskforce_math||emcAFo.island_sweep)&&(plan.unit===undefined||plan.unit===null))continue
            if(!plan.complete && !meta?.extraActivationOnly && meta?.kind!=="REDEPLOY" && meta?.kind!=="GARRISON")return h
        }
        if(!(emcAFo&&(emcAFo.taskforce_math||emcAFo.island_sweep)))return null
        // [opt] 回退: 所有目标都无可编单位时维持链首焦点(供远程航空申报会战)。
        // island_sweep 段1: 不回退链首锁死预算 —— 先试岛群簇分流(段2), 再由激活窗的
        // "推进夺格"兜底(eop_pick_advance_unit)吃满预算。
        if(emcAFo&&emcAFo.island_sweep){
            const baseFocus=Number.isInteger(eligible[0])?eligible[0]:null
            if(baseFocus!==null){
                const chx=eop_pick_cluster_landing(role,view,available,baseFocus,true)
                if(chx!==null&&chx!==undefined)return chx
            }
            // taskforce_math 联合开启时保留其“链首供远程航空申报”回退(不回退既有指标)。
            if(!(emcAFo&&emcAFo.taskforce_math))return null
        }
        return firstPendingMeta?.extraActivationOnly||firstPendingMeta?.kind==="GARRISON"||firstPendingMeta?.kind==="REDEPLOY" ? null : firstPending
    }
    return eligible[Math.min(eligible.length-1,Math.floor(Math.max(0,Number(selectedCount)||0)/4))]
}

function eop_target_meta(role, hex) {
    const axis = eop_axis(role)
    return axis && Array.isArray(axis.targetMeta) ? axis.targetMeta.find(target => target.hex === hex) || null : null
}

// Shared by activation, task-force composition and actual movement. Semantic
// restrictions remain hard filters even when a preferred candidate is unavailable.
function eop_unit_matches_target(unit, role, meta, target) {
    if (!meta) return true
    const id = typeof unit === "number" ? unit : unit?.id
    const p = typeof unit === "number" ? pieces[unit] : unit
    if (!p || p.faction !== (role === "Japan" ? JP : AP)) return false
    const location = Number.isInteger(p.location) ? p.location : G.location[id]
    if (Array.isArray(meta.requiredUnits) && !meta.requiredUnits.includes(id)) return false
    if (meta.unitFilter === "COMMONWEALTH_OR_US_ARMY" && !["army", "br", "au", "ind", "bu"].includes(p.service)) return false
    if (meta.requiresFriendlyControl && !is_space_controlled(target, p.faction)) return false
    if (meta.kind === "GARRISON") {
        const req = meta.garrisonRequirement
        if (req ? !((req.groundSteps && p.class === "ground") || (req.airSteps && p.class === "air")) : p.class !== (meta.garrisonClass || "ground")) return false
    }
    if (meta.kind === "NAVAL" && p.class !== "naval" && p.class !== "air") return false
    if (meta.targetClasses && p.class !== "air" && p.class !== "naval") return false
    if (meta.escortPairs) {
        if (!meta.escortPairs.some(pair => (pair.ground === id || pair.carrier === id)
            && G.location[pair.ground] === pair.origin && G.location[pair.carrier] === pair.origin)) return false
    }
    if (meta.maxDistance && get_distance(location, target) > meta.maxDistance) return false
    if (meta.preserveLastCarrier && (p.type === "cv" || p.type === "cvl" || p.type === "cve")) {
        let carriers = 0
        for (let u=1;u<pieces.length;u++) if (pieces[u]?.faction===p.faction && /^cv/.test(pieces[u].type||"") && G.location[u]>=0 && G.location[u]<=LAST_BOARD_HEX) carriers++
        if (carriers <= 1) return false
    }
    return true
}

function eop_unit_steps(unit, id) {
    const reduced = typeof unit.reduced === "boolean" ? unit.reduced
        : !!(G.reduced && (typeof set_has === "function" ? set_has(G.reduced,id) : G.reduced.includes(id)))
    return reduced ? 1 : 2
}

// 清单 #24：大部队地面步数 —— 防御强度 lf≥12 才计入；full=2 / reduced=1 step。
// 替换「单位枚数」统计：reduced 单位只算 1 step，未减损算 2 step；lf<12 的小单位不计入。
// regionPred 接 region 字符串(与 esm_region 同口径)；regionOf 供单测注入(默认 esm_region)。
function eop_count_large_force_steps(faction, regionPred, regionOf) {
    const region = typeof regionOf === "function" ? regionOf : (typeof esm_region === "function" ? esm_region : h => h)
    let steps = 0
    for (let u = 1; u < pieces.length; ++u) {
        const p = pieces[u], loc = G.location[u]
        if (!p || p.faction !== faction || p.class !== "ground" || Number(p.lf || 0) < 12) continue
        if (!(loc >= 0 && loc <= LAST_BOARD_HEX)) continue
        if (regionPred && !regionPred(region(loc))) continue
        steps += eop_unit_steps(p, u)
    }
    return steps
}
function eop_garrison_satisfied(role, hex, meta, units) {
    const mine=role==="Japan"?JP:AP
    const list=units || pieces.map((p,id)=>p && ({...p,id,location:G.location[id]}))
    const at=list.filter(p=>p && p.faction===mine && p.location===hex)
    const req=meta.garrisonRequirement
    if (!req) return at.some(p=>p.class===(meta.garrisonClass||"ground"))
    const checks=[]
    for(const cls of ["ground","air"]) if(req[cls+"Steps"]) checks.push(at.filter(p=>p.class===cls).reduce((n,p)=>n+eop_unit_steps(p,p.id),0)>=req[cls+"Steps"])
    return checks.length>0 && (req.operator==="OR" ? checks.some(Boolean) : checks.every(Boolean))
}
function eop_target_pending(role, hex, meta) {
    const mine=role==="Japan"?JP:AP
    if (!meta) return !is_space_controlled(hex,mine)
    if ((meta.ignoreIfEnemy || meta.requiresFriendlyControl || meta.kind==="GARRISON") && !is_space_controlled(hex,mine)) return false
    if (meta.kind==="GARRISON") return !eop_garrison_satisfied(role,hex,meta)
    if (meta.kind==="REDEPLOY" && meta.requiredUnits) return meta.requiredUnits.some(u=>G.location[u]>=0 && G.location[u]<=LAST_BOARD_HEX && G.location[u]!==hex)
    if (meta.kind==="REDEPLOY") return true
    if (meta.kind==="NAVAL" || meta.targetClasses) return pieces.some((p,u)=>p && p.faction!==mine && G.location[u]===hex && (meta.targetClasses ? meta.targetClasses.some(c=>c===p.class || c==="carrier"&&/^cv/.test(p.type||"")) : p.class==="naval"))
    if (meta.kind==="SUPPRESS" || meta.kind==="SUPPRESS_HQ") return !!(meta.requiresOccupation && !is_space_controlled(hex,mine)) || (typeof has_zoi==="function" && has_zoi(hex,1-mine))
    return !is_space_controlled(hex,mine)
}

// 清单 #19：目标完成判定的唯一口径。按目标类型分派——SUPPRESS/SUPPRESS_HQ→AZOI 覆盖
// (has_zoi) 或夺控；GARRISON→驻军步数；NAVAL→清除敌海军；REDEPLOY→requiredUnits 到位；
// 其余(CONTROL/CONQUEST)→己方控制。禁止把战略目标一律简化成「占格」。= !eop_target_pending。
function eop_is_target_complete(role, hex, meta) {
    return !eop_target_pending(role, hex, meta)
}

// 一张 EC 可为多个目标分别编成任务部队。当前首要目标已经建立战斗格后，
// 后续“有地面占领能力”的编队应沿同一图表链转向下一未完成且尚未宣战的
// 目标；航空兵/航母的格外远程投入仍由 choose_attack_hex 优先支援首要格。
function eop_next_focus_faction(faction, excludedHexes, recordedPlan) {
    const role=faction===JP?"Japan":"Allies"
    const axis=recordedPlan&&Array.isArray(recordedPlan.chain)
        ?{chain:recordedPlan.chain,targetMeta:recordedPlan.targetMeta||[]}:eop_axis(role)
    if(!axis||!Array.isArray(axis.chain))return null
    const excluded=new Set(Array.isArray(excludedHexes)?excludedHexes:[])
    const current=recordedPlan&&Number.isInteger(recordedPlan.focus)?recordedPlan.focus:eop_focus(role)
    const metadata=h=>axis.targetMeta?.find(x=>x.hex===h)||null
    const pending=axis.chain.filter(h=>eop_target_pending(role,h,metadata(h)))
    if(!pending.length)return null
    const first=metadata(pending[0])
    if(first?.strictSequential)return null
    const eligible=first?.targetGroup!==undefined?pending.filter(h=>metadata(h)?.targetGroup===first.targetGroup):pending
    for(const h of eligible) if(h!==current&&!excluded.has(h))return {hex:h,meta:metadata(h)}
    return null
}

// ---- [opt island_sweep 段2] 岛群簇 -----------------------------------------
// 同一 island/环礁的相邻命名格(距离≤emSweepClusterDist 的 port/airfield/named 格)
// 通常只有 1 个 reduced 驻军 —— 焦点格得手后, 把后续海陆对分流转投簇内其它格,
// 经 capture_landing_hexes / move.js:881 逐格路径占领批量夺格。
// 缓存: 模块级 Map 按 role|turn|focus 键控几何(地图静态部分), 控制权/守军 CF 在
// 读取时点过滤(防 turn 内易手), 防抖 = 超过 512 项整表清空。
const EOP_CLUSTER_CACHE = new Map()

function eop_island_cluster(role, focus) {
    const emc = (typeof em_cfg === "function") ? em_cfg() : null
    if (!emc || !emc.island_sweep) return []
    if (!Number.isInteger(focus) || typeof get_map_data !== "function"
        || typeof get_distance !== "function" || typeof is_space_controlled !== "function") return []
    if (typeof G === "undefined" || !G || typeof pieces === "undefined") return []
    const maxN = Number(emc.emSweepCluster) || 4
    const radius = Number(emc.emSweepClusterDist) || 2
    const turn = Number(G.turn || 0)
    const key = `${role}|${turn}|${focus}`
    let geo = EOP_CLUSTER_CACHE.get(key)
    if (!geo) {
        geo = []
        for (let h = 0; h <= LAST_BOARD_HEX; ++h) {
            if (h === focus) continue
            const md = get_map_data(h)
            if (!md || !(md.port || md.airfield || md.name)) continue
            if (get_distance(h, focus) > radius) continue
            geo.push(h)
        }
        if (EOP_CLUSTER_CACHE.size > 512) EOP_CLUSTER_CACHE.clear()
        EOP_CLUSTER_CACHE.set(key, geo)
    }
    const mine = role === "Japan" ? JP : AP
    const scored = []
    for (const h of geo) {
        if (is_space_controlled(h, mine)) continue // 已己控(夺回/占领中)不再入簇
        let cf = 0
        for (let u = 1; u < pieces.length; ++u) {
            const p = pieces[u]
            if (!p || p.faction === mine || G.location[u] !== h) continue
            cf += p.reduced ? (Number(p.rcf) || Math.ceil((Number(p.cf) || 0) / 2)) : (Number(p.cf) || 0)
        }
        scored.push([cf, get_distance(h, focus), h])
    }
    // 守军 CF 升序(先摘软柿子) + 距离升序 + id 确定性; 上限 emSweepCluster。
    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
    return scored.slice(0, maxN).map(x => x[2])
}

// 反查: hex 是否属于当前回合某焦点的岛群簇 → 返回簇格合成 meta(夺占语义+所属焦点),
// 供 composeTaskForce 对无 targetMeta 的簇格复用“地面+护航”编组、headless 推进定向;
// 基线恒 null。
function eop_cluster_meta(role, hex) {
    const emc = (typeof em_cfg === "function") ? em_cfg() : null
    if (!emc || !emc.island_sweep) return null
    if (!Number.isInteger(hex) || typeof G === "undefined" || !G) return null
    for (const key of EOP_CLUSTER_CACHE.keys()) {
        const parts = key.split("|")
        if (parts[0] !== role || Number(parts[1]) !== Number(G.turn || 0)) continue
        const focus = Number(parts[2])
        if (focus === hex) continue
        if (eop_island_cluster(role, focus).includes(hex))
            return { requiresOccupation: true, islandCluster: true, focus }
    }
    return null
}

// 已在东京 8 格内盟军机场待命的 B29 是战略轰炸胜利链的必要资产。普通攻势若再次
// 激活它，无头移动层只能把纯航空编成送回下一回合轨，导致下一战略轰炸阶段缺席。
// 因此把“已就位且格内无日军”的 B29 从普通激活候选中保护起来。
function eop_preserve_ready_b29(u, role) {
    if (role !== "Allies") return false
    const p = pieces[u], h = G.location[u]
    if (!p || !p.b29 || !(h >= 0 && h <= LAST_BOARD_HEX)) return false
    const md = get_map_data(h)
    if (!md || !md.airfield || !is_space_controlled(h, AP) || get_distance(h, TOKYO) > 8) return false
    for (let x = 1; x < pieces.length; ++x)
        if (pieces[x] && pieces[x].faction === JP && G.location[x] === h) return false
    return true
}

// 防止“夏威夷航空兵折返跑”。若一支盟军航空兵仍在有 HQ 的远后方基地，而当前
// 图表目标超出它本次移动后仍可投入战斗的范围，激活它不会给当前任务部队增加
// 战力；移动器随后只能把它送回原基地，白白消耗激活点。这里仅排除这种不可达
// 候选，不阻止它在目标进入可达范围后出击，也不影响 B29 专用保护。
function eop_preserve_rear_air(u, role, target) {
    if (role !== "Allies" || !Number.isInteger(target)) return false
    const p = pieces[u], h = G.location[u]
    if (!p || p.class !== "air" || !(h >= 0 && h <= LAST_BOARD_HEX)) return false
    let hasHq = false
    for (let x = 1; x < pieces.length; ++x) {
        if (pieces[x] && pieces[x].faction === AP && pieces[x].class === "hq" && G.location[x] === h) {
            hasHq = true
            break
        }
    }
    if (!hasHq) return false
    const extended = Math.max(1, Number(p.ebr) || Number(p.br) || 1)
    // 一次航空移动最多把距离缩短 extended；随后还须在 extended 内支援会战。
    return get_distance(h, target) > extended * 2
}

// Public-view planning interfaces used by the chart executor. They deliberately
// consume view.ai/public legal candidates rather than the mutable game state.
function evaluateTargetFeasibility(target, card, hq, view, metaOverride) {
    const units=Array.isArray(view?.ai?.units)?view.ai.units:[], roleFaction=view?.active === "Allies" ? AP : JP
    const meta=(metaOverride!==undefined&&metaOverride!==null)?metaOverride:eop_target_meta(view?.active,target)
    const cf=u=>u.reduced?(Number(u.rcf)||Math.ceil((Number(u.cf)||0)/2)):(Number(u.cf)||0)
    const allDefenders=units.filter(u=>u.location===target&&u.faction!==roleFaction)
    const defenders=meta?.kind==="SUPPRESS_HQ"?allDefenders.filter(u=>u.class==="air"||u.class==="naval"):allDefenders
    const defense=defenders.reduce((s,u)=>s+cf(u),0)
    const md=(target!==null&&target!==undefined&&typeof get_map_data==="function")?get_map_data(target):null
    const damageLevel=meta?.damageLevel||0.5
    const suppress=meta?.kind==="SUPPRESS"||meta?.kind==="SUPPRESS_HQ"
    const requiresOccupation=!!meta?.requiresOccupation
    const coastal=!!(md&&(md.port||md.island))
    // 第5/11页：兵力标准须把可能反应的敌军计入。以公开单位的战斗航程筛出能到目标的
    // 航空/海军，并计入其中最强一支，避免把一架飞机对现有守军刚好达标误判为完整编队。
    const reactionPool=units.filter(u=>u.faction!==roleFaction&&u.location!==target&&(u.class==="air"||u.class==="naval")
        && typeof get_distance==="function"&&get_distance(u.location,target)<=Math.max(1,Number(u.br)||Number(u.ebr)||1))
    // 提示板要求把所有能够反应到目标的敌军纳入伤害等级，而不是只取最强一支。
    const potentialReactionStrength=reactionPool.reduce((s,u)=>s+cf(u),0)
    const airSeaDefense=defenders.filter(u=>u.class==="air"||u.class==="naval").reduce((s,u)=>s+cf(u),0)
    const relevantDefense=(requiresOccupation?airSeaDefense:defense)+potentialReactionStrength
    return {target,meta,damageLevel,legal:target!==null&&target!==undefined,coastal,defense,suppress,requiresOccupation,
        garrisonClass:meta?.garrisonClass||null,
        groundDefense:defenders.filter(u=>u.class==="ground").reduce((s,u)=>s+cf(u),0),
        airSeaDefense,
        potentialReaction:potentialReactionStrength>0,potentialReactionStrength,
        requiredGroundMath:Math.max(1,defenders.filter(u=>u.class==="ground").reduce((s,u)=>s+cf(u),0)),
        requiredAirSeaMath:Math.max(1,Math.ceil(relevantDefense/damageLevel))}
}
// ---- Page 5 / Page 11 任务部队 predicate 精确化 (PR2) ----------------------
// 与 evaluateTargetFeasibility 的粗代理不同，这些求值器只依赖 RTT 规则查询层
// (rules_query.js) 的精确合法性/移动/反应结果，不再用 aiStage/aiBattle/resource/
// get_distance 作为“能不能打”的代理。返回 undefined 表示该谓词在当前状态不可判定，
// 由 predicate_value 退回 view.ai.predicates 兜底。

const EOP_EXACT_TASKFORCE_PREDICATES = [
    "CAN_GROUND_ADVANCE", "GROUND_CAN_ENTER_EXIT", "TARGET_IS_SR",
    "ENEMY_AIR_OR_CARRIER_CAN_REACT", "ENEMY_NAVAL_GROUND_CAN_REACT",
    "FORCE_MEETS_BATTLE_SUPPORT_STANDARD", "TARGET_DAMAGE_LEVEL_MET",
]

// 单位当前战斗值（减损用 rcf，否则 cf）。
function eop_unit_cf(u) {
    return u.reduced ? (Number(u.rcf) || Math.ceil((Number(u.cf) || 0) / 2)) : (Number(u.cf) || 0)
}

// 地面单位进入目标后仍能合法退出：进入合法，且至少存在一个相邻合法可达格。
function eop_can_ground_enter_exit(unitId, target, reach) {
    const canEnter = !!reach.costByHex[target]
    if (!canEnter) return { canEnter: false, canExit: false, entryCost: undefined, exitHexes: [] }
    const md = get_map_data(target)
    const neighbors = (md && Array.isArray(md.nh)) ? md.nh : []
    const exitHexes = neighbors.filter(n => Number.isInteger(n) && n !== target && reach.costByHex[n] !== undefined)
    return { canEnter: true, canExit: exitHexes.length > 0, entryCost: reach.costByHex[target], exitHexes }
}

// 战斗支援标准：只判兵种构成，不判总战斗力（与 Damage Level 拆开）。
function eop_meets_battle_support_standard(meta, activeUnits, target, faction) {
    const hasGround = activeUnits.some(u => u.class === "ground")
    const hasNaval = activeUnits.some(u => u.class === "naval")
    const hasRangedSupport = activeUnits.some(u => u.class === "air" || (u.class === "naval" && Number(u.br) > 0))
    const requiresOccupation = !!(meta && meta.requiresOccupation)
    const suppress = !!(meta && (meta.kind === "SUPPRESS" || meta.kind === "SUPPRESS_HQ"))
    const md = (target !== null && target !== undefined && Number.isInteger(target)) ? get_map_data(target) : null
    const coastal = !!(md && (md.port || md.island))
    const landing = requiresOccupation && coastal && !is_space_controlled(target, faction)
    const missing = []
    if (requiresOccupation && !hasGround) missing.push("ground")
    if (landing && !hasNaval) missing.push("naval")
    if (suppress && !hasRangedSupport) missing.push("air-sea")
    return { met: missing.length === 0, missing }
}

// 伤害等级：攻击有效战斗力是否达到目标 Damage Level；占领目标另须地面 2x 生存。
function eop_evaluate_damage_level(meta, attackers, defenders, reactionIds, byId, target, reactionStrengthOverride) {
    const cf = eop_unit_cf
    const requiresOccupation = !!(meta && meta.requiresOccupation)
    const suppress = !!(meta && (meta.kind === "SUPPRESS" || meta.kind === "SUPPRESS_HQ"))
    const damageLevel = (meta && meta.damageLevel) || 1
    const airSeaDefense = defenders.filter(u => u.class === "air" || u.class === "naval").reduce((s, u) => s + cf(u), 0)
    const groundDefense = defenders.filter(u => u.class === "ground").reduce((s, u) => s + cf(u), 0)
    const totalDefense = airSeaDefense + groundDefense
    // 反应兵力默认按精确反应候选逐个累计；reactionStrengthOverride 供无引擎查询层
    // (单测 vm 沙箱) 时回退到 evaluateTargetFeasibility 的航程粗筛值。
    const reactionStrength = reactionStrengthOverride !== undefined ? reactionStrengthOverride
        : (reactionIds || []).reduce((s, id) => { const u = byId.get(id); return s + (u ? cf(u) : 0) }, 0)
    const attackerAirSea = attackers.filter(u => u.class === "air" || u.class === "naval").reduce((s, u) => s + cf(u), 0)
    const attackerGround = attackers.filter(u => u.class === "ground").reduce((s, u) => s + cf(u), 0)
    const relevantDefense = (requiresOccupation ? airSeaDefense : totalDefense) + reactionStrength
    const airSeaMet = attackerAirSea >= Math.ceil(relevantDefense / damageLevel)
    const groundSurvivalMet = !requiresOccupation ? true : (attackerGround >= Math.max(1, 2 * groundDefense))
    const met = suppress ? airSeaMet : (requiresOccupation ? (airSeaMet && groundSurvivalMet) : airSeaMet)
    return { met, airSeaMet, groundSurvivalMet, attackerAirSea, attackerGround, airSeaDefense, groundDefense, reactionStrength }
}

// ============================================================================
// Page 6 / Page 12 反应与 PBM 精确求值器 (PR4)
// ============================================================================

// 反应兵力标准 (清单 #11)：纯函数，无引擎全局依赖，可经 vm 单测。
// 返回 { airSeaOneXMet, airCountMet, groundTwoXRequired, groundTwoXMet, complete }。
//   airSeaOneXMet   己方空海战斗力 ≥ 敌方空海战斗力 (1x 标准)
//   airCountMet     己方空军数量 ≥ 敌方空军数量
//   groundTwoXRequired  D10 0-4 → 地面须 2x 生存；5-9 → 无地面要求 (图表 1-4/5-9, 0 按低段)
//   groundTwoXMet   己方地面 CF ≥ 2× 敌方地面 CF (无地面要求时恒 true)
function eop_evaluate_reaction_force_standard(input) {
    const sel = (input && input.selectedReactionUnits) || []
    const atk = (input && input.attackingUnits) || []
    const d10 = (input && Number.isInteger(input.d10)) ? input.d10 : 5
    const cf = eop_unit_cf
    const ownAS = sel.filter(u => u.class === "air" || u.class === "naval").reduce((s, u) => s + cf(u), 0)
    const enemyAS = atk.filter(u => u.class === "air" || u.class === "naval").reduce((s, u) => s + cf(u), 0)
    const ownAir = sel.filter(u => u.class === "air").length
    const enemyAir = atk.filter(u => u.class === "air").length
    const airSeaOneXMet = ownAS >= enemyAS
    const airCountMet = ownAir >= enemyAir
    const groundTwoXRequired = d10 <= 4
    const ownGround = sel.filter(u => u.class === "ground").reduce((s, u) => s + cf(u), 0)
    const enemyGround = atk.filter(u => u.class === "ground").reduce((s, u) => s + cf(u), 0)
    const groundTwoXMet = !groundTwoXRequired || ownGround >= Math.max(1, 2 * enemyGround)
    const complete = airSeaOneXMet && airCountMet && groundTwoXMet
    return { airSeaOneXMet, airCountMet, groundTwoXRequired, groundTwoXMet, complete }
}

// 天气反应标准 (清单 #13)：d10 < 2×真实激活单位数 (CDSS 例：4 个移动单位→需掷 < 8)。
// 输入只用真实激活单位数 + D10 + 情报修正(奇袭 -2)；禁止会战格数 / Logistic Value / 代理值。
function eop_weather_reaction_standard(input) {
    const activatedCount = Math.max(0, Number((input && input.activatedCount) || 0))
    const die = (input && Number.isInteger(input.die)) ? input.die : 9
    const surprise = !!(input && input.surprise)
    return (die - (surprise ? 2 : 0)) < activatedCount * 2
}

// 潜艇目标优先级 (清单 #15)：CV→BB→CA→DD；同类按防御值(lf)降序，稳定 id 破平。
// 输入来自 querySubmarineTargets().legalTargets，只排序不造目标。
function eop_pick_submarine_target(legalTargets) {
    if (!Array.isArray(legalTargets) || !legalTargets.length) return undefined
    const rank = u => { const t = String(u.type || u.name || "").toLowerCase(); return /^cv/.test(t) ? 0 : /bb/.test(t) ? 1 : /^ca/.test(t) ? 2 : /dd/.test(t) ? 3 : 4 }
    return legalTargets.slice().sort((a, b) => rank(a) - rank(b)
        || (Number(b.lf) || 0) - (Number(a.lf) || 0)
        || (a.id ?? 0) - (b.id ?? 0))[0]
}

// 精确求值 7 个任务部队 predicate（只读；返回 undefined 表示退回兜底）。
function eop_exact_taskforce_predicates(view, context) {
    const out = {}
    for (const id of EOP_EXACT_TASKFORCE_PREDICATES) out[id] = undefined
    if (!view || !view.ai) return out
    const role = context && context.role ? context.role : view.active
    const faction = role === "Japan" ? JP : AP
    const enemy = 1 - faction
    const target = view.ai.focus
    if (target === null || target === undefined || !Number.isInteger(target)) return out
    if (typeof G === "undefined" || !G || !G.offensive || !Array.isArray(G.offensive.active_cards) || !G.offensive.active_cards[0]) return out
    const units = Array.isArray(view.ai.units) ? view.ai.units : []
    const byId = new Map(units.map(u => [u.id, u]))
    const meta = eop_target_meta(role, target)
    const activeIds = (G.offensive.active_units && Array.isArray(G.offensive.active_units[faction])) ? G.offensive.active_units[faction].slice() : []
    const activeUnits = activeIds.map(id => byId.get(id)).filter(Boolean)
    const defenders = units.filter(u => u.location === target && u.faction === enemy)

    // 反应候选（精确）。
    const reaction = queryReactionCandidates({ reactionFaction: enemy, targetHex: target })
    const reactionIds = reaction.air.concat(reaction.carrier, reaction.naval, reaction.ground)
    out.ENEMY_AIR_OR_CARRIER_CAN_REACT = (reaction.air.length + reaction.carrier.length) > 0
    out.ENEMY_NAVAL_GROUND_CAN_REACT = (reaction.naval.length + reaction.ground.length) > 0

    // SR。
    out.TARGET_IS_SR = !!querySpecialReaction({ reactingFaction: enemy, target }).eligible

    // 地面可达性（精确）：存在能合法推进到目标的己方地面单位。
    let canGroundAdvance = false
    let groundCanEnterExit = false
    for (const u of units) {
        if (u.faction !== faction || u.class !== "ground") continue
        if (!Number.isInteger(u.location) || u.location < 0 || u.location > LAST_BOARD_HEX) continue
        const reach = queryGroundReachability(u.id, { move_type: ANY_MOVE })
        if (reach.reachableHexes && reach.reachableHexes.indexOf(target) >= 0) {
            canGroundAdvance = true
            if (eop_can_ground_enter_exit(u.id, target, reach).canExit) groundCanEnterExit = true
        }
    }
    out.CAN_GROUND_ADVANCE = canGroundAdvance
    out.GROUND_CAN_ENTER_EXIT = groundCanEnterExit

    // 支援标准（兵种构成）与伤害等级（战斗力 + 地面 2x 生存）。
    const support = eop_meets_battle_support_standard(meta, activeUnits, target, faction)
    out.FORCE_MEETS_BATTLE_SUPPORT_STANDARD = support.met
    const dmg = eop_evaluate_damage_level(meta, activeUnits, defenders, reactionIds, byId, target)
    out.TARGET_DAMAGE_LEVEL_MET = dmg.met

    return out
}

// 第6/12页反应 predicate 精确求值 (PR4)。只读；返回 undefined 表示退回 view.ai.predicates。
const EOP_EXACT_REACTION_PREDICATES = [
    "REACTION_FORCE_STANDARD_MET", "WEATHER_STANDARD_MET",
    "EARLY_DEFENSE_DONE_AND_KAMIKAZE_STANDARD",
    "HAS_VALID_SUBMARINE_TARGET", "HAS_SUBMARINE_CARD_AND_TARGET",
]

function eop_exact_reaction_predicates(view, context, nodeId) {
    const out = {}
    for (const id of EOP_EXACT_REACTION_PREDICATES) out[id] = undefined
    if (!view || !view.ai) return out
    if (typeof G === "undefined" || !G || !G.offensive) return out
    const role = context && context.role ? context.role : view.active
    const faction = role === "Japan" ? JP : AP
    const enemy = 1 - faction
    if (nodeId === undefined || nodeId === null) nodeId = context && context.nodeId
    const units = Array.isArray(view.ai.units) ? view.ai.units : []
    const byId = new Map(units.map(u => [u.id, u]))
    const seed = context && context.seed, ordinal = context && context.actionOrdinal
    const hash = text => (typeof erasmus_hash === "function" ? erasmus_hash(text) % 10 : 5)

    // WEATHER_STANDARD_MET：真实攻击方激活单位数 + D10 + 情报修正(奇袭)。
    const attackingIds = (Array.isArray(G.offensive.active_units) && Array.isArray(G.offensive.active_units[enemy])) ? G.offensive.active_units[enemy] : []
    out.WEATHER_STANDARD_MET = eop_weather_reaction_standard({
        activatedCount: attackingIds.length,
        die: hash(`${seed}:${ordinal}:${nodeId}:WEATHER-D10`),
        surprise: G.offensive.intelligence === SURPRISE,
    })

    // REACTION_FORCE_STANDARD_MET：己方可反应候选 vs 攻击方已承诺单位。
    if (Array.isArray(G.offensive.battle_hexes) && G.offensive.battle_hexes.length) {
        const attackingUnits = attackingIds.map(id => byId.get(id)).filter(Boolean)
        let reactionUnits = []
        if (typeof queryReactionCandidates === "function") {
            try {
                const reaction = queryReactionCandidates({ reactionFaction: faction })
                reactionUnits = reaction.air.concat(reaction.carrier, reaction.naval, reaction.ground).map(id => byId.get(id)).filter(Boolean)
            } catch (e) { reactionUnits = [] }
        }
        const std = eop_evaluate_reaction_force_standard({
            selectedReactionUnits: reactionUnits, attackingUnits,
            d10: hash(`${seed}:${ordinal}:${nodeId}:RF-D10`),
        })
        out.REACTION_FORCE_STANDARD_MET = std.complete
    }

    // 神风标准 (清单 #14)：合法 BB/CV 目标 + 可减损日军航空单位。
    let kamikazeMet = false
    if (typeof queryKamikazeStandard === "function") {
        try { kamikazeMet = !!queryKamikazeStandard().met } catch (e) { kamikazeMet = false }
    }
    // 潜艇合法目标 (清单 #15)：攻击方已承诺海军单位。
    let subTargets = []
    if (typeof querySubmarineTargets === "function") {
        try { subTargets = querySubmarineTargets({ attackerFaction: enemy }).legalTargets || [] } catch (e) { subTargets = [] }
    }
    out.HAS_VALID_SUBMARINE_TARGET = subTargets.length > 0
    out.HAS_SUBMARINE_CARD_AND_TARGET = out.HAS_VALID_SUBMARINE_TARGET && !!view.ai.predicates.HAS_SUBMARINE_CARD
    // I+J：早期防御完成 + 神风标准。早期防御完成取战略层权威信号，缺省退回 false
    // (不擅自把"有神风卡"当成"满足神风标准")。
    const earlyDefenseDone = typeof eop_early_defense_done === "function" ? !!eop_early_defense_done(role, view, context) : false
    out.EARLY_DEFENSE_DONE_AND_KAMIKAZE_STANDARD = earlyDefenseDone && kamikazeMet

    return out
}

// 日本"早期防御完成"：第6页 I 框。取第1页 B 框"DEI 投降格全部占领"同一口径——
// 早期南方扩张/防御圈完成即视为早期防御完成。无权威信号时保守返回 false。
function eop_early_defense_done(role, view, context) {
    if (role !== "Japan") return false
    if (typeof nations === "undefined" || !nations || !nations.DEI || !Array.isArray(nations.DEI.keys)) return false
    try { return nations.DEI.keys.every(k => is_space_controlled(hex_to_int(k), JP)) } catch (e) { return false }
}

// 战略层残余启发式精确化 (PR5)。清单 #19/#22/#23/#25：IS_LAST_TARGET/CBI_DEFENSE_COMPLETE/
// ORANGE_PLAN_CRITERIA/PERIMETER_TARGET_1_COMPLETE 在全战役态已由 erasmus_state 精确求值，
// 但 game.js 的 view.ai.predicates 兜底把它们强制为 false(SP/Burma 兼容态)或按「占格/有会战」
// 粗算(IS_LAST_TARGET)。此处把同一精确求值器接到 predicate_value 优先层：不可判定时返回
// undefined → 退回 view.ai.predicates，不擅自造值。
const EOP_EXACT_STRATEGIC_PREDICATES = [
    "IS_LAST_TARGET", "CBI_DEFENSE_COMPLETE", "ORANGE_PLAN_CRITERIA", "PERIMETER_TARGET_1_COMPLETE",
]

function eop_exact_strategic_predicates(view, context, nodeId) {
    const out = {}
    for (const id of EOP_EXACT_STRATEGIC_PREDICATES) out[id] = undefined
    if (typeof G === "undefined" || !G) return out
    const role = context && context.role ? context.role : view && view.active
    if (role !== "Japan" && role !== "Allies") return out

    // IS_LAST_TARGET：主轴链上唯一尚未完成的目标数 === 1。完成判定统一走
    // eop_is_target_complete(不再把 SUPPRESS/AZOI 等目标简化成「占格」)。
    if (typeof eop_is_target_complete === "function" && typeof eop_axis === "function") {
        try {
            const axis = eop_axis(role)
            if (axis && Array.isArray(axis.chain) && axis.chain.length) {
                const pending = axis.chain.filter(h => !eop_is_target_complete(role, h, eop_target_meta(role, h)))
                out.IS_LAST_TARGET = pending.length === 1
            }
        } catch (e) { /* 保持 undefined → 兜底 */ }
    }

    // CBI / Orange / Perimeter：复用 erasmus_state 权威 ctx(与全战役态同源)。
    if (typeof esm_build_ctx === "function") {
        try {
            const seed = (context && context.seed) || ""
            const ctx = esm_build_ctx(role, null, `${seed}:${nodeId || ""}:strategic`)
            if (role === "Japan") {
                out.PERIMETER_TARGET_1_COMPLETE = !!ctx.jp_M_perimeter_target_1_complete
            } else {
                out.CBI_DEFENSE_COMPLETE = !!ctx.al_E_cbi_def_established
                out.ORANGE_PLAN_CRITERIA = !!(ctx.al_J_phil_not_surrendered && ctx.al_K_service_agreement
                    && ctx.al_L_has_2_carriers && ctx.al_M_us_corps_near_carrier && ctx.al_N_aus_no_jp_ground)
            }
        } catch (e) { /* 保持 undefined → 兜底 */ }
    }
    return out
}

// PR3：任务部队候选的“合法参与”过滤——不可达单位不得进入排序。用 RTT 规则查询层
// 的 queryCombatParticipation 判可达性（地面/海军走引擎 BFS，航空走战斗航程），
// 任何查询异常都保守放行，绝不因查询崩溃而误剔候选。
function eop_filter_legal_participants(unitsById, target, role) {
    if (target === null || target === undefined || !Number.isInteger(target)) return unitsById
    // [opt] taskforce_math 两栖编队参与判定。queryCombatParticipation 的地面分支走陆路
    // BFS(queryGroundReachability/ANY_MOVE)、海军分支走海军 BFS——都建模不了引擎真实的
    // 两栖参与方式: AMPH_MOVE 路径只对“同格海陆编组”存在(get_move_data 8664-8676;
    // 无头推进 movementOptions offensive.js)。对敌占港口/岛屿的夺占目标它把全部地面与
    // 海军候选判非法, 池子只剩射程内 1-2 个航空单位 → 激活窗永远只选空/无单位可选而
    // done(实测整局 139 个激活窗、47 窗含地面候选却 0 地面激活、盟军 0 夺格)。
    // 开配置时按两栖编队语义放行: 两栖地面(asp/strat_move)与护航海军保持候选;
    // 基线(配置关)判定路径逐位不变。
    const emcAF = (typeof em_cfg === "function") ? em_cfg() : null
    let amphLanding = false
    if (emcAF && (emcAF.taskforce_math || emcAF.island_sweep)) {
        // [opt island_sweep 段2] 簇格(合成夺占 meta)与焦点敌占港口同样依赖该放行,
        // 否则两栖地面/护航海军被 BFS 过滤, 岛群分流永远编不出海陆对。
        const mineAF = role === "Japan" ? JP : AP
        const mdAF = (typeof get_map_data === "function") ? get_map_data(target) : null
        amphLanding = !!mdAF && (mdAF.port || mdAF.island) && !is_space_controlled(target, mineAF)
    }
    return unitsById.filter(u => {
        try {
            if (typeof queryCombatParticipation !== "function") return true
            const legalAF = queryCombatParticipation(u.id, target, {}).legal
            if (legalAF || !amphLanding) return legalAF
            const pAF = pieces[u.id]
            if (!pAF) return false
            // 两栖登陆地面: 编组后经 AMPH_MOVE 登岛(引擎组级合法性, 单位级 BFS 判不了)。
            if (pAF.class === "ground") return !!(pAF.asp || pAF.strat_move)
            // 护航/会战海军: 引擎只在会战结算时检查目标格是否有进攻方海军(broken_aa),
            // 无头推进把同格海陆编成同组一起上岛, 故海军候选不得被 BFS 过滤掉。
            if (pAF.class === "naval") return true
            return false
        } catch (e) { return true }
    })
}

// [opt island_sweep 段2] metaOverride: 岛群簇格无 targetMeta, 由 eop_cluster_meta
// 注入夺占语义合成 meta; 基线(配置关)恒 undefined, 行为逐位不变。
function composeTaskForce(target, card, hq, view, candidates, role, metaOverride) {
    if((target===null || target===undefined) && eop_axis(role))return {complete:true,strict:true,unit:null,formation:"objectives-scheduled"}
    const units=Array.isArray(view?.ai?.units)?view.ai.units:[], byId=new Map(units.map(u=>[u.id,u]))
    const active=new Set((view?.offensive?.active_units||[]).flat()), f=evaluateTargetFeasibility(target,card,hq,view,metaOverride)
    candidates=(candidates||[]).filter(id=>eop_unit_matches_target(byId.get(id)||id,role,f.meta,target))
    const committed=[...active].map(id=>byId.get(id)).filter(Boolean)
    const cf=u=>u.reduced?(Number(u.rcf)||Math.ceil((Number(u.cf)||0)/2)):(Number(u.cf)||0)
    const strikeStrength=committed.filter(u=>u.class==="air"||u.class==="naval").reduce((s,u)=>s+cf(u),0)
    const groundStrength=committed.filter(u=>u.class==="ground").reduce((s,u)=>s+cf(u),0)
    const hasGround=committed.some(u=>u.class==="ground"),hasNaval=committed.some(u=>u.class==="naval")
    if(f.meta?.escortPairs){
        const pairs=f.meta.escortPairs.filter(pair=>G.location[pair.ground]===pair.origin && G.location[pair.carrier]===pair.origin
            && get_distance(pair.origin,target)<=f.meta.maxDistance)
        const pair=pairs.find(p=>active.has(p.ground)||active.has(p.carrier))
            ||pairs.find(p=>candidates.includes(p.ground)&&candidates.includes(p.carrier))
        const complete=!!pair&&active.has(pair.ground)&&active.has(pair.carrier)
        const unit=pair?[pair.ground,pair.carrier].find(id=>!active.has(id)&&candidates.includes(id)):undefined
        return {complete,strict:true,required:2,strength:pair?Number(active.has(pair.ground))+Number(active.has(pair.carrier)):0,
            unit:complete?null:unit,formation:"orange-army-carrier-convoy",groundStrength,strikeStrength,potentialReactionStrength:0}
    }
    if(f.meta?.kind==="GARRISON" || f.meta?.kind==="REDEPLOY"){
        const already=f.meta.kind==="GARRISON"?eop_garrison_satisfied(role,target,f.meta,units):!eop_target_pending(role,target,f.meta)
        const moved=candidates.map(id=>byId.get(id)).filter(u=>u && u.location!==target)
        // REDEPLOY(撤离/调动)是战略移动(SR)，不是会战：requiredUnits 只需被激活并沿
        // SR/headless 路径移向目标，不能套用 queryCombatParticipation 的会战参与过滤，
        // 否则地面单位无法"会战参与"到隔海目标 → pool 空 → unit undefined → 激活窗被迫
        // done，形成"打出牌但 0 单位调度"的空攻势。GARRISON 需实际进入目标格，保留过滤。
        const pool=f.meta.kind==="REDEPLOY"?moved:eop_filter_legal_participants(moved,target,role)
        pool.sort((a,b)=>(f.meta.garrisonRequirement?.airSteps ? (a.class==="air"?0:1)-(b.class==="air"?0:1):0)
            || get_distance(a.location,target)-get_distance(b.location,target)||a.id-b.id)
        return {complete:already,strict:true,required:1,strength:already?1:0,unit:already?null:pool[0]?.id,
            formation:f.meta.kind.toLowerCase(),groundStrength,strikeStrength,potentialReactionStrength:0}
    }
    const landing=f.requiresOccupation&&f.coastal&&view?.ai?.focusControlledBy!==view?.active
    const need=f.suppress?f.requiredAirSeaMath:f.requiresOccupation?f.requiredGroundMath:(f.groundDefense>0?f.requiredGroundMath:f.requiredAirSeaMath)
    const math=f.suppress?strikeStrength:f.requiresOccupation?groundStrength:Math.max(groundStrength,strikeStrength)
    // 占领军不仅要有地面与登陆护航；只要目标上有空海兵力或可能发生
    // 空海反应，还必须补足图表伤害等级所需的空海战力。航空兵/航母可在
    // 战斗格外投入，故这里只要求其加入任务部队，不要求移动进目标格。
    const supportRequired=f.requiresOccupation
    // PR3：任务部队“是否达标”改用与第 5/11 页 predicate 完全一致的 RTT 精确求值器：
    //   支援标准只判兵种构成(eop_meets_battle_support_standard)；伤害等级另判有效战斗力
    //   且占领须地面 2x 生存(eop_evaluate_damage_level)。两者拆开，不再手算 CF 阈值。
    //   反应兵力改用引擎精确反应候选(queryReactionCandidates)，而非 get_distance 粗筛。
    const faction=role==="Japan"?JP:AP, enemy=1-faction
    const defenders=units.filter(u=>u.location===target&&u.faction===enemy)
    let reactionIds=[], reactionStrengthOverride
    try {
        if (typeof queryReactionCandidates === "function") {
            const reaction=queryReactionCandidates({reactionFaction:enemy,targetHex:target})
            reactionIds=reaction.air.concat(reaction.carrier,reaction.naval,reaction.ground)
        } else {
            reactionStrengthOverride=f.potentialReactionStrength
        }
    } catch (e) { reactionStrengthOverride=f.potentialReactionStrength }
    const support=eop_meets_battle_support_standard(f.meta,committed,target,faction)
    const dmg=eop_evaluate_damage_level(f.meta,committed,defenders,reactionIds,byId,target,reactionStrengthOverride)
    if(support.met&&(dmg.met||(em_cfg&&((typeof em_cfg==="function")?em_cfg():null)&&((typeof em_cfg==="function")?em_cfg():null).erasmus_plus))){
        // [opt ERASMUS_PLUS §8] 三重门槛: support(兵种构成)达标后 —
        //  plus 模式: P(capture) 取代 dmg 级 2x 生存闸门(P 模型已隐含兵力充分性,
        //    旧闸门实测几乎永不达标导致单目标灌兵), min P 多目标放行/desired 独目标;
        //  非 plus: 保持 dmg.met 规则口径。
        const emcPP=(typeof em_cfg==="function")?em_cfg():null
        if(emcPP&&emcPP.erasmus_plus&&typeof ep_p_thresholds==="function"&&typeof ep_posture==="function"
            &&!f.suppress&&typeof em_ground_outcome==="function"){
            try{
                const psP=ep_posture(role), thP=ep_p_thresholds(psP.posture)
                // §10 多目标分配: 队列还有其他目标时, 主目标编到 min P 即放行(剩余预算
                // 扩散成更多任务部队); 独目标或 OVERMATCH 姿态才追 desired P。
                const planNow=(typeof ep_last_plan==="function")?ep_last_plan():null
                const soloTarget=!planNow||!Array.isArray(planNow.queue)||planNow.queue.length<=1
                const targetP=(psP.posture==="OVERMATCH"||soloTarget)?thP.desired:thP.min
                const attG=committed.filter(u=>u.class==="ground")
                const attCFp=attG.reduce((s2,u)=>s2+(u.reduced?(Number(u.rcf)||Math.ceil((Number(u.cf)||0)/2)):(Number(u.cf)||0)),0)
                const defGp=defenders.filter(u=>u.class==="ground")
                const defCFp=defGp.reduce((s2,u)=>s2+(u.reduced?(Number(u.rcf)||Math.ceil((Number(u.cf)||0)/2)):(Number(u.cf)||0)),0)
                const modsP=(typeof em_ground_mods==="function")?em_ground_mods({attacker:faction,targetHex:target,
                    attAir:committed.some(u=>u.class==="air"),attNaval:committed.some(u=>u.class==="naval"),
                    defAir:defenders.some(u=>u.class==="air"),defNaval:defenders.some(u=>u.class==="naval"),
                    amphibious:!!landing}):{att:0,def:0}
                const ocP=em_ground_outcome({attCF:attCFp,defCF:defCFp,attMods:modsP.att,defMods:modsP.def,
                    attLfs:attG.map(u=>Number(u.lf)||3),defLfs:defGp.map(u=>Number(u.lf)||3)})
                if(ocP.pWin>=targetP)return {complete:true,required:need,strength:math,unit:null,
                    formation:landing?"supported-amphibious-assault":f.suppress?"air-sea-strike":"minimum-sufficient",
                    groundStrength,strikeStrength,potentialReactionStrength:f.potentialReactionStrength,supportRequired,
                    pWin:Number(ocP.pWin.toFixed(2)),via:"ep-pwin"}
                // pWin<desired: 不收工, 继续按边际效用加编(erasmus_plus 下 pick 走 em 边际)
            }catch(e){/* 评估失败回退规则口径 */}
        }
        return {complete:true,required:need,strength:math,unit:null,
            formation:landing?"supported-amphibious-assault":f.suppress?"air-sea-strike":"minimum-sufficient",
            groundStrength,strikeStrength,potentialReactionStrength:f.potentialReactionStrength,supportRequired}
    }
    let pool=(candidates||[]).map(id=>byId.get(id)).filter(Boolean)
    pool=pool.filter(u=>{
        try{return typeof eop_preserve_rear_air!=="function"||!eop_preserve_rear_air(u.id,role,target)}catch(e){return true}
    })
    // 第5/11页脚注：非本土/非印度 HQ 与地面单位同格时，至少保留一个未激活地面单位守卫 HQ。
    pool=pool.filter(u=>{
        if(u.class!=="ground")return true
        const at=units.filter(x=>x.location===u.location&&x.faction===u.faction)
        const hq=at.some(x=>x.class==="hq"), region=typeof get_map_data==="function"?String(get_map_data(u.location)?.region||""):""
        if(!hq)return true
        if(role==="Japan"&&/Japan/i.test(region))return true
        if(role==="Allies"&&/India/i.test(region))return true
        const unactivated=at.filter(x=>x.class==="ground"&&!active.has(x.id))
        return unactivated.length>1
    })
    // 不可达单位不得进入排序（地面走引擎 BFS、航空走航程、海军走引擎海军 BFS）。
    pool=eop_filter_legal_participants(pool,target,role)
    // [opt] CV 保全: 盟军非登陆打击场合不把 CV 投入普通消耗战(保留 air cover/减少 PW 风险)。
    const emc=(typeof em_cfg==="function")?em_cfg():null
    if(emc&&emc.allies_cv_preserve&&role==="Allies"&&!landing&&typeof is_cv_unit==="function"){
        pool=pool.filter(u=>{const p=pieces[u.id];return !(p&&p.class==="naval"&&is_cv_unit(p))})
    }
    let amphibiousPick
    if(landing&&typeof eop_pick_unit==="function")amphibiousPick=eop_pick_unit(pool.map(u=>u.id),role,[...active],target)
    // [opt] 边际效用编队: 以期望战斗数学选增量效用最大的单位; 不可用/无正效用时回退基线排序。
    let emPick
    if(emc&&emc.taskforce_math&&typeof em_pick_taskforce_unit==="function"&&pool.length&&!amphibiousPick){
        emPick=em_pick_taskforce_unit({pool,committed,defenders,target,faction,role,
            landing,requiresOccupation:f.requiresOccupation,suppress:f.suppress,damageLevel:f.damageLevel,
            value:(typeof em_target_value==="function")?em_target_value(role,target):1})
    }
    if(!emPick){
        const classRank=u=>f.suppress?({air:0,naval:1,ground:2}[u.class]??3)
            :f.requiresOccupation?(!hasGround?({ground:0,naval:1,air:2}[u.class]??3):(!hasNaval&&landing?({naval:0,air:1,ground:2}[u.class]??3):({air:0,naval:1,ground:2}[u.class]??3)))
            :({air:0,naval:1,ground:2}[u.class]??3)
        // 同一兵种先选最靠近当前图表目标者，再比较战力；否则会从本土抽一个高战力但
        // 本攻势根本到不了菲律宾的陆军，最终形成“高激活、零会战”。
        const distance=u=>typeof get_distance==="function"&&target!==null&&target!==undefined
            ?get_distance(u.location,target):99
        pool.sort((a,b)=>classRank(a)-classRank(b)||distance(a)-distance(b)||cf(b)-cf(a)||a.id-b.id)
        emPick=pool[0]?.id
    }
    return {complete:false,strict:true,required:need,strength:math,unit:amphibiousPick??emPick,
        formation:landing?"supported-amphibious-assault":f.requiresOccupation?"ground-with-support":"air-sea-strike",
        groundStrength,strikeStrength,potentialReactionStrength:f.potentialReactionStrength,supportRequired,
        ...(emPick&&emc&&emc.taskforce_math?{via:"em-marginal"}:{})}
}

function selectOperationalHq(view,candidates,role){
    if(!Array.isArray(candidates)||!candidates.length)return undefined
    const byId=new Map((view?.ai?.units||[]).map(u=>[u.id,u])),focus=view?.ai?.focus
    const axis=eop_axis(role),name=String(axis?.id||axis?.note||"").toLowerCase()
    // axis.id 主要是中文战略名。旧代码只识别英文，结果除 CBI/DEI 等英文偶合外
    // 几乎总落入 Central Pacific HQ，令其它 HQ 闲置、兵力看似“指挥部太后”。
    const preferred=role==="Allies"?(
        /(cbi|中缅印)/i.test(name)?/seac/i:
        /(dei|东印度|菲律宾|重返)/i.test(name)?/south west/i:
        /(南太平洋)/i.test(name)?/(south pacific|anzac|south west)/i:
        /(中太平洋|跳岛|轰炸|b29|登陆日本)/i.test(name)?/central pacific/i:
        /(印度|缅甸)/i.test(name)?/seac/i:/central pacific|south west/i)
        :(/(cbi|india|中缅印|印度)/i.test(name)?/south hq/i:/(central|中太平洋|马绍尔)/i.test(name)?/combined fleet/i:/south hq|south seas/i)
    const mine=role==="Japan"?JP:AP
    const commandable=id=>{const hq=byId.get(id);if(!hq)return 0
        const range=Math.max(0,Number(hq.cr)||0)
        return (view?.ai?.units||[]).filter(u=>u.faction===mine&&u.class!=="hq"&&u.location>=0
            &&(!(Number(hq.supply)||0)||((Number(u.supply)||0)&Number(hq.supply)))
            &&typeof get_distance==="function"&&get_distance(hq.location,u.location)<=range).length}
    // 夺占(requiresOccupation)目标——敌占岛屿/资源格——必须由地面单位实施两栖登陆。
    // 图表虽注“优先 Cen Pac HQ”，但 1942 年 Central Pacific 只有海空、无地面军，
    // 硬选它会激活 8 个海空单位却“无单位可达敌战格”。夺占目标下优先能指挥地面军的 HQ。
    // [opt] 判定放宽: 目标是未控制的港口/岛屿格(无论 meta 是否标注 requiresOccupation)
    // 都按“需地面两栖”选 HQ —— 否则南太平洋等两栖征服战略永远落到海空 HQ, 盟军
    // 整局 0 地面激活、0 夺格(基线实测)。基线模式(配置关)维持原判定。
    const emcHq=(typeof em_cfg==="function")?em_cfg():null
    const focusMeta=focus!==null&&focus!==undefined&&typeof eop_target_meta==="function"?eop_target_meta(role,focus):null
    const focusMd=(focus!==null&&focus!==undefined&&typeof get_map_data==="function")?get_map_data(focus):null
    const mineC=role==="Japan"?JP:AP
    const emNeedsGround=!!(emcHq&&emcHq.taskforce_math&&focus!==null&&focus!==undefined&&focusMd
        &&focusMd.port&&!is_space_controlled(focus,mineC))
    const needsGround=!!(focusMeta&&focusMeta.requiresOccupation)||emNeedsGround
    const groundCommandable=id=>{const hq=byId.get(id);if(!hq)return 0
        const range=Math.max(0,Number(hq.cr)||0)
        return (view?.ai?.units||[]).filter(u=>u.faction===mine&&u.class==="ground"&&u.location>=0
            &&(!(Number(hq.supply)||0)||((Number(u.supply)||0)&Number(hq.supply)))
            &&typeof get_distance==="function"&&get_distance(hq.location,u.location)<=range).length}
    // REDEPLOY(撤离)类战略要调动的单位是明确编号的 requiredUnits，并非“指挥部范围内
    // 任意兵力”。旧排序只按范围内单位总数挑 HQ，导致撤离马来亚/菲律宾时选到兵多但
    // 根本不含待撤离单位的 Central Pacific HQ，产生“激活 0 单位”的空攻势。这里把
    // “能指挥到待撤离单位”的 HQ 提到最前，其余照旧。
    const required=new Set()
    if(Array.isArray(axis?.targetMeta))for(const t of axis.targetMeta)
        if(t&&t.kind==="REDEPLOY"&&Array.isArray(t.requiredUnits))for(const u of t.requiredUnits)required.add(u)
    const requiredCount=id=>{if(!required.size)return 0
        const hq=byId.get(id);if(!hq)return 0
        const range=Math.max(0,Number(hq.cr)||0)
        return (view?.ai?.units||[]).filter(u=>required.has(u.id)&&u.faction===mine&&u.location>=0
            &&(!(Number(hq.supply)||0)||((Number(u.supply)||0)&Number(hq.supply)))
            &&typeof get_distance==="function"&&get_distance(hq.location,u.location)<=range).length}
    const score=id=>{const u=byId.get(id),d=u&&focus!==null&&focus!==undefined&&typeof get_distance==="function"?get_distance(u.location,focus):99
        const preview=typeof erasmus_preview_activatable_units==="function"?erasmus_preview_activatable_units(id):null
        const n=Array.isArray(preview)?preview.length:commandable(id)
        // 先排除“名义上符合战略、实际上范围内没有任何兵力”的 HQ；多个可用 HQ
        // 再按图表指定 HQ、目标距离和效能排序。夺占目标优先要“有地面军”的 HQ。
        return [n>0?0:1,needsGround?(groundCommandable(id)>0?0:1):0,
            u&&preferred.test(String(u.name||""))?0:1,-requiredCount(id),-n,d,-(u?.cm||0),-(u?.cr||0),id]}
    return candidates.slice().sort((a,b)=>{const x=score(a),y=score(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];return 0})[0]
}
function planReaction(view,candidates,action,role,strategy){
    if(!Array.isArray(candidates)||!candidates.length)return undefined
    const units=Array.isArray(view?.ai?.units)?view.ai.units:[],byId=new Map(units.map(u=>[u.id,u]))
    const mine=role==="Japan"?JP:AP, enemy=1-mine
    if(action==="card"){
        const cardsMeta=Array.isArray(view?.ai?.ownCards)?view.ai.ownCards.slice():[]
        for(const id of candidates)if(!cardsMeta.some(c=>c.id===id)&&typeof cards!=="undefined"&&cards[id])cardsMeta.push({id,name:cards[id].name,intelligence:cards[id].intelligence,reaction:cards[id].reaction})
        const wanted=String(strategy||"")
        if(wanted.includes("CARD_PRIORITY")){
            const rank=c=>{
                const n=String(c?.name||"")
                if(role==="Allies")return /intelligence|情报/i.test(n)||c?.intelligence!==undefined?0:/counter|反攻/i.test(n)?1:/ambush|伏击/i.test(n)?2:/submarine/i.test(n)?3:4
                return /jn.?25|intelligence|情报/i.test(n)||c?.intelligence!==undefined?0:/counter|反击/i.test(n)?1:/kamikaze|神风/i.test(n)?2:/submarine/i.test(n)?3:4
            }
            const byId=new Map(cardsMeta.map(c=>[c.id,c]))
            return candidates.slice().sort((a,b)=>rank(byId.get(a))-rank(byId.get(b))||a-b)[0]
        }
        const re=wanted.includes("WEATHER")?/weather/i:wanted.includes("KAMIKAZE")?/kamikaze/i
            :wanted.includes("SUBMARINE")?/submarine/i:wanted.includes("AMBUSH")?/(ambush|伏击)/i
            :wanted.includes("COUNTER")?/(counter|反攻)/i:/(jn.?25|intelligence|情报)/i
        const ids=new Set(cardsMeta.filter(c=>re.test(String(c.name||""))).map(c=>c.id))
        const hit=candidates.filter(id=>ids.has(id)).sort((a,b)=>a-b)
        return hit[0]
    }
    if(action==="action_hex"||action==="hex"){
        // 反应会战格优先级 (清单 #12)：HQ→Resource→Port→Airfield→Other。不能只取 sorted[0]，
        // 最高优先级目标可能凑不够合法反应兵力；按优先级逐个检查反应兵力标准能否达到，
        // 能达则选，否则顺延下一目标。
        const tier=h=>{
            const md=typeof get_map_data==="function"?get_map_data(h):{}
            const own=units.filter(u=>u.location===h&&u.faction===mine)
            return own.some(u=>u.class==="hq")?0:md.resource?1:md.port?2:md.airfield?3:4
        }
        const ordered=candidates.slice().sort((a,b)=>tier(a)-tier(b)||a-b)
        if(typeof queryReactionCandidates!=="function"||typeof eop_evaluate_reaction_force_standard!=="function")return ordered[0]
        const attackers=(view?.offensive?.active_units||[]).flat().map(id=>byId.get(id)).filter(u=>u&&u.faction===enemy)
        for(const h of ordered){
            try{
                const reaction=queryReactionCandidates({reactionFaction:mine,targetHex:h})
                const sel=reaction.air.concat(reaction.carrier,reaction.naval,reaction.ground).map(id=>byId.get(id)).filter(Boolean)
                // 用 D10=0 的最严情形(地面须 2x)判"能否达到反应兵力标准"。
                const std=eop_evaluate_reaction_force_standard({selectedReactionUnits:sel,attackingUnits:attackers,d10:0})
                if(std.complete)return h
            }catch(e){ return h }
        }
        return ordered[0]
    }
    // 反应兵力标准 (清单 #11)：用共享求值器判定当前缺口，每次加入最能填补缺口的
    // 一个合法单位；complete 时不再补兵。空海战力不足→航空/海军；空军数量不足→航空；
    // 地面 2x 要求未满足→地面。
    const active=new Set((view?.offensive?.active_units||[]).flat())
    const selected=[...active].map(id=>byId.get(id)).filter(u=>u&&u.faction===mine)
    const attackers=[...active].map(id=>byId.get(id)).filter(u=>u&&u.faction===enemy)
    const cf=u=>u?(u.reduced?(Number(u.rcf)||Math.ceil(u.cf/2)):(Number(u.cf)||0)):0
    const d10=typeof erasmus_hash==="function"?erasmus_hash(`${view?.seed??0}:${view?.actionOrdinal??0}:RF-D10`)%10:5
    const std=eop_evaluate_reaction_force_standard({selectedReactionUnits:selected,attackingUnits:attackers,d10})
    const rank=u=>{
        if(!u)return 3
        if(!std.airSeaOneXMet)return (u.class==="air"||u.class==="naval")?0:2
        if(!std.airCountMet)return u.class==="air"?1:2
        if(std.groundTwoXRequired&&!std.groundTwoXMet)return u.class==="ground"?0:2
        return u.class==="air"?1:u.class==="naval"?2:3
    }
    // 候选 id 可能不在 view.ai.units 投影里(增援/移出图单位) —— 排序键必须容忍缺失,
    // 否则 rank(undefined).class 直接崩溃(match 1943 seed 20260908 实测)。
    const known=candidates.filter(id=>byId.get(id))
    const unknown=candidates.filter(id=>!byId.get(id))
    known.sort((a,b)=>rank(byId.get(a))-rank(byId.get(b))||cf(byId.get(b))-cf(byId.get(a))||a-b)
    return known[0]!==undefined?known[0]:(unknown.sort((a,b)=>a-b)[0])
}

// 第6/12页 PBM 的单位顺序。落点的六级/三级优先级由 offensive.js 在计算真实合法路径后
// 评分；这里负责在交互式 unit 窗严格按“航空→海上→失败AA地面”选择，并在同类中选择
// 最强航空或稳定的最低 id。函数只读取 view.ai 的只读投影。
function planPostBattleMovement(view,candidates,action,role){
    if(!Array.isArray(candidates)||!candidates.length)return undefined
    if(action!=="unit")return undefined
    const units=Array.isArray(view?.ai?.units)?view.ai.units:[],byId=new Map(units.map(u=>[u.id,u]))
    const failed=new Set(view?.ai?.pbm?.failedAAUnits||[])
    const cf=u=>u?(u.reduced?(Number(u.rcf)||Math.ceil((Number(u.cf)||0)/2)):(Number(u.cf)||0)):0
    const rank=u=>u?.class==="air"?0:u?.class==="naval"?1:(u?.class==="ground"&&failed.has(u.id)?2:3)
    return candidates.slice().sort((a,b)=>rank(byId.get(a))-rank(byId.get(b))
        ||(rank(byId.get(a))===0?cf(byId.get(b))-cf(byId.get(a)):0)||a-b)[0]
}

// 第6/12页航空/海军 PBM 落点评分 (清单 #16/#17/#18)。落点必须先在 queryPbmDestinations
// 里被 RTT 判定合法，这里只做图表优先级评分；硬约束(一机场一空军等)由 offensive.js 的
// erasmus_pbm_target_score 以返回 null(=legal false) 表达，而非扣分。返回 null 表示该格
// 非法或不属于该兵种，不应被选。
function scoreAirPbmDestination(unit, hex, ctx) {
    if (typeof erasmus_pbm_target_score !== "function") return null
    const piece = pieces[unit]
    if (!piece || piece.class !== "air") return null
    const source = G.location[unit]
    const faction = piece.faction
    const plan = (ctx && ctx.targetPlan) || null
    return erasmus_pbm_target_score(hex, faction, piece, source, plan)
}

function scoreNavalPbmDestination(unit, hex, ctx) {
    if (typeof erasmus_pbm_target_score !== "function") return null
    const piece = pieces[unit]
    if (!piece || piece.class !== "naval") return null
    const source = G.location[unit]
    const faction = piece.faction
    const plan = (ctx && ctx.targetPlan) || null
    return erasmus_pbm_target_score(hex, faction, piece, source, plan)
}
