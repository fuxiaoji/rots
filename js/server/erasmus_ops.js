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
    // [opt 1943 PW-survival] 被占领区紧急夺回: 政治阶段 ALASKA/HAWAII 占领计时
    // (check_occupation)走到期即 -1 PW, 且日本不主动撤出。把占领事件 keys 中仍被
    // 日本控制/驻军的格作为紧急 CONQUEST 前置(夺回即清计时), 插在 raid 资源格之前;
    // 可行性仍由激活窗 composeTaskForce 过滤(编不出单位自动顺延, 不锁死预算)。
    const urgent = []
    try {
        if (typeof events !== "undefined" && typeof hex_to_int === "function") {
            for (const ev of [events.ALASKA_OCCUPATION, events.HAWAII_OCCUPATION]) {
                if (!ev || !Array.isArray(ev.keys) || !is_event_active(ev)) continue
                for (const k of ev.keys) {
                    const h = hex_to_int(k)
                    if (!(h >= 0 && h <= LAST_BOARD_HEX) || inChain.has(h)) continue
                    if (!is_space_controlled(h, JP)) continue
                    // 可达性门槛: 距盟军地面前沿 ≤12 才前插(否则编不出单位的远洋格
                    // 会占住链首焦点, 反拖推进方向)。
                    if (d(h) > 12) continue
                    if (!urgent.includes(h)) urgent.push(h)
                }
            }
        }
    } catch (e) { /* 事件层不可用则跳过 */ }
    conquests.sort((a, b) => d(a) - d(b) || a - b)
    garrisons.sort((a, b) => d(a) - d(b) || a - b)
    const ordered = urgent.sort((a, b) => d(a) - d(b) || a - b).concat(conquests)
    // 插入点: [opt 1943 raid-first] 链首连续 pending 的"资源格夺占"目标才保留链首位
    // (计满 emBlkInsAfterPending 个为止)。基线口径把任何 pending 夺占目标(如中太平洋
    // 环礁/DEI战略的 Timor/Kendari)都计在前插让位数内, 实测 1943 链首被 2 个非资源
    // 目标占位, 资源 raid 稳定排第 3 位之后 —— 与 16.2 资源主轴相悖。改为: 非资源
    // pending(环礁/压制/普通命名格)一律让位, 资源格 CONQUEST 稳定占据链首前 3。
    let ins = 0
    const cap = Math.min(Number(emcBR.emBlkInsAfterPending) || 2, ov.chain.length)
    for (let i = 0; i < cap; ++i) {
        const m = meta0.find(t => t.hex === ov.chain[i])
        const mdI = (typeof get_map_data === "function") ? get_map_data(ov.chain[i]) : null
        if (m && m.kind !== "GARRISON" && m.kind !== "REDEPLOY" && mdI && mdI.resource
            && eop_target_pending("Allies", ov.chain[i], m)) ins = i + 1
        else break
    }
    const meta = meta0.slice()
    const newHexes = []
    for (const h of ordered) {
        const at = meta.findIndex(t => t.hex === h)
        if (at >= 0) meta.splice(at, 1)
        const mdH = (typeof get_map_data === "function") ? get_map_data(h) : null
        const isUrgent = urgent.includes(h)
        meta.push({ hex: h, kind: "CONQUEST", requiresOccupation: true, damageLevel: 1,
            objective: isUrgent ? "紧急夺回被占领区(清除 ALASKA/HAWAII 占领 PW 计时)"
                : "封锁 raid: 夺占日本资源格(16.47 trace 断链胜利主路)",
            victoryConstraint: isUrgent ? "OCCUPATION_RETAKE" : "JAPAN_RESOURCE_BLOCKADE" })
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
    const eopChainRaw = eop_axis_chain(mine === JP ? "Japan" : "Allies")
    // [opt chain_prereq] 前置跳板闸门: 未具备前置(己控相邻/陆路连通/己控港口机场≤
    // emChainPrereqDist/己方地面在旁)的纵深目标顺延到链后, 焦点不再一步跳到纵深;
    // flag 关时 eopChainOrder === eopChainRaw, 控制流与迭代顺序逐位一致。
    // [opt japan_opening_conquest §5] 夺而必守的驻守项降级: 链上存在任何"夺占"pending 时,
    // "己控但未驻守"的 retain 项不抢焦点(否则焦点卡死在已夺格上, 征服停滞 —— ampv3 实测);
    // 全链无夺占项时才轮到驻守消费空闲预算。
    let retainFocus = null
    const eopChainOrder = eop_chain_prereq_defer(mine === JP ? "Japan" : "Allies", eopChainRaw)
    for (const idx of eopChainOrder) {
        if (idx < 0 || idx > LAST_BOARD_HEX) continue
        const meta = eop_target_meta(mine === JP ? "Japan" : "Allies", idx)
        if (meta) {
            if (eop_target_pending(mine === JP ? "Japan" : "Allies", idx, meta)) {
                if (meta.retainWithGround && is_space_controlled(idx, mine)) {
                    if (retainFocus === null) retainFocus = idx
                    continue
                }
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
    if (retainFocus !== null) return retainFocus
    return null
}
// [opt japan_opening_conquest §5] retain 项分区: 链上存在夺占 pending 时丢弃 retain-held
// 项(驻守让位征服); 全部为 retain-held 时原样保留(空闲预算驻守)。
function eop_partition_retain(role, hexes) {
    if (!Array.isArray(hexes) || !hexes.length) return hexes
    const mine = role === "Japan" ? JP : AP
    const isRetainHold = h => {
        const m = eop_target_meta(role, h)
        return !!(m && m.retainWithGround && is_space_controlled(h, mine))
    }
    const capture = hexes.filter(h => !isRetainHold(h))
    return capture.length ? capture : hexes
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
    // [opt amph-quality] 第二战斗格与激活窗同一风险闸门: 无护航可会合/港内强敌舰的
    // 登陆格不申报 —— 旧逻辑只看"簇内+有敌军", 造出大量必败会战(broken_aa 主因之一)。
    // [opt amph-quality §2] 优先"已激活地面两栖可达"(≤海军航程)的簇格: 已激活编队
    // 到不了的格申报了也只有零星余部能登陆 → 必败。
    let best = null, bestScore = null
    const navalReach = Math.max(2, Number(G.offensive.naval_move_distance) || 3)
    const activatedGroundLocs = (() => {
        const s = new Set()
        try {
            const act = (G.offensive && G.offensive.active_units && G.offensive.active_units[mine === JP ? JP : AP]) || []
            for (const u of (Array.isArray(act) ? act : []).flat ? act.flat() : act) {
                const p = pieces[u]
                if (p && p.class === "ground" && G.location[u] >= 0 && G.location[u] <= LAST_BOARD_HEX) s.add(G.location[u])
            }
        } catch (e) {}
        return s
    })()
    const reachable = h => {
        if (!activatedGroundLocs.size || typeof get_distance !== "function") return 1
        let bestD = 99
        for (const loc of activatedGroundLocs) bestD = Math.min(bestD, get_distance(loc, h))
        return bestD <= navalReach + 1 ? 1 : 0
    }
    for (const h of candidates) {
        if (!cluster.has(h) || !hasEnemy(h)) continue
        if (eop_amph_declare_blocked(role, h)) continue
        const d = typeof get_distance === "function" ? get_distance(h, focus) : Math.abs(h - focus)
        const score = [reachable(h) ? 0 : 1, d, h]
        if (bestScore === null || score[0] < bestScore[0]
            || (score[0] === bestScore[0] && score[1] < bestScore[1])
            || (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] < bestScore[2])) { best = h; bestScore = score }
    }
    return best !== null ? best : undefined
}

// [opt amph-quality] 会战申报级两栖风险闸门(与激活窗 island_sweep 预检同源):
// 敌控沿海格若 (a) 无护航可会合 或 (b) 港内停有 ≥emSweepHarborNav cf 敌舰,
// 申报该格会战 = broken_aa / "could not participate" 必败会战。返回 true 表示应跳过。
// 仅优化层开启时生效; 基线恒 false(行为逐位不变)。
function eop_amph_declare_blocked(role, hex) {
    const emc = (typeof em_cfg === "function") ? em_cfg() : null
    if (!emc || !(emc.island_sweep || emc.taskforce_math || emc.erasmus_plus)) return false
    if (!(hex >= 0 && hex <= LAST_BOARD_HEX)) return false
    const mine = role === "Japan" ? JP : AP
    if (is_space_controlled(hex, mine)) return false
    // 己方地面已在格内 = 陆战续打, 不属"新登陆"风险
    for (let u = 1; u < pieces.length; ++u) {
        const p = pieces[u]
        if (p && p.faction === mine && p.class === "ground" && G.location[u] === hex) return false
    }
    const md = (typeof get_map_data === "function") ? get_map_data(hex) : null
    if (!md || !(md.port || md.island || md.coastal)) return false
    const enemyF = role === "Japan" ? AP : JP
    let defNav = 0
    for (let u = 1; u < pieces.length; ++u) {
        const p = pieces[u]
        if (!p || p.faction !== enemyF || p.class !== "naval" || G.location[u] !== hex) continue
        defNav += p.reduced ? (Number(p.rcf) || Math.ceil((Number(p.cf) || 0) / 2)) : (Number(p.cf) || 0)
    }
    if (defNav >= (Number(emc.emSweepHarborNav) || 6)) return true
    if (typeof eop_landing_no_escort_for === "function" && eop_landing_no_escort_for(role, null, hex)) return true
    return false
}

// ---- 选目标格 (action_hex 参数) ------------------------------------------
// 优先当前焦点; 焦点不可达时, 在候选里选距离焦点最近的格(逐步靠近主轴),
// 而不是随机散打。无焦点(= 无主轴或主轴已全达成)时返回 undefined 让原逻辑决定。
// [opt amph-quality] 优化层开启时, 候选里"必败两栖会战格"(无护航可会合/港内强敌舰)
// 靠后: 若存在其它可选格则避开 —— 首要战斗格与次级战斗格同一风险闸门。
// 基线(配置关)逐位不变(过滤集恒空)。
function eop_pick_action_hex(candidates, role, view) {
    if (!Array.isArray(candidates) || candidates.length === 0) return undefined
    // [opt stack_limit_gate] 落点叠放闸门(decide 侧; 紧急移动/撤离/增援落位等 action_hex 窗):
    // 引擎在落位/移动时完全不拦, 只在阶段末 check_overstacking 事后清罚(位移 1-2 回合,
    // 不可替换/断补者直接歼灭)。这里先剔除"放进去会超编"的候选格:
    //   已知当前编组单位(G.active_stack) 时用引擎 is_overstack 精确判;
    //   判不出兵种时退回"该格地面/航空(共用桶 ≤3)与海军(桶 ≤6)都还有余量"的保守判据。
    // 全部候选都满时保持原候选集(不制造空窗/死锁)。flag 关时候选逐位不变。
    let pool = candidates
    if (em_flag("stack_limit_gate")) {
        const mine = role === "Japan" ? JP : AP
        const stackedUnit = (typeof G !== "undefined" && G && Array.isArray(G.active_stack) && G.active_stack.length
            && Number.isInteger(G.active_stack[0]) && pieces[G.active_stack[0]] && typeof is_overstack === "function")
            ? G.active_stack[0] : null
        const fits = h => {
            try {
                if (stackedUnit !== null) return !is_overstack(h, stackedUnit)
                const r = headless_units_at(h, mine)
                return (r.ground + r.air) < 3 && r.naval < 6
            } catch (e) { return true }
        }
        const fitList = candidates.filter(fits)
        if (fitList.length) pool = fitList
    }
    const focus = eop_focus(role)
    if (focus === null) return undefined
    const emcAH = (typeof em_cfg === "function") ? em_cfg() : null
    if (emcAH && (emcAH.island_sweep || emcAH.erasmus_plus) && typeof eop_amph_declare_blocked === "function") {
        const safe = candidates.filter(h => !eop_amph_declare_blocked(role, h))
        if (safe.length) pool = safe
    }
    let best = null, bestD = Infinity
    for (const h of pool) {
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
            // [opt landing_value] 簇内无价值礁格(无资源/机场/港口/名/城市)不撒兵:
            // 占下来既不产资源也不推进投降, 只把兵力摊薄成孤军。
            try {
                const emcLV = (typeof em_cfg === "function") ? em_cfg() : null
                if (emcLV && emcLV.landing_value && ch !== focusHex && typeof get_map_data === "function") {
                    const mdC = get_map_data(ch)
                    if (mdC && !(mdC.resource || mdC.port || mdC.airfield || mdC.named || (mdC.city >= 1))) { if (dlog) dlog(`  hex=${ch} skip noValue`); continue }
                }
            } catch (e) { /* 地图/配置不可用时照常尝试编组 */ }
            let ownGround = false
            for (let u = 1; u < pieces.length; ++u) {
                const p = pieces[u]
                if (p && p.faction === (role === "Japan" ? JP : AP) && p.class === "ground" && G.location[u] === ch) { ownGround = true; break }
            }
            if (ownGround) { if (dlog) dlog(`  hex=${ch} skip ownGround`); continue }
            // [opt stack_limit_gate] 该簇格地面/航空位已满(引擎每格每方 ≤3, 地面与航空共用
            // 同一 bucket)则不再撒第二支登陆军: 超编单位在阶段末 check_overstacking 会被
            // 位移到回合盒甚至歼灭 —— 比不登陆更亏。海军独立桶(≤6)不受此限。
            if (em_flag("stack_limit_gate")) {
                const ownAtCh = headless_units_at(ch, role === "Japan" ? JP : AP)
                if ((ownAtCh.ground + ownAtCh.air) >= 3) { if (dlog) dlog(`  hex=${ch} skip stackFull`); continue }
            }
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

// ============================================================================
// [opt force_concentration] 集中兵力 (主动发起会战前把可达海空+必要地面编到明显优势)
// ============================================================================
// 取证 (15 局 seed 20260910-24, profile 5.0 默认档, 双方 erasmus-v2-opt):
//   主动会战进攻方投入单位数 中位数 1 (JP 324/589、AP 236/364 恰为 1 个单位), 守方中位数
//   2-3; 双方火力差(最大阶段) 中位数 JP 0 / AP -3, 均值 -5.0 / -6.1。
//   申报窗分解 (2 局 34 窗): 每攻势激活 ~3.7 单位, 其中只有 46% 进入引擎 possible_units,
//   26% 是无 br 的地面单位, 28% 是当轮打不到任何敌格的空/海。
// 引擎口径 (offensive.js compute_possible_battle_hexes):
//   战斗格 = 【已激活单位】br/ebr 航程 ∩ 敌占格, 且该单位本轮未走 STRAT_MOVE/
//   AIR_EXTENDED_MOVE、当前不在敌占格、未被 B29 轰炸。**打不到该格的已激活单位对会战
//   零贡献**, 只吃激活预算 → 每场会战实际只有 1 个单位的原因就在这里。
// 本段给出"引擎精确兵力对比 + 可达候选集"的统一求值器, 供【编组候选可达性过滤】与
// 【申报窗集中格选点】两处共用 (激活端强行补兵的钩子已实测否决, 见 eop_pick_unit 留档);
// 全部挂在 em_flag("force_concentration") 之后, flag 关时任何返回值都不进决策路径。
function eop_conc_cf(unitId) {
    const p = (typeof pieces !== "undefined") ? pieces[unitId] : null
    if (!p) return 0
    const reduced = (typeof G !== "undefined" && G && G.reduced && typeof set_has === "function") ? set_has(G.reduced, unitId) : false
    return reduced ? (Number(p.rcf) || Math.ceil((Number(p.cf) || 0) / 2)) : (Number(p.cf) || 0)
}

// 目标格兵力对比 (引擎精确):
//   守军 = 目标格内敌方实兵 (全盘 pieces+G.location, 与引擎 prepare_battle 的
//          for_each_unit_on_map 同源; 与 eop_evaluate_damage_level 的 defenders 口径一致);
//   反应 = queryReactionCandidates 逐 id 累计空/海 (与 reactionIds 同源) × emReactionWeight
//          (反应需掷骰/天气成立, 非必然到场; 权重与 em_amphib_assessment 的保守边际一致);
//   需求 = margin × (守军空海 + 加权反应空海); 占领目标另需地面 ≥ 2×守军地面 (图表 2x 生存)。
//   可达 = 引擎 queryCombatParticipation 合法者; 两栖登陆按 eop_filter_legal_participants
//          的同一口径放行(asp/strat_move 地面 + 护航海军, 引擎 AMPH_MOVE 是组级合法性,
//          单位级 BFS 判不了)。
// 返回 null = 本格无对比意义(无守军且无可反应兵力)或 flag 关。
function eop_concentration_assess(role, view, target, ids, committed) {
    if (typeof em_flag !== "function" || !em_flag("force_concentration")) return null
    if (!Number.isInteger(target) || typeof pieces === "undefined" || typeof G === "undefined" || !G) return null
    const emc = (typeof em_cfg === "function") ? em_cfg() : null
    const margin = (emc && Number(emc.emConcentrationMargin)) || 1.5
    const minUnits = Math.max(1, (emc && Number(emc.emConcentrationMinUnits)) || 3)
    const w = (emc && Number(emc.emReactionWeight)) || 0.35
    const mine = role === "Japan" ? JP : AP, enemy = 1 - mine
    // 守军取**全盘实兵**(pieces + G.location, 与引擎 prepare_battle 的 for_each_unit_on_map
    // 同源, 比 view.ai.units 更权威): 目标格内敌方实兵, 不区分阶段。
    let defAirSea = 0, defGround = 0, enemyAt = 0
    const seenDef = new Set()
    if (typeof pieces !== "undefined" && Array.isArray(pieces)) {
        for (let u = 1; u < pieces.length; ++u) {
            const p = pieces[u]
            if (!p || p.faction !== enemy || G.location[u] !== target) continue
            seenDef.add(u); ++enemyAt
            if (p.class === "ground") defGround += eop_conc_cf(u); else defAirSea += eop_conc_cf(u)
        }
    }
    // view 仅在无法读全局棋盘时作为补集(单测 vm 沙箱)
    if (view && view.ai && Array.isArray(view.ai.units)) {
        for (const u of view.ai.units) {
            if (!u || u.faction !== enemy || u.location !== target || seenDef.has(u.id)) continue
            seenDef.add(u.id); ++enemyAt
            const cfv = u.reduced ? (Number(u.rcf) || Math.ceil((Number(u.cf) || 0) / 2)) : (Number(u.cf) || 0)
            if (u.class === "ground") defGround += cfv; else defAirSea += cfv
        }
    }
    let reactAirSea = 0
    try {
        if (typeof queryReactionCandidates === "function") {
            const rc = queryReactionCandidates({ reactionFaction: enemy, targetHex: target })
            const seen = new Set()
            for (const id of (rc.air || []).concat(rc.carrier || [], rc.naval || [])) {
                if (seen.has(id)) continue
                seen.add(id)
                if (G.location[id] === target) continue
                reactAirSea += eop_conc_cf(id)
            }
        }
    } catch (e) { /* 反应查询不可用则只用守军 */ }
    const meta = (typeof eop_target_meta === "function") ? eop_target_meta(role, target) : null
    const needGround = !!(meta && meta.requiresOccupation) || defGround > 0
    // 达标判据与 eop_evaluate_damage_level 同构, 只是把 damageLevel=1 的"打平即可"换成
    // margin 倍优势(用户要求: 主动会战前须取得明显优势)。SUPPRESS 类只看空海。
    const needAS = margin * (defAirSea + w * reactAirSea)
    const needG = needGround ? Math.max(1, 2 * defGround) : 0
    // 可达该格的候选集(引擎 participate; 两栖放行与 eop_filter_legal_participants 同口径)
    const fightIds = new Set()
    let mdT = null
    try { mdT = (typeof get_map_data === "function") ? get_map_data(target) : null } catch (e) { mdT = null }
    let amphT = false
    try { amphT = !!mdT && (mdT.port || mdT.island) && !is_space_controlled(target, mine) } catch (e) { amphT = false }
    for (const id of (Array.isArray(ids) ? ids : [])) {
        const p = pieces[id]
        if (!p || p.faction !== mine) continue
        try {
            if (typeof queryCombatParticipation === "function" && queryCombatParticipation(id, target, {}).legal) { fightIds.add(id); continue }
            if (!amphT) continue
            if (p.class === "naval") { fightIds.add(id); continue }
            if (p.class === "ground" && (p.asp || p.strat_move)) fightIds.add(id)
        } catch (e) { /* 查询异常按不可达(调用方保留原候选集, 不改变行为) */ }
    }
    let attAirSea = 0, attGround = 0, attCount = 0
    const committedIds = new Set()
    for (const x of (Array.isArray(committed) ? committed : [])) {
        const id = (typeof x === "number") ? x : (x && x.id)
        if (!Number.isInteger(id) || committedIds.has(id)) continue
        committedIds.add(id)
        const p = (typeof x === "number") ? pieces[id] : x
        if (!p) continue
        ++attCount
        if (p.class === "ground") attGround += eop_conc_cf(id); else attAirSea += eop_conc_cf(id)
    }
    return { mine, enemy, defAirSea, defGround, enemyAt, reactAirSea, needAS, needG, needGround, minUnits, margin,
        fightIds, amphT, attAirSea, attGround, attCount,
        shortAS: needAS - attAirSea, shortG: needG - attGround, shortUnits: minUnits - attCount,
        // decisive = 海空达标 ∧ 地面达标(若需) ∧ 单位数达标
        decisive: attAirSea >= needAS && attGround >= needG && attCount >= minUnits }
}

// [opt force_concentration] 申报窗"集中格"选点: 在本次可达的候选战斗格里挑"能共同投入的
// 已激活单位最多、且我方引擎口径兵力优势最大"的那一格, 让同一支攻势的各单位收敛到同一场
// 会战(而不是各自就近宣战把编队拆成 n 场 1 单位会战)。
// 两道保守闸门(避免"为集中而丢战略"):
//   ① 必须 ≥2 支已激活单位可共同投入 —— 单单位场合与基线(离焦点最近)逐位相同;
//   ② 必须 ≥1 支已激活**地面**单位可到达该格 —— 只有地面能真正夺格, 纯海空优势格会把
//      兵力从夺格主轴上拉走(实测缺此闸门时 4 seed 盟军夺格 37→17)。
// 不满足即返回 undefined 交回原逻辑, 不会把攻势拉离战略主轴。
function eop_pick_concentration_hex(candidates, role, view) {
    const emc = (typeof em_cfg === "function") ? em_cfg() : null
    if (!emc || !emc.force_concentration) return undefined
    if (!Array.isArray(candidates) || !candidates.length) return undefined
    if (typeof G === "undefined" || !G || !G.offensive) return undefined
    if (typeof queryCombatParticipation !== "function") return undefined
    const mine = role === "Japan" ? JP : AP
    let act = []
    try { act = (G.offensive.active_units && G.offensive.active_units[mine]) ? [].concat(G.offensive.active_units[mine]) : [] } catch (e) { return undefined }
    // 只统计能作为会战投送兵力的单位(引擎 possible_units 口径: 有 br 的空/海; 地面另有
    // 登陆/推进路径, 也用 participate 判定)
    const pool = act.filter(id => { const p = pieces[id]; return p && p.faction === mine && p.class !== "hq" })
    if (pool.length < 2) return undefined
    const ground = pool.filter(id => { const p = pieces[id]; return p && p.class === "ground" })
    if (!ground.length) return undefined
    const focus = (typeof eop_focus === "function") ? eop_focus(role) : null
    // 候选格按"离焦点近"排序后取前 8 个(限制查询量的上界; 引擎本窗候选通常 ≤7)
    let cands = candidates.filter(h => Number.isInteger(h))
    if (typeof get_distance === "function" && Number.isInteger(focus))
        cands = cands.slice().sort((a, b) => (get_distance(a, focus) - get_distance(b, focus)) || (a - b)).slice(0, 8)
    let best = null, bestKey = null
    for (const h of cands) {
        // 可达集用与 composeTaskForce 选兵同一口径(eop_concentration_assess.fightIds:
        // 引擎 participate 判定 + 两栖登陆放行), 保证"能共同投入"与"能被编进任务部队"一致。
        const a = eop_concentration_assess(role, view, h, pool, pool)
        if (!a) continue
        const converge = pool.filter(id => a.fightIds.has(id)).length
        if (converge < 2) continue
        const gConverge = ground.filter(id => a.fightIds.has(id)).length
        if (gConverge < 1) continue
        const surplus = Math.min(a.attAirSea - a.needAS, a.needG > 0 ? a.attGround - a.needG : Infinity)
        const key = [a.decisive ? 0 : 1, -gConverge, -converge, -surplus, h]
        if (bestKey === null || cmpKey(key, bestKey) < 0) { bestKey = key; best = h }
    }
    return best === null ? undefined : best
}
function cmpKey(x, y) { for (let i = 0; i < x.length; ++i) if (x[i] !== y[i]) return x[i] - y[i]; return 0 }

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
    // [opt amphib_escort] 护航"补到够"而非"只补一支": 引擎 broken_aa 只要目标格
    // 有守方/反应方海军而攻方护航为空, 即判 "Amphibious Assault failed due to lack of
    // naval escort"; 护航战力不敌时 apply_naval_winner 判登陆部队"不得参战"。旧实现
    // `!actNaval` 一旦为真就永不再补 → 敌方反应随便调一支海军即登陆失败(用户取证:
    // 旁边就有战列舰却不激活)。
    // 口径(有界, 防"护航吃光激活点"): 需要的是【护航海军】, 航空不计入护航;
    //   ① 守方在目标格有海军 → 护航海军战力 ≥ margin × 守方海军战力;
    //   ② 存在可反应的海军/航母 → 至少编入一支护航海军(反应兵力只判"有无", 不按
    //      全额战力索要 —— 反应需掷骰/天气成立, 全额索要会把激活点全吃在护航上,
    //      反而登不上岸; 实测按全额索要时盟军资源压制指标恶化)。
    // 候选海军用尽即放行(交给 em_amphib_assessment 的中止闸门决定是否取消攻势)。
    const emcEsc = (typeof em_cfg === "function") ? em_cfg() : null
    let escortShort = false
    if (landing && emcEsc && emcEsc.amphib_escort_math) {
        const cfEsc = u => { const p = pieces[u]; if (!p) return 0
            return set_has(G.reduced, u) ? (Number(p.rcf) || Math.ceil((Number(p.cf) || 0) / 2)) : (Number(p.cf) || 0) }
        const enemyF = 1 - mine
        let attNaval = 0, attNavalCount = 0
        for (const u of activated) { const p = pieces[u]; if (p && p.class === "naval") { attNaval += cfEsc(u); ++attNavalCount } }
        let defNaval = 0
        for (let u = 1; u < pieces.length; ++u) {
            const p = pieces[u]
            if (!p || p.faction !== enemyF || G.location[u] !== focus) continue
            if (p.class === "naval") defNaval += cfEsc(u)
        }
        let hasReactionNaval = false
        try {
            if (typeof queryReactionCandidates === "function") {
                const rc = queryReactionCandidates({ reactionFaction: enemyF, targetHex: focus })
                for (const id of rc.naval.concat(rc.carrier)) {
                    const p = pieces[id]
                    if (!p || G.location[id] === focus) continue
                    if (p.class === "naval") hasReactionNaval = true
                }
                // rc.carrier 里已含航母; 航空反应不触发 broken_aa, 不计入护航需求。
            }
        } catch (e) { /* 反应查询不可用时只用守军估计 */ }
        const margin = Number(emcEsc.emAmphNavalMargin) || 1
        escortShort = (attNaval < margin * defNaval) || (attNavalCount === 0 && (defNaval > 0 || hasReactionNaval))
    }
    if (landing && (!actNaval || escortShort)) {
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

    // [opt force_concentration] 已实测否决的替代方案(留档, 防再次踩坑): 曾在此处以
    // "未达 emConcentrationMargin 倍优势就继续补兵"的选兵钩子强行集兵 —— 4 seed
    // 对照(seed 20260910-13, profile 5.0 默认档 + 该 flag): 主动会战胜率 JP 0.225→0.135、
    // AP 0.171→0.088, 夺格 45→25 / 37→16, 且每场会战投入单位数中位数仍为 1。
    // 结论: 在激活端加兵 ≠ 同一场会战加兵 —— 引擎 compute_possible_battle_hexes 只收
    // "当轮 br/ebr 覆盖敌占格"的已激活单位, 落点由无头推进(island_sweep 簇分流/焦点轮换)
    // 与 HQ 激活上限共同决定。故集中兵力只落在【申报窗选格】一处:
    // 见 eop_pick_concentration_hex。

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
    // [opt island_sweep/erasmus_plus] 扫荡焦点(空虚敌控格, 无 targetMeta): 只有地面单位
    // 能"移入即夺格", 空军/海军激活无夺格贡献。此类焦点优先激活最近的地面候选。
    // 基线(配置关)不进入该分支。
    const emcXW = (typeof em_cfg === "function") ? em_cfg() : null
    if (emcXW && (emcXW.island_sweep || emcXW.erasmus_plus) && focus !== null
        && focusMeta === null && !is_space_controlled(focus, mine)
        && typeof is_faction_units === "function" && !is_faction_units(focus, 1 - mine)) {
        const groundScored = scored.filter(([u]) => { const p = pieces[u]; return p && p.class === "ground" })
        if (groundScored.length) {
            groundScored.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0])
            return groundScored[0][0]
        }
    }
    // [opt ERASMUS_PLUS M4] 占领目标: 地面候选中"陆路可达焦点"者优先, 防止跨海峡
    // 两栖误选(取证: 25军沿马来半岛陆路可下新加坡, 却按 hex 距离选了海峡对岸的
    // 38军/马尼拉卫戍——单位被激活但无法执行=浪费攻势)。基线(配置关)不变。
    const emcLR = (typeof em_cfg === "function") ? em_cfg() : null
    if (focusMeta && focusMeta.requiresOccupation && focus !== null
        && emcLR && (emcLR.erasmus_plus || emcLR.taskforce_math)
        && typeof queryGroundReachability === "function") {
        const landScored = [], amphScored = []
        for (const entry of scored) {
            const u = entry[0]
            const p = pieces[u]
            if (!p || p.class !== "ground") { amphScored.push(entry); continue }
            let land = false
            try {
                const locU=G.location[u]
                land = (locU>=0&&locU<=LAST_BOARD_HEX&&typeof ep_land_connected==="function")?ep_land_connected(locU,focus):false
            } catch (e) { land = false }
            ;(land ? landScored : amphScored).push(entry)
        }
        if (landScored.length) {
            landScored.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0])
            return landScored[0][0]
        }
    }
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
    const mine = role === "Japan" ? JP : AP
    const focus = Number.isInteger(targetHex) ? targetHex : eop_focus(role)
    if (focus === null) return false
    const meta = eop_target_meta(role, focus)
    // [opt amph-quality] 无 targetMeta 的敌控沿海/岛屿格(岛群簇格、扫荡格)同样按
    // "需夺占登陆"预检 —— 旧口径直接放行, 簇分流会往有守军/敌舰的格裸登陆。
    if (!meta || !meta.requiresOccupation) {
        const emcCM = (typeof em_cfg === "function") ? em_cfg() : null
        if (!emcCM || !(emcCM.island_sweep || emcCM.taskforce_math || emcCM.erasmus_plus)) return false
        const mdC = (typeof get_map_data === "function") ? get_map_data(focus) : null
        if (!mdC || !(mdC.port || mdC.island || mdC.coastal)) return false
        if (is_space_controlled(focus, mine)) return false
    }
    const md = (typeof get_map_data === "function") ? get_map_data(focus) : null
    // [opt amph-coast] 登陆格判定与 composeTaskForce 同口径(沿海敌控格亦可登陆);
    // 基线(配置关)维持 md.port。
    const emcMD = (typeof em_cfg === "function") ? em_cfg() : null
    if (!md || !(md.port || (emcMD && (emcMD.taskforce_math || emcMD.island_sweep || emcMD.erasmus_plus) && md.coastal))) return false
    if (is_space_controlled(focus, mine)) return false
    // 可新增单位里是否同时存在海军和两栖地面。护航舰不要求与登陆军从同一港口
    // 出发；引擎只在会战结算时检查目标格内是否有进攻方海军。旧的“必须同格出发”
    // 预检会错误取消台湾陆军 + 南海舰队这类合法编成，制造空攻势。
    // [opt amph-quality] 申报窗(view 为 null)回退: 可用候选 = 本方全部在图单位。
    // 实测(ampv4/v5)按"已激活剩余/距离可达"收窄会把盟军大量本可成功的登陆一并
    // 闸掉(盟军海陆军开局分散, 收窄后配对几乎恒不成立 → 空攻势激增、节奏崩坏),
    // 故保留全量口径, 精度交给期望评估的护航折算。
    const cand = (view && Array.isArray(view.actions && view.actions.unit)) ? view.actions.unit
        : (view ? [] : (() => {
            const out = []
            for (let u = 1; u < pieces.length; ++u) {
                const p = pieces[u]
                if (p && p.faction === mine) out.push(u)
            }
            return out
        })())
    const unsel = new Set(view && Array.isArray(view.unselect) ? view.unselect : [])
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
        // [opt amph-quality] 配对护航不再作硬性前置中止: broken_aa 只由"会战格上守方海军"
        // 决定, 期望评估(em_amphib_assessment)按护航可会合性精确折算后统一裁决 ——
        // 裸登陆守军纯地面的岛礁(太平洋典型)合法且常胜, 不再被误杀。
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
    // [opt amph-quality] 护航战力按"可真实参战"折算: 只有与两栖地面同格(引擎 AMPH 编组/
    // pure-naval 进已宣战斗格)或 emAmphEscortDist 内可会合的海军计入全额, 其余候选海军
    // 只按 emReactionWeight 计入(需要"已宣战斗格+海军航程可达"才成立, 非必然到场)。
    // 旧口径把全部候选海军记全额 → 远方舰队虚增护航战力 → 裸陆战队被放行进敌舰港
    // (broken_aa / "could not participate" 主因之一)。
    const groundLocsG = new Set()
    for (const u of cand) {
        if (unsel.has(u)) continue
        const p = byId(u)
        if (p && p.class === "ground" && (p.asp || p.strat_move) && G.location[u] >= 0 && G.location[u] <= LAST_BOARD_HEX) groundLocsG.add(G.location[u])
    }
    const escortDistG = Number(emc.emAmphEscortDist) || 4
    const pairedEscort = u => {
        const loc = G.location[u]
        if (groundLocsG.has(loc)) return true
        if (typeof get_distance !== "function") return false
        for (const gl of groundLocsG) if (get_distance(loc, gl) <= escortDistG) return true
        return false
    }
    let attNavalCF = 0, attAirCF = 0, attGroundCF = 0, attNavalHasBr = false
    const attGroundLfs = []
    const reactW = Number(emc.emReactionWeight) || 0.35
    for (const u of cand) {
        if (unsel.has(u)) continue
        const p = byId(u); if (!p) continue
        if (p.class === "naval") {
            const paired = pairedEscort(u)
            attNavalCF += paired ? cfOf(u) : cfOf(u) * reactW
            if (Number(p.br) > 0) attNavalHasBr = true
        }
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
    // 按 emReactionWeight(默认 0.5) 折算 —— 反应需掷骰/天气/编制成立, 非必然到场。
    // [opt amph-quality] 反应战力单独传入(defReactionCF): broken_aa 只由"会战格上守方
    // 海军"决定, 反应只折损期望 —— 与守军同池折算会把全部裸登陆误杀(实证 ampv1
    // 盟军两栖成功 31→24)。
    let defReactionCF = 0
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
                if (p.class === "air" || p.class === "naval") defReactionCF += cfOf(id) * rw
            }
        }
    } catch (e) { /* 反应查询不可用时保留焦点守军估计 */ }
    const assess = em_amphib_assessment({ attacker: mine, targetHex: focus,
        attNavalCF, attNavalHasBr, attAirCF, attGroundCF, attGroundLfs,
        defNavalCF, defNavalHasBr, defAirCF, defGroundCF, defGroundLfs, defReactionCF })
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
        // [opt 1943 PoW] 命名空虚格优先: 政治阶段 PoW 只统计 md.named 夺格
        // (game.js capture_hex set_toggle G.capture), 未命名格不计分。同距离下把编队
        // 推向命名格(港/机场/城市/资源格), 使"推进夺格"兜底同时喂养 PoW 配额。
        let d = 99, dNamed = 99
        for (const h of emptyEnemy) {
            const dd = get_distance(loc, h)
            if (dd < d) d = dd
            const mdH = (typeof get_map_data === "function") ? get_map_data(h) : null
            if (mdH && (mdH.name || mdH.resource || mdH.port || mdH.airfield) && dd < dNamed) dNamed = dd
        }
        const namedOk = dNamed <= maxD
        const dEff = namedOk ? dNamed : d
        if (dEff > maxD) continue
        // 减损地面不参与推进兜底(1 step 损失, 被敌反攻即歼灭; 留守待整编)。
        if (G.reduced && (typeof set_has === "function" ? set_has(G.reduced, u) : G.reduced.includes(u))) continue
        const score = [namedOk ? 0 : 1, dEff, (p.asp || p.strat_move) ? 0 : 1, u]
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

// ---- [opt air_forward] 航空前推 (把航空 ZOI 投射到前线) --------------------
// 取证: 全库 ZOI/ZOC 只有防御性用法(has_zoi / avoid_zoi / set_zoi / has_non_n_zoi /
// _azoi_covers_dei_ports), 没有任何"前推航空以扩展己方航空 ZOC"的目标; 航空落点又走
// 图表固定表(优先自家机场, 实测多为后方) → 航空兵整局窝在后方基地, 前线航空 ZOI/
// 拦截圈一直缩在后方。本段给出两个纯只读决策函数(前推目标 / 落点) + 一个跨窗记忆。
//
// 跨窗记忆: 前推目标在"选单位窗"算出, 落点要到随后的"落点/hex 窗"才被问, 中间隔着
// 若干引擎窗口, 只能记在模块级。记录自带 flag、G 对象引用(同一局)与回合号(同一回合),
// 引擎侧(offensive.js 的航空落点/推进评分)读它当闸门 —— 实测 em_cfg() 在无头 advance
// 期间已被 reset 成 null(decide 之外读不到 profile: `EMCFG NULL @headless_target_score`),
// 而本记录只有 flag 开时才可能写入, 故 flag 关时引擎侧评分逐位不变。
// (G.seed 会被 roll() 改写, 不能当"同一局"的身份; 用 G 对象引用。)
// 用 var(非 let): 本文件晚于 offensive.js 内联, 避免后置定义的 TDZ。
var EOP_AIR_FORWARD_LAST = null

// 敌方"格"集合 = 敌方控制格 ∪ 敌方单位所在格(敌军格同样属于"接敌前线": 前推机场
// 逼近敌军格才算把航空 ZOI/拦截圈前伸)。只读, 供最近敌方距离查询。
function eop_air_forward_enemy_hexes(mine) {
    const enemy = mine === JP ? AP : JP
    const out = [], seen = new Set()
    if (typeof is_space_controlled === "function") {
        for (let h = 0; h <= LAST_BOARD_HEX; ++h) {
            let c = false
            try { c = !!is_space_controlled(h, enemy) } catch (e) { c = false }
            if (c && !seen.has(h)) { seen.add(h); out.push(h) }
        }
    }
    if (typeof eop_enemy_locs === "function") {
        for (const h of eop_enemy_locs(mine)) if (!seen.has(h)) { seen.add(h); out.push(h) }
    }
    return out
}

function eop_air_forward_near_dist(hex, targets) {
    let best = 99
    for (let i = 0; i < targets.length; ++i) {
        const d = get_distance(hex, targets[i])
        if (d < best) best = d
    }
    return best
}

// 前推目标: 返回一支应前推的己方航空单位 id, 找不到返回 undefined。
// 判据(F = 候选前推机场, loc = 该航空当前位置; 全部只读, 不改引擎状态):
//  1) F 己方控制且 get_map_data(F).airfield —— 引擎航空移动的硬约束(只能落机场格);
//  2) 前推有效: dist(F, 最近敌方) < dist(loc, 最近敌方) —— 严格更靠前才算前推
//     (顺带排除 F === loc 与原地的无意义"前推");
//  3) 航程: get_distance(loc, F) ≤ max(1, br, ebr) —— **保守近似**: 引擎真实航空移动是
//     "机场→机场 逐腿 BFS"(腿长 ≤ extended_battle_range, 腿数 = 牌 ops), 这里只取
//     "一腿"上界, 宁可漏推也不推超航程; 最终合法性仍由落点窗的引擎合法集兜底;
//  4) F 上无己方航空(图表脚注[11]/[12]: 每机场不超过一个空中单位), 且 F 不在敌方
//     非中立 ZOI 下(has_non_n_zoi) —— 落到被敌 ZOI 罩住的机场 = 送一个被孤立的前哨;
//  5) 评分 [dist(F, 最近敌方), 单位 id, F] 取最小: 主键 = F 的靠前程度(前推后航空
//     ZOI 能覆盖更多敌方格), 后两键保证同分时按 id 稳定破平。
// 防御轴(GARRISON/DEFEND/DEFEND_HONSHU)不参与: 驻军/本土守军不该被拉去前推。
function eop_pick_air_forward_redeploy(role, view, candidates) {
    const emc = (typeof em_cfg === "function") ? em_cfg() : null
    if (!emc || !emc.air_forward) return undefined
    if (!Array.isArray(candidates) || !candidates.length) return undefined
    if (typeof G === "undefined" || !G || !G.location) return undefined
    if (typeof get_map_data !== "function" || typeof get_distance !== "function") return undefined
    if (typeof is_space_controlled !== "function" || typeof pieces === "undefined") return undefined
    const mine = role === "Japan" ? JP : AP
    const enemy = mine === JP ? AP : JP
    if (typeof eop_axis === "function") {
        const axis = eop_axis(role)
        if (axis && (axis.kind === "GARRISON" || axis.kind === "DEFEND" || axis.kind === "DEFEND_HONSHU")) return undefined
    }
    // 己方航空已占用的机场(一机场一机)。
    const taken = new Set()
    for (let u = 1; u < pieces.length; ++u) {
        const p = pieces[u]
        if (!p || p.faction !== mine || p.class !== "air") continue
        const h = G.location[u]
        if (h >= 0 && h <= LAST_BOARD_HEX) taken.add(h)
    }
    const enemyHexes = eop_air_forward_enemy_hexes(mine)
    if (!enemyHexes.length) return undefined
    const fields = []
    for (let h = 0; h <= LAST_BOARD_HEX; ++h) {
        const md = get_map_data(h)
        if (!md || !md.airfield) continue
        if (taken.has(h)) continue
        let own = false
        try { own = !!is_space_controlled(h, mine) } catch (e) { own = false }
        if (!own) continue
        if (typeof has_non_n_zoi === "function" && has_non_n_zoi(h, enemy)) continue
        fields.push(h)
    }
    if (!fields.length) return undefined
    // 机场按"到最近敌方的距离"升序(同分按 id): 越靠前的机场越优先。
    const scored = fields.map(h => [eop_air_forward_near_dist(h, enemyHexes), h])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    let best = null
    for (const u of candidates) {
        const p = (() => { try { return pieces[u] } catch (e) { return null } })()
        if (!p || p.class !== "air" || p.faction !== mine) continue
        const loc = G.location[u]
        if (!(loc >= 0 && loc <= LAST_BOARD_HEX)) continue
        const range = Math.max(1, Number(p.br) || 0, Number(p.ebr) || 0)
        const locDist = eop_air_forward_near_dist(loc, enemyHexes)
        for (const item of scored) {
            const fd = item[0], F = item[1]
            if (fd >= locDist) break            // 已升序: 后续机场只会更靠后, 不可能满足判据 2
            if (get_distance(loc, F) > range) continue
            const score = [fd, u, F]
            if (best === null || score[0] < best[0]
                || (score[0] === best[0] && (score[1] < best[1] || (score[1] === best[1] && score[2] < best[2]))))
                best = score
        }
    }
    if (best === null) return undefined
    EOP_AIR_FORWARD_LAST = { flag: true, g: G, role, turn: Number(G.turn || 0), unit: best[1], hex: best[2], loc: G.location[best[1]] }
    if (typeof process !== "undefined" && process.env && process.env.EOTS_AIRFWD_DEBUG)
        console.log(`[AIRFWD] pick role=${role} T${G.turn} unit=${best[1]}(${G.location[best[1]]}) -> F=${best[2]} fieldDist=${best[0]} locDist=${eop_air_forward_near_dist(G.location[best[1]], enemyHexes)}`)
    return best[1]
}

// 落点接线: flag 开且本窗合法候选里含"本回合为这支航空选定的前推机场 F"时返回 F,
// 否则 undefined 走原逻辑。引擎合法集是最终闸门(超航程/被占/非机场的自然不在候选里)。
// 注意原链路 planPostBattleMovement 对非 unit 动作返回 undefined → 会退化到
// pick_argument 的伪随机落点, 所以航空前推必须有确定的落点来源, 单独在这里接线。
function planAirForwardHex(view, candidates, role) {
    const emc = (typeof em_cfg === "function") ? em_cfg() : null
    if (!emc || !emc.air_forward) return undefined
    if (!Array.isArray(candidates) || !candidates.length) return undefined
    if (typeof G === "undefined" || !G) return undefined
    const rec = EOP_AIR_FORWARD_LAST
    if (!rec || !rec.flag || rec.role !== role) return undefined
    // 闸门: 同一局(同一个 G 对象; G.seed 会被 roll() 改写, 不能当身份) + 同一回合。
    // 防同进程多局(match-run/behavior-tests)之间串台, 与 eop_clear_all_chains 同纪律。
    if (rec.g !== G) return undefined
    if (rec.turn !== Number(G.turn || 0)) return undefined
    // 只在该航空单位仍处在本窗活动编成里时命中(防把别的单位的落点窗带偏)。
    const mine = role === "Japan" ? JP : AP
    let active = Array.isArray(view?.active_stack) && view.active_stack.length ? view.active_stack : null
    if (!active && view?.offensive?.active_units) {
        const au = view.offensive.active_units
        active = Array.isArray(au[mine]) ? au[mine] : (Array.isArray(au) ? au.flat() : null)
    }
    if (active && active.length && active.indexOf(rec.unit) < 0) return undefined
    if (!candidates.some(h => Number(h) === rec.hex)) return undefined
    if (typeof process !== "undefined" && process.env && process.env.EOTS_AIRFWD_DEBUG)
        console.log(`[AIRFWD] hex role=${role} unit=${rec.unit} -> ${rec.hex} (cand=${candidates.length})`)
    return rec.hex
}

// 引擎侧(offensive.js 航空推进/落点评分)读前推记忆的只读入口。source = 该航空单位当前
// 所在格, piece = 可选: 该单位的引擎 piece 对象(航空编组逐个移动, movingPiece 唯一确定
// 单位) —— 同格有多支航空时用 piece 精确校验, 防"同格另一支航空"误用本记录。
// 只有"本回合为这支单位选定的前推目标"才返回记录, 其余一律 null。记录只有 flag 开时
// 才写入 → flag 关时引擎侧恒 null(评分与顺序逐位不变)。
function eop_air_forward_pref(source, piece) {
    const rec = EOP_AIR_FORWARD_LAST
    if (!rec || !rec.flag) return null
    if (typeof G === "undefined" || !G) return null
    if (rec.g !== G) return null      // 同一局(见 planAirForwardHex 注释)
    if (rec.turn !== Number(G.turn || 0)) return null
    if (rec.loc === undefined || rec.loc === null || Number(source) !== Number(rec.loc)) return null
    if (piece && typeof pieces !== "undefined" && pieces && pieces[rec.unit] !== piece) return null
    return rec
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
    const pending = eop_partition_retain(role, axis.chain.filter(h => eop_target_pending(role,h,eop_target_meta(role,h))))
    if (!pending.length) return null
    const first=eop_target_meta(role,pending[0])
    if (first?.strictSequential) return pending[0]
    // [opt chain_prereq] 前置跳板闸门: 链上 pending 目标按"是否已有前置跳板"重排 ——
    // 已具备者保持链序在前, 未具备者顺延到链后(顺延到下一个候选目标, 不放弃整条链);
    // 全部不具备时 eop_chain_prereq_defer 原样返回 pending, 下游回退逻辑不变(不死锁)。
    // strictSequential 硬序链(跳岛作战等)不重排: 图表语义即严格逐格, 其顺序本身即前置。
    const pendingOrder = eop_chain_prereq_defer(role, pending)
    let eligible=first?.targetGroup!==undefined ? pendingOrder.filter(h=>eop_target_meta(role,h)?.targetGroup===first.targetGroup) : pendingOrder
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
        const pendingAll=eop_partition_retain(role,(axis.chain||[]).filter(h=>eop_target_pending(role,h,eop_target_meta(role,h))))
        const planQ=ep_allocate_targets(role,view,pendingAll,null)
        if(planQ&&Array.isArray(planQ.queue)&&planQ.queue.length){
            // [opt chain_prereq] 战役层价值密度队列同样过前置闸门: 无前置跳板的纵深
            // 目标后移(不删除 —— 全链无前置时队列序不变, 不空转); flag 关时队列原样。
            const planOrder = eop_chain_prereq_defer(role, planQ.queue)
            // §10 多目标: 按价值密度序, 返回第一个"编组未达标"的目标 —— 编满者自动
            // 跳过, 预算自然扩散成多个任务部队(而非灌进单一目标)。
            for(const h of planOrder){
                try{
                    const pl=composeTaskForce(h,null,null,view,available,role)
                    if(pl&&!pl.complete&&pl.unit!==undefined&&pl.unit!==null)return h
                }catch(e){}
            }
            // 主目标(min-P)已达标: §13 优先岛群簇分流(island_sweep 开时), 否则空虚格扫荡
            if(emcAFo.island_sweep&&typeof eop_pick_cluster_landing==="function"){
                const chx=eop_pick_cluster_landing(role,view,available,planOrder[0],false)
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
                // [opt 1943 驻守让位] CONQUEST(未夺资源格)恒先于 GARRISON(己控未驻满):
                // 驻军补足只在"没有可夺资源格"时消费激活预算; 已驻满的格 pending=false
                // 天然不占预算(eop_target_pending)。同组内仍按前沿距离就近。
                const isGarrPending=h=>{const m3=eop_target_meta(role,h);return !!(m3&&m3.kind==="GARRISON")}
                resPending.sort((a2,b2)=>{
                    const da=(typeof esm_front_distance==="function")?esm_front_distance(a2,AP):99
                    const db=(typeof esm_front_distance==="function")?esm_front_distance(b2,AP):99
                    return (isGarrPending(a2)?1:0)-(isGarrPending(b2)?1:0)||da-db||a2-b2
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
    // [opt japan_opening_conquest §5] retainWithGround: 夺而必守(DEI 投降 key 等)。
    // 敌控 → 未完成(需夺占); 己控但格内无己方地面 → 未完成(需驻守 1 step 防
    // 盟军小部队夺回, 否则投降判定在政治阶段前被翻盘)。基线无此 meta, 不进分支。
    if (meta.retainWithGround) {
        if (!is_space_controlled(hex,mine)) return true
        for (let u = 1; u < pieces.length; ++u) {
            const p = pieces[u]
            if (p && p.faction === mine && p.class === "ground" && G.location[u] === hex) return false
        }
        return true
    }
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
    const pending=eop_partition_retain(role,axis.chain.filter(h=>eop_target_pending(role,h,metadata(h))))
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
    // [opt amph-coast] 引擎两栖路径(get_naval_move/move.js AMPH)可进入任意沿海敌控格,
    // 不止 port/island(实证: Medan 无 port 标记, 却是 DEI 投降 key 的合法登陆点)。
    // 优化层开启时把 md.coastal 计入登陆格判定; 基线(配置关)维持 port||island 逐位不变。
    const emcCO=(typeof em_cfg==="function")?em_cfg():null
    const coastal=!!(md&&(md.port||md.island
        ||((emcCO&&(emcCO.taskforce_math||emcCO.island_sweep||emcCO.erasmus_plus))&&md.coastal)))
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

// [opt ERASMUS_PLUS M4] 静态陆地连通性: GROUND 边 BFS(无视 ZOI/驻军/激活状态)。
// queryGroundReachability 对未激活单位返回空集, 无法用于"陆路能否走到"的预判。
const EP_LAND_CONN = new Map()
function ep_land_connected(fromHex, toHex) {
    if (fromHex === toHex) return true
    let comp = EP_LAND_CONN.get(fromHex)
    if (!comp) {
        comp = new Set([fromHex])
        const q = [fromHex]
        while (q.length) {
            const item = q.shift()
            const m = (typeof get_map_data === "function") ? get_map_data(item) : null
            if (!m) continue
            // [opt ERASMUS_PLUS M4-v2] 陆路 BFS 禁穿海格: data_map 把海峡两岸标了
            // GROUND 边(克拉克海峡), 但引擎地面移动不允许跨海(海军 ZOI 阻隔)。
            // 沿途 OCEAN 格(terrain 0)不入队, 保证"半岛陆路"不含海上跳步。
            if (m.terrain === 0) continue
            const nh = m.nh || []
            for (let j = 0; j < nh.length; ++j) {
                const nb = nh[j]
                if (!(nb > 0 && nb <= LAST_BOARD_HEX) || comp.has(nb)) continue
                if (m.edges_int & (2 << (5 * j))) { comp.add(nb); q.push(nb) } // GROUND=2
            }
        }
        EP_LAND_CONN.set(fromHex, comp)
    }
    return comp.has(toHex)
}

// ---- [opt chain_prereq] 战略链前置跳板闸门 ---------------------------------
// 取证(对局 71 T7): 「反攻战略」链 = Tainan(560)/Shanghai(587)/Bangka(307)/Vogelkop(657)/
// Soerabaja(368), 「南太平洋战略」链 = Taihoku(589)/Tarakan(480)/Rabaul(891)/Hollandia(745)/
// Tainan(560) —— 链上目标**彼此之间没有"前置跳板"概念**, 只按图表顺序推进。于是焦点可
// 一步跳到台湾/上海等纵深格, 部队孤军深入后被日军航空 ZOI 断补(OOS)。
// 本闸门在"选激活焦点"时判定目标是否已有前置跳板, 未满足者**顺延到链上下一个候选目标**
// (不整条链放弃); 全部 pending 都不满足时由调用方回退原逻辑(不死锁, 不回 null 空转)。
// 任一条件成立即视为"有前置":
//   (a) 目标自身或相邻格已有己方控制格(限 controllable 格 —— is_space_controlled 对
//       非可控海格恒真, 不加以限制则任何滨海格都会假阳性通过);
//   (b) 目标与己方控制陆地/己方地面单位陆路连通(ep_land_connected 静态 GROUND BFS,
//       禁穿海格);
//   (c) 存在己方控制的港口或机场到目标距离 ≤ emChainPrereqDist(默认 6 格) —— 两栖
//       装载港/航空基地进入战程内的同义表述;
//   (d) 目标上或相邻已有己方地面单位。
// 纯只读(仅 is_space_controlled 会刷新挂起的控制位, 与既有 eop_focus 同源); 全函数在
// flag 关时返回原数组/恒真, 调用点控制流不变 = 基线逐位一致。
const EOP_PREREQ_GEOM = { portAir: null }

// 地图静态几何: 港口/机场格名单(与 G 无关, 只算一次)。
function eop_prereq_port_air_geometry() {
    if (EOP_PREREQ_GEOM.portAir) return EOP_PREREQ_GEOM.portAir
    const out = []
    if (typeof get_map_data === "function") {
        for (let h = 0; h <= LAST_BOARD_HEX; ++h) {
            const md = get_map_data(h)
            if (md && (md.port || md.airfield)) out.push(h)
        }
    }
    EOP_PREREQ_GEOM.portAir = out
    return out
}

// 闸门判定上下文(一次批量判定内复用; 含己控港口机场/己方地面位置/己控格)。
function eop_prereq_context(role, dist) {
    const mine = role === "Japan" ? JP : AP
    const geom = eop_prereq_port_air_geometry()
    const anchors = [], units = [], owned = []
    for (let i = 0; i < geom.length; ++i) if (is_space_controlled(geom[i], mine)) anchors.push(geom[i])
    for (let u = 1; u < pieces.length; ++u) {
        const p = pieces[u]
        if (!p || p.faction !== mine || p.class !== "ground") continue
        const loc = G.location[u]
        if (loc >= 0 && loc <= LAST_BOARD_HEX) units.push(loc)
    }
    for (let h = 0; h <= LAST_BOARD_HEX; ++h) {
        if (!is_controllable_hex(h)) continue
        if (is_space_controlled(h, mine)) owned.push(h)
    }
    return { mine, dist, anchors, units, owned }
}

// 目标是否已具备前置跳板。flag 关 → 恒真(调用方控制流不变)。
function eop_chain_prereq_ok(role, hex, ctx) {
    const emc = (typeof em_cfg === "function") ? em_cfg() : null
    if (!emc || !emc.chain_prereq) return true
    if (!Number.isInteger(hex) || hex < 0 || hex > LAST_BOARD_HEX) return true
    const c = ctx || eop_prereq_context(role, Number(emc.emChainPrereqDist) || 6)
    const mine = c.mine
    // (a) 目标自身/相邻己方控制格
    const md = (typeof get_map_data === "function") ? get_map_data(hex) : null
    const near = [hex].concat((md && Array.isArray(md.nh)) ? md.nh : [])
    for (const h of near) {
        if (!(h >= 0 && h <= LAST_BOARD_HEX)) continue
        if (is_controllable_hex(h) && is_space_controlled(h, mine)) return true
    }
    // (d) 目标上/相邻己方地面单位
    for (const loc of c.units) {
        if (loc === hex) return true
        if (typeof get_distance === "function" && get_distance(loc, hex) <= 1) return true
    }
    // (b) 陆路可达: 与己方地面单位或己方控制陆地连通
    for (const loc of c.units) if (ep_land_connected(loc, hex)) return true
    for (const h of c.owned) if (h !== hex && ep_land_connected(h, hex)) return true
    // (c) 己控港口/机场在 emChainPrereqDist 内(两栖/航空跳板已进战程)
    for (const a of c.anchors) {
        if (typeof get_distance !== "function") break
        if (get_distance(a, hex) <= c.dist) return true
    }
    return false
}

// 把候选目标重排: 已具备前置者(保持原相对顺序)在前, 未具备者顺延于后。
// flag 关 / 非数组 / 空集 / 全部具备或全部不具备 → 原数组(不死锁, 不空转)。
function eop_chain_prereq_defer(role, hexes) {
    const emc = (typeof em_cfg === "function") ? em_cfg() : null
    if (!emc || !emc.chain_prereq) return hexes
    if (!Array.isArray(hexes) || hexes.length < 2) return hexes
    const ctx = eop_prereq_context(role, Number(emc.emChainPrereqDist) || 6)
    const ok = [], deferred = []
    for (const h of hexes) (eop_chain_prereq_ok(role, h, ctx) ? ok : deferred).push(h)
    if (!ok.length || !deferred.length) return hexes
    // [chain_prereq 顺序] 仅保持链序会让"顺延"落到链上下一个纵深目标(取证: 台南被拦后
    // 换成上海, 仍是纵深)。改为在**有前置的候选里按"离己方最近基地"升序** —— 南太平洋
    // 链就会让拉包尔/荷兰迪亚这类跳板先于台湾出场, 真正实现"先建跳板再推进"。
    try {
        const bases = (ctx && Array.isArray(ctx.bases)) ? ctx.bases : null
        if (bases && bases.length && typeof get_distance === "function") {
            const near = h => { let best = 99; for (const b of bases) { const d = get_distance(b, h); if (d < best) best = d } return best }
            const key = new Map(ok.map(h => [h, near(h)]))
            ok.sort((a, b) => (key.get(a) - key.get(b)) || (hexes.indexOf(a) - hexes.indexOf(b)))
        }
    } catch (e) { /* 基地表不可用则退回链序 */ }
    return ok.concat(deferred)
}
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
    // [opt amph-coast] 与 evaluateTargetFeasibility 同口径: 沿海敌控格即登陆格。
    const emcCS = (typeof em_cfg === "function") ? em_cfg() : null
    const coastal = !!(md && (md.port || md.island
        || ((emcCS && (emcCS.taskforce_math || emcCS.island_sweep || emcCS.erasmus_plus)) && md.coastal)))
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
    // [opt ERASMUS_PLUS] 占领目标必须有地面单位(攻击方地面 CF>0): 旧判定在守军无地面时
    // attackerGround(0) >= 2*0 恒真 → 海空军"完成"编组 → 永不载兵登陆(马来亚 0/8 元凶之一)。
    const groundSurvivalMet = !requiresOccupation ? true
        : (attackerGround >= Math.max(1, 2 * groundDefense) && attackerGround > 0)
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

// [opt battle_decl_gate] 引擎精确“本攻势能否产生战斗格”预检。
//
// 引擎侧唯一判据在 offensive.js compute_possible_battle_hexes():
//   战斗格 = 【已激活单位】的战斗航程(br/ebr; parenthetical 取 br) ∩ 【敌占格】
//            (排除 IChina 区域), 且该单位本轮未走 STRAT_MOVE/AIR_EXTENDED_MOVE、
//            当前不在敌占格、未被 B-29 轰炸。
// 交集为空 → declare_battle_hexes._begin 立即 end() 并记
//   “No battle hexes declared: no active unit can reach a legal enemy battle hex.”
//
// 旧编队数学只在“目标不可控港口/岛屿”时整体放行候选(见 eop_filter_legal_participants
// 的 amphLanding 分支: 海军无条件 return true、两栖地面仅看 asp/strat_move), 从不回答
// “激活后能否构成战斗格”。于是被激活的部队对任何敌占格都非法 —— 攻势白烧(取证 2 seed / 232 攻势 /
// 61 次“激活后空转”, 其中 56 次连一格都没夺到)。
// 本函数用引擎合法查询回答同一问题, 不复制规则:
//   航空    in_range_on_map(loc, range, enemyHexes) —— 与引擎战斗航程判定同一函数;
//   地面    queryGroundReachability(unit)           —— 引擎 get_ground_move BFS;
//   海军    queryNavalReachability(unit)            —— 引擎 get_naval_move BFS。
// 返回 { fightIds:Set, anyFight, enemyHexes }。ids 未给 = view 里该方全部在盘单位。
function eop_battle_prospect(role, view, ids) {
    const mine = role === "Japan" ? JP : AP
    const fightIds = new Set()
    if (typeof G === "undefined" || !G || !G.location || typeof pieces === "undefined") return { fightIds, anyFight: false, enemyHexes: 0 }
    const units = Array.isArray(view && view.ai && view.ai.units) ? view.ai.units : []
    const enemyHexes = []
    const seen = new Set()
    for (const u of units) {
        if (!u || u.faction === mine) continue
        const h = u.location
        if (!(h >= 0 && h <= LAST_BOARD_HEX) || seen.has(h)) continue
        const md = (typeof get_map_data === "function") ? get_map_data(h) : null
        if (md && md.region === "IChina") continue
        seen.add(h)
        enemyHexes.push(h)
    }
    if (!enemyHexes.length) return { fightIds, anyFight: false, enemyHexes: 0 }
    const pool = Array.isArray(ids) ? ids : units.filter(u => u && u.faction === mine).map(u => u.id)
    for (const id of pool) {
        const p = pieces[id]
        if (!p || p.faction !== mine || !p.br) continue
        const loc = G.location[id]
        if (!(loc >= 0 && loc <= LAST_BOARD_HEX)) continue
        const path = (G.offensive && G.offensive.paths) ? map_get(G.offensive.paths, id) : null
        if (path && (path[0] & STRAT_MOVE || path[0] & AIR_EXTENDED_MOVE)) continue
        if (is_faction_units(loc, 1 - mine)) continue
        if (typeof is_b29_bombed === "function" && is_b29_bombed(p)) continue
        try {
            if (p.class === "air") {
                const br = Math.max(1, Number(p.br) || 0)
                const ebr = Math.max(1, Number(p.ebr) || Number(p.br) || 0)
                const range = p.parenthetical ? br : ebr
                if (typeof in_range_on_map === "function" && in_range_on_map(loc, range, enemyHexes, mine).length > 0) fightIds.add(id)
                continue
            }
            if (enemyHexes.indexOf(loc) >= 0) { fightIds.add(id); continue }
            if (p.class === "ground") {
                if (typeof queryGroundReachability !== "function") continue
                const r = queryGroundReachability(id, {})
                const hs = r && Array.isArray(r.reachableHexes) ? r.reachableHexes : []
                for (const h of hs) if (seen.has(h)) { fightIds.add(id); break }
            } else if (p.class === "naval") {
                if (typeof queryNavalReachability !== "function") continue
                const r = queryNavalReachability(id, {})
                const hs = r && Array.isArray(r.reachableHexes) ? r.reachableHexes : []
                for (const h of hs) if (seen.has(h)) { fightIds.add(id); break }
            }
        } catch (e) { /* 查询异常按“不可行”留空, 由调用方兜底 */ }
    }
    return { fightIds, anyFight: fightIds.size > 0, enemyHexes: enemyHexes.length }
}

// [opt battle_decl_gate] 候选能否在本攻势合法“进入/夺占”某格(引擎精确)。
// 仅用于“无战斗前景”时判断这次激活是否还有夺格价值: 目标格被敌控且空虚时,
// 引擎靠地面 move 路径逐格 capture_hex(move.js:881)/攻势收尾 capture_landing_hexes 夺格,
// 单位必须真能到达。返回 true 表示至少一支候选可合法到达目标(或已在目标)。
function eop_focus_reach_ok(role, view, ids, target) {
    if (!Number.isInteger(target)) return false
    const mine = role === "Japan" ? JP : AP
    const pool = Array.isArray(ids) ? ids : []
    for (const id of pool) {
        const p = pieces[id]
        if (!p || p.faction !== mine) continue
        try {
            const loc = G.location[id]
            if (loc === target) return true
            if (p.class === "ground") {
                if (typeof queryGroundReachability !== "function") continue
                const r = queryGroundReachability(id, {})
                if (r && Array.isArray(r.reachableHexes) && r.reachableHexes.indexOf(target) >= 0) return true
                // 两栖/海运地面: 引擎 AMPH_MOVE 路径无法用单位级 BFS 判定, 有 asp/strat_move
                // 即视为“可能进入”(与 eop_filter_legal_participants 同口径, 避免误拦登陆)。
                if (p.asp || p.strat_move) return true
            } else if (p.class === "naval") {
                if (typeof queryNavalReachability !== "function") continue
                const r = queryNavalReachability(id, {})
                if (r && Array.isArray(r.reachableHexes) && r.reachableHexes.indexOf(target) >= 0) return true
            }
        } catch (e) { /* 查询异常视为不可达 */ }
    }
    return false
}

// [opt battle_decl_gate] 候选地面单位能否在本攻势合法推进到【某空虚敌控格】夺格
// (引擎精确: queryGroundReachability 的 get_ground_move BFS, 与无头推进 advance 落点
// 的合法格同源)。这是岛群清扫"推进夺格"分支的价值来源 —— 没有它, 闸门会连合法夺格
// 的激活一起拦掉(实测 AP 夺格 37→27)。
// 两栖/海运地面(asp/strat_move)的 AMPH_MOVE 路径无法用单位级 BFS 判定, 按与
// eop_filter_legal_participants 相同的放行口径视为可能到达, 避免误拦登陆。
function eop_sweep_reach_ok(role, view, ids) {
    const mine = role === "Japan" ? JP : AP
    const pool = Array.isArray(ids) ? ids : []
    let occupied = null, emptyEnemy = null
    for (const id of pool) {
        const p = pieces[id]
        if (!p || p.faction !== mine || p.class !== "ground") continue
        const loc = G.location[id]
        if (!(loc >= 0 && loc <= LAST_BOARD_HEX)) continue
        if (G.reduced && (typeof set_has === "function" ? set_has(G.reduced, id) : false)) continue
        if (p.asp || p.strat_move) return true
        if (emptyEnemy === null) {
            occupied = new Set()
            for (let u = 1; u < pieces.length; ++u) {
                const q = pieces[u]
                if (!q) continue
                const h = G.location[u]
                if (h >= 0 && h <= LAST_BOARD_HEX) occupied.add(h)
            }
            emptyEnemy = new Set()
            for (let h = 0; h <= LAST_BOARD_HEX; ++h) if (!occupied.has(h) && is_space_controlled(h, 1 - mine)) emptyEnemy.add(h)
            if (!emptyEnemy.size) return false
        }
        try {
            if (typeof queryGroundReachability !== "function") continue
            const r = queryGroundReachability(id, {})
            const hs = r && Array.isArray(r.reachableHexes) ? r.reachableHexes : []
            for (const h of hs) if (emptyEnemy.has(h)) return true
        } catch (e) { /* 查询异常按不可达 */ }
    }
    return false
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
        // [opt amph-coast] 引擎 AMPH 路径可达任意沿海敌控格(非仅 port/island):
        // Medan/资源格等无 port 标记的沿海格过去把地面候选全部过滤掉, 编组只剩
        // 海空 → 舰队年年开到却无人登陆(DEI 投降链停滞元凶)。
        const mineAF = role === "Japan" ? JP : AP
        const mdAF = (typeof get_map_data === "function") ? get_map_data(target) : null
        amphLanding = !!mdAF && mdAF.terrain !== OCEAN && (mdAF.port || mdAF.island || mdAF.coastal)
            && !is_space_controlled(target, mineAF)
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

// ---- 两栖运输(ASP)可行性闸门 ----------------------------------------------
// 引擎 get_move_data()(rules.js get_move_data)只在
//     Σ(编组内地面单位的 asp 代价, reduced 用 aspr; organic 搭载与无 asp 单位不计)
//         <= get_asp_limit(faction) = G.asp[faction][0] - G.asp[faction][1]
// 时才给 move_type 授 AMPH_MOVE。没有 AMPH_MOVE, 运输舰/战列舰就无法把地面部队送进
// 敌控岛格 → 该格构不成合法战斗格 → 整支攻势以 "No battle hexes declared" 空耗
// (攻势卡 + HQ 启动 + 已激活单位全部白费)。
// 旧编队数学只算海空战胜负期望, 从不看这笔 ASP 账: ASP 见底时仍反复把远岛列为首位
// 目标、编出运不上去的地面组。取证 seed 68: asp[AP]=[5,4] → 可用 1, 却启动
// I Corps(asp 2)+SF Brigade(asp 1)=3, 单局空攻势 24 次。
// 下面两个函数给出与引擎逐字一致的口径, 供选目标/编组时预检。

// 单支地面单位的两栖运输代价 (0 = 不计入 ASP: 无 asp 或 organic 搭载)。
function eop_ground_asp_cost(id) {
    if (typeof pieces === "undefined" || !G || !pieces[id]) return 0
    const p = pieces[id]
    if (p.class !== "ground" || !p.asp) return 0
    if (Array.isArray(G.offensive && G.offensive.organic) && G.offensive.organic.indexOf(id) >= 0) return 0
    return set_has(G.reduced, id) ? (Number(p.aspr) || 0) : (Number(p.asp) || 0)
}

function eop_ground_cf(id) {
    if (typeof pieces === "undefined" || !G || !pieces[id]) return 0
    const p = pieces[id]
    return set_has(G.reduced, id) ? (Number(p.rcf) || Math.ceil((Number(p.cf) || 0) / 2)) : (Number(p.cf) || 0)
}

// 可用 ASP (与引擎 get_asp_limit 同口径: JP 有 inter_service 时上限减半)。
function eop_asp_available(role) {
    const faction = role === "Japan" ? JP : AP
    try { return Math.max(0, Number(get_asp_limit(faction)) || 0) } catch (e) { return 0 }
}

// 两栖"最小充分兵力 ∩ ASP 约束": 已激活地面先占用 ASP, 再从候选地面按
// 战力/运输代价比贪心装载, 直到达标(cfRequired)或 ASP 用尽。
// 返回 {feasible, need, available, cf, required, pickIds, aspShortfall, cfShortfall}。
// feasible=false 表示: 即便把可用 ASP 装到不能再装, 仍凑不出达标地面组 ——
// 该登陆本回合不可执行(应先攒 ASP / 等运输舰回港, 或改打有守军的海战目标)。
function eop_amphib_asp_plan(role, poolGroundIds, committedGroundIds, cfRequired) {
    const available = eop_asp_available(role)
    const required = Math.max(1, Math.floor(Number(cfRequired) || 1))
    let need = 0, cf = 0
    const pickIds = []
    const seen = new Set()
    for (const id of committedGroundIds || []) {
        if (seen.has(id)) continue
        seen.add(id)
        const cost = eop_ground_asp_cost(id)
        if (!cost && !(pieces[id] && pieces[id].class === "ground" && pieces[id].asp)) continue
        // 已激活单位无法退还: 即便已超预算也照实计入, 暴露"已经烧掉"的事实。
        need += cost
        cf += eop_ground_cf(id)
        pickIds.push(id)
    }
    const rest = (poolGroundIds || []).filter(id => !seen.has(id) && pieces[id] && pieces[id].class === "ground" && pieces[id].asp)
    rest.sort((a, b) => (eop_ground_cf(b) / Math.max(1, eop_ground_asp_cost(b))) - (eop_ground_cf(a) / Math.max(1, eop_ground_asp_cost(a)))
        || eop_ground_cf(b) - eop_ground_cf(a) || a - b)
    for (const id of rest) {
        if (cf >= required) break
        const cost = eop_ground_asp_cost(id)
        if (need + cost > available) continue // 装不下这支: 换下一支(可能更轻)
        need += cost
        cf += eop_ground_cf(id)
        pickIds.push(id)
    }
    return {
        feasible: cf >= required && need <= available,
        need, available, cf, required, pickIds,
        aspShortfall: Math.max(0, need - available),
        cfShortfall: Math.max(0, required - cf),
    }
}

// 目标是否属于"必须两栖登陆夺占"的场合(敌控沿岸/岛屿且需占领)。
function eop_target_needs_landing(role, target, view, meta) {
    if (target === null || target === undefined) return false
    const mine = role === "Japan" ? JP : AP
    const m = meta || eop_target_meta(role, target)
    if (!(m && m.requiresOccupation)) return false
    const md = (typeof get_map_data === "function") ? get_map_data(target) : null
    if (!md || !(md.port || md.island)) return false
    try { if (is_space_controlled(target, mine)) return false } catch (e) { /* 未知按需登陆处理 */ }
    if (view && view.ai && view.ai.focusControlledBy === view.active) return false
    return true
}

// 选目标/出牌阶段的轻量预检: 该登陆格在本回合 ASP 预算下是否可执行。
// 判定"需求"用目标现有守军的最大地面战力(1 为下限): 空岛只需装上任意一支
// 两栖地面; 有守军则需装下足够战力。
function eop_landing_asp_feasible(role, target, view, meta, poolIds) {
    if (!eop_target_needs_landing(role, target, view, meta)) return { feasible: true, skipped: true }
    const units = Array.isArray(view && view.ai && view.ai.units) ? view.ai.units : []
    const enemy = 1 - (role === "Japan" ? JP : AP)
    const defCF = units.filter(u => u.location === target && u.faction === enemy && u.class === "ground")
        .reduce((s, u) => s + (Number(u.cf) || 0), 0)
    const activeIds = (G && G.offensive && Array.isArray(G.offensive.active_units) && Array.isArray(G.offensive.active_units[role === "Japan" ? JP : AP]))
        ? G.offensive.active_units[role === "Japan" ? JP : AP] : []
    const pool = (poolIds !== undefined && poolIds !== null) ? poolIds
        : units.filter(u => u.faction === (role === "Japan" ? JP : AP) && u.class === "ground").map(u => u.id)
    return eop_amphib_asp_plan(role, pool, activeIds, Math.max(1, defCF))
}

// 决策轴当前仍未达成的目标(供出牌阶段"空轴"判定: 全达成时不该再为它打攻势卡)。
function eop_axis_pending_targets(role) {
    let axis = null
    try { axis = eop_axis(role) } catch (e) { return [] }
    if (!axis || !Array.isArray(axis.chain)) return []
    return axis.chain.filter(h => { try { return eop_target_pending(role, h, eop_target_meta(role, h)) } catch (e) { return false } })
}

// 出牌阶段前置闸门: 决策轴的 pending 目标是否"全是装不上 ASP 的登陆"。
// 是 → 本回合为这条轴打攻势卡只会空耗(卡 + HQ 启动 + 激活全废), 应改打事件/Pass,
// 把攻势卡留给 ASP 回港的回合。存在任何非登陆目标(压制/驻军/陆路可达)即不拦截,
// 避免把正常攻势一并劝退。
function eop_axis_landing_blocked(role, view) {
    let axis = null
    try { axis = eop_axis(role) } catch (e) { return { blocked: false } }
    if (!axis || !Array.isArray(axis.chain) || !axis.chain.length) return { blocked: false }
    const pending = axis.chain.filter(h => { try { return eop_target_pending(role, h, eop_target_meta(role, h)) } catch (e) { return false } })
    if (!pending.length) return { blocked: false }
    let landing = 0, feasible = 0, other = 0
    const unavailable = []
    for (const h of pending) {
        const meta = eop_target_meta(role, h)
        if (!eop_target_needs_landing(role, h, view, meta)) { other++; continue }
        landing++
        let r = null
        try { r = eop_landing_asp_feasible(role, h, view, meta) } catch (e) { other++; continue }
        if (r && r.feasible) feasible++
        else unavailable.push({ hex: h, need: r ? r.need : null, available: r ? r.available : null })
    }
    if (!landing || feasible > 0 || other > 0) return { blocked: false, landing, feasible, other }
    return { blocked: true, landing, feasible, other, unavailable,
        available: unavailable.length ? unavailable[0].available : 0,
        reason: `轴内 ${landing} 个登陆目标均超 ASP 预算(可用 ${unavailable.length ? unavailable[0].available : 0} ASP)` }
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
    // [opt amphib_asp_gate] 两栖运输硬闸门: 登陆目标先过 ASP 账(引擎 AMPH_MOVE 的
    // 唯一门槛)。装不下达标地面组 → 本回合该登陆不可执行: unit=undefined 让
    // 焦点选择跳过它(换目标 / 省下攻势卡), 而不是先激活地面再吃 "No battle hexes"。
    const emcAspGate=(typeof em_cfg==="function")?em_cfg():null
    let aspPlan=null
    if(landing&&emcAspGate&&emcAspGate.amphib_asp_gate){
        try{
            const committedGroundIds=committed.filter(u=>u.class==="ground").map(u=>u.id)
            const poolGroundIds=(candidates||[]).map(id=>byId.get(id)).filter(u=>u&&u.class==="ground").map(u=>u.id)
            aspPlan=eop_amphib_asp_plan(role,poolGroundIds,committedGroundIds,f.requiredGroundMath)
        }catch(e){aspPlan=null}
        if(aspPlan&&!aspPlan.feasible){
            return {complete:false,strict:true,required:need,strength:math,unit:undefined,
                formation:"amphib-asp-insufficient",via:"asp-gate",
                reason:`两栖运输不足: 需 ${aspPlan.need} ASP / 可用 ${aspPlan.available}`
                    +(aspPlan.cfShortfall>0?`, 地面战力 ${aspPlan.cf}/${aspPlan.required}`:""),
                aspNeed:aspPlan.need,aspAvailable:aspPlan.available,aspShortfall:aspPlan.aspShortfall,
                aspCf:aspPlan.cf,aspRequired:aspPlan.required,
                groundStrength,strikeStrength,potentialReactionStrength:f.potentialReactionStrength,supportRequired}
        }
    }
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
    // [opt force_concentration] 留档: 此处曾尝试"support/damage 门通过后, 未达
    // emConcentrationMargin 倍优势就不收工"的硬闸门 —— 实测因反应兵力估计偏大(焦点附近
    // 敌方主力的 queryReactionCandidates 全额计入)而"永不达标", 编组永不 complete,
    // 焦点分流/收工判定全部紊乱(15 局: 盟军夺格 87→34、主动会战胜率 0.234→0.086)。
    // 该钩子已删除; 集中兵力只保留在【申报窗选格】(eop_pick_concentration_hex) 与
    // 【编组候选可达性过滤】两处低 blast-radius 位置。不收工判定仍按引擎原口径。
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
                // [opt ERASMUS_PLUS] 占领目标必须已含地面部队才允许"P 达标收工":
                // attGround=0 时 ocP.pWin=0(不产生地面战), 但守军地面亦 0 时旧公式
                // defCF=0 → attCF=0 特判 pWin=1 → 海空军空"完成"。加 attCFp>0 硬条件。
                if(f.requiresOccupation&&attCFp<=0){
                    /* 占领目标无地面: 不收工, 继续选兵(落到下方 pool 排序) */
                } else if(ocP.pWin>=targetP)return {complete:true,required:need,strength:math,unit:null,
                    formation:landing?"supported-amphibious-assault":f.suppress?"air-sea-strike":"minimum-sufficient",
                    groundStrength,strikeStrength,potentialReactionStrength:f.potentialReactionStrength,supportRequired,
                    pWin:Number(ocP.pWin.toFixed(2)),via:"ep-pwin"}
                // pWin<desired: 不收工, 继续按边际效用加编(erasmus_plus 下 pick 走 em 边际)
            }catch(e){/* 评估失败回退规则口径 */}
        }
        // [opt ERASMUS_PLUS] 占领目标无地面部队 → 编组不完成(落到 pool 选兵):
        // 修复海空军"空完成"导致马来亚/新加坡永不登陆。
        // v2.1 改进: pool 里如果有地面单位(哪怕陆路不可达=需两栖), 也选中它继续激活
        // —— 每多激活一个两栖地面=多一次成功登陆机会(capture_landing_hexes 批量占领)。
        if(f.requiresOccupation&&groundStrength<=0){
            const emcNG=(typeof em_cfg==="function")?em_cfg():null
            if(emcNG&&emcNG.erasmus_plus){
                // 从 pool 里找任意地面候选(含两栖): 激活它, 无头推进会引导它上岛
                const gnd=pool.find(u=>u.class==="ground"&&(u.asp||u.strat_move))
                if(gnd)return {complete:false,strict:true,required:need,strength:math,unit:gnd.id,
                    formation:"needs-ground-occupation",
                    groundStrength,strikeStrength,potentialReactionStrength:f.potentialReactionStrength,supportRequired}
                // pool 里无地面 → 也不提前 done, 让 call 方走推进兜底
                return {complete:false,strict:true,required:need,strength:math,unit:undefined,
                    formation:"needs-ground-occupation",
                    groundStrength,strikeStrength,potentialReactionStrength:f.potentialReactionStrength,supportRequired}
            }
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
    // [opt amphib_asp_gate] 只保留"装得进 ASP"的地面候选: 引擎按整个编组的 Σasp 判
    // AMPH_MOVE, 选一支运不上的重装军等于白激活(还挤掉后续装载额度)。
    if(landing&&aspPlan&&aspPlan.feasible&&aspPlan.pickIds.length){
        const loadable=new Set(aspPlan.pickIds)
        const keepGround=pool.filter(u=>u.class!=="ground"||loadable.has(u.id))
        if(keepGround.some(u=>u.class==="ground"))pool=keepGround
    }
    // [opt stack_limit_gate] 目标格"地面/航空位"已满(引擎每格每方 ≤3, 地面与航空共用同一
    // bucket)时不再把地面/航空编进该格(海军独立桶 ≤6, 仍可入港护航/会合); 候选被清空则
    // unit=undefined, 上游焦点选择顺延到下一个可编组目标。超编落格在阶段末
    // check_overstacking 会被位移到回合盒 1-2 回合, 不可替换/断补者直接歼灭。
    // flag 关时 pool 逐位不变。
    if (em_flag("stack_limit_gate") && Number.isInteger(target) && target >= 0 && target <= LAST_BOARD_HEX) {
        const ownAtTarget = headless_units_at(target, faction)
        if ((ownAtTarget.ground + ownAtTarget.air) >= 3) pool = pool.filter(u => u.class !== "ground" && u.class !== "air")
    }
    // [opt] CV 保全: 盟军非登陆打击场合不把 CV 投入普通消耗战(保留 air cover/减少 PW 风险)。
    const emc=(typeof em_cfg==="function")?em_cfg():null
    if(emc&&emc.allies_cv_preserve&&role==="Allies"&&!landing&&typeof is_cv_unit==="function"){
        pool=pool.filter(u=>{const p=pieces[u.id];return !(p&&p.class==="naval"&&is_cv_unit(p))})
    }
    // [opt force_concentration] 集中兵力: 只从"当轮引擎判定能打到/进入目标格"的候选里选兵。
    // 打不到该格的单位编进任务部队对这场会战零贡献(offensive.js compute_possible_battle_hexes
    // 只收 br/ebr 覆盖敌占格的已激活单位), 却吃掉激活预算与 HQ 上限。全部候选都打不到时
    // 保持原池(不制造空窗/死锁)。flag 关时不进入本段, pool 逐位不变。
    if (em_flag("force_concentration")) {
        const concA = eop_concentration_assess(role, null, target, pool.map(u=>u.id), committed)
        if (concA && concA.fightIds.size) {
            const keep = pool.filter(u => concA.fightIds.has(u.id))
            if (keep.length) pool = keep
        }
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
        // [opt ERASMUS_PLUS M4] 占领目标: 陆路可达焦点者优先于仅两栖可达者(预计算
        // queryGroundReachability, 防 26² 平方查询)。取证: 25军沿半岛陆路可下新加坡,
        // 旧排序按 hex 距离选了海峡对岸的 38军 → 激活后无法执行。
        let landOkMap=null
        const emcLR2=(typeof em_cfg==="function")?em_cfg():null
        if(emcLR2&&emcLR2.erasmus_plus&&f.requiresOccupation&&target!==null&&target!==undefined
            &&typeof queryGroundReachability==="function"){
            landOkMap=new Map()
            for(const u of pool){
                try{
                    const locU=G.location[u.id]
                    landOkMap.set(u.id,(locU>=0&&locU<=LAST_BOARD_HEX&&typeof ep_land_connected==="function")?ep_land_connected(locU,target):false)
                }catch(e){landOkMap.set(u.id,false)}
            }
        }
        pool.sort((a,b)=>classRank(a)-classRank(b)
            ||(landOkMap?((landOkMap.get(b.id)?0:1)-(landOkMap.get(a.id)?0:1)):0)
            ||distance(a)-distance(b)||cf(b)-cf(a)||a.id-b.id)
        if(landOkMap&&typeof process!=="undefined"&&process.env.EOTS_FUNNEL_DEBUG){
            try{
                const nm2=id=>{const uu=byId.get(id);return uu?(uu.name||id)+"@"+uu.location:id}
                console.log(`[LAND] T${G.turn} focus=${target} landTop=[${pool.filter(u=>landOkMap.get(u.id)).slice(0,4).map(u=>nm2(u.id)+"(rank"+classRank(u)+")").join(", ")}] `+
                    `amphTop=[${pool.filter(u=>!landOkMap.get(u.id)).slice(0,3).map(u=>nm2(u.id)).join(", ")}] pool=${pool.length}`)
            }catch(e){}
        }
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
    // [opt card_hq_priority] 牌面 HQ 优先: 卡牌数据的 hq 字段是该牌(事件/反攻)限定或
    // 偏好的 HQ, logistic_alt 是"用该 HQ 启动有后勤奖励"(offensive.js choose(): 命中
    // logistic_alt[0] 时把 G.offensive.logistic 抬到 logistic_alt[1], 如 AP#45 Flintlock
    // 4→8)。旧实现选 HQ 只看战略轴名字正则 + 指挥范围, 从不读当前攻势卡 → 有奖励的
    // 指定 HQ 被忽略(用户取证: 总去激活中太平洋 HQ 79)。
    // 卡牌 id 取自 view.offensive(引擎已在 choose_hq/activate_units 设置 offensive_card
    // 与 counter_offensive_card); 候选里没有命中牌面 HQ 时该键均匀, 自然回退原排序。
    const emcCardHq=(typeof em_cfg==="function")?em_cfg():null
    let cardHqSet=null,logiAltSet=null
    if(emcCardHq&&emcCardHq.card_hq_priority){
        try{
            const mineF=role==="Japan"?JP:AP
            const off=view?.offensive||((typeof G!=="undefined"&&G)?G.offensive:null)
            const cid=off?(Number(off.attacker)===mineF?off.offensive_card:off.counter_offensive_card):-1
            const c=(typeof cards!=="undefined"&&cid>0)?cards[cid]:null
            if(c&&(c.faction===undefined||c.faction===mineF)){
                if(Array.isArray(c.hq)&&c.hq.length)cardHqSet=new Set(c.hq)
                if(Array.isArray(c.logistic_alt)&&c.logistic_alt[0]&&Number(c.logistic_alt[1])>0)logiAltSet=new Set(c.logistic_alt[0])
            }
        }catch(e){cardHqSet=null;logiAltSet=null}
    }
    const hqRank=id=>cardHqSet?(cardHqSet.has(id)?0:1):0
    const altRank=id=>logiAltSet?(logiAltSet.has(id)?0:1):0
    const score=id=>{const u=byId.get(id),d=u&&focus!==null&&focus!==undefined&&typeof get_distance==="function"?get_distance(u.location,focus):99
        const preview=typeof erasmus_preview_activatable_units==="function"?erasmus_preview_activatable_units(id):null
        const n=Array.isArray(preview)?preview.length:commandable(id)
        // 先排除“名义上符合战略、实际上范围内没有任何兵力”的 HQ；多个可用 HQ
        // 再按图表指定 HQ、目标距离和效能排序。夺占目标优先要“有地面军”的 HQ。
        return [n>0?0:1,needsGround?(groundCommandable(id)>0?0:1):0,
            hqRank(id),altRank(id),
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
