// 参数注册中心 (Research Plan v1.0 §11: 禁止 magic score 散落) — erasmus-v2-opt 研究层。
// 全部优化开关默认关闭 = 基线(zh.23)行为逐位一致; erasmus-v2-opt 按角色 profile 开启。
// 消融实验 = 逐开关对比; 数值参数集中于此, 便于敏感性分析。
"use strict"

const EM_FLAGS = [
    "target_scoring",         // 1=链内未完成目标按 价值×可达性 重排焦点; 0=链首优先(基线)
    "taskforce_math",         // 1=编队边际效用选单位+两栖期望闸门; 0=兵种词典序贪心(基线)
    "allies_cv_preserve",     // 1=盟军非登陆场合避免消耗 CV; 0=不区分
    "allies_pow_quota",       // 1=盟军 PoW 未达标时命名格加权; 0=不加权
    "allies_resource_raid",   // 1=盟军对日资源格目标加权(原子弹/VP 条件); 0=不加权
    "japan_resource_defense", // 1=日本资源格防守加权; 0=不加权
    "allies_blockade",        // 1=盟军封锁推进前视(朝鲜桥头堡+AZOI 环, 规则 16.47/trace 胜利); 0=不启用
    "allies_blockade_v2",     // 1=盟军资源封锁主路: 无门槛全量 raid 非己控资源格+己控资源格 GARRISON 驻守; 0=不启用
    "capture_rate",           // 1=PBM/推进落点优先"空虚敌控格"(地面移入即夺, move.js:881 路径夺格); 0=基线落点表
    "island_sweep",           // 1=岛群清扫: 激活预算用满(链上轮换+推进兜底)+岛群多路登陆+申报窗多焦点; 0=基线
    "loss_optimal",           // 1=受击分配价值最优(一步受损损失最小化, 替换 CV→BB→CA→DD 词典序); 0=图表序
    "erasmus_plus",
    "japan_opening_conquest", // 1=日本T2-3强制南方资源轴+新加坡移除压制条目(马来亚投降链闭合); 0=官方图表           // 1=战役层(评估/姿态/紧急度/计划分配, erasmus_plus.js); 0=散件开关模式
    "tojo_pressure",          // 1=T8 起 CV 空袭日本地区(每次强制日随机弃牌, 弃 TOJO_RESIGNS 即激活 TOJO); 0=基线
    "amphib_asp_gate",        // 1=两栖登陆过 ASP 运输闸门(Σ地面 asp ≤ 可用 ASP 才编组/才选该目标); 0=只算海空战期望(基线)
    "amphib_escort_math",     // 1=两栖护航"补到够"(≥ margin×敌方守军+反应 才收工/才登陆); 0=只补一支护航(基线)
    "landing_value",          // 1=落脚/登陆只把【有价值】的空虚敌控格(资源/机场/港口/名/城市)置顶, 无价值礁格回落港口表; 0=任意空虚敌控格置顶(基线)
    "card_hq_priority",       // 1=攻势 HQ 选择优先「当前牌的 card.hq / logistic_alt 奖励 HQ」; 0=只按战略轴名字(基线)
    "chain_prereq",           // 1=战略链前置跳板闸门: 链上 pending 目标须已具备前置(己控相邻格/陆路连通/己控港口机场
                              //   ≤emChainPrereqDist/己方地面在旁), 否则顺延到下一个候选目标(不放弃整条链;
                              //   全不满足则回退原逻辑); 0=纯图表链序(基线, 逐位一致)
    "air_forward",            // 1=航空前推: 焦点编不出编队时把后方航空激活并前推到"更靠近敌方的己方机场"(投射
                              //   航空 ZOI; 引擎侧同向优先该前推机场); 0=航空窝在后方机场(基线, 逐位一致)
    "hq_withdraw_guard",      // 1=兜底动作链不选「自愿转移指挥部」(6.13 displace_hq; 实测纯零收益往返回原位, 且可
                              //   触发 sudden death/永久消灭 notreplaceable HQ); 0=基线(逐位一致)
    "stack_limit_gate",       // 1=落点叠放闸门: 移动/PBM/推进/反应/紧急撤退/增援落位前先按引擎
                              //   is_overstack 判定"再放进去是否超编"(每格每方 地面+航空 ≤3、
                              //   HQ ≤1、海军 ≤6), 超编落点剔出候选; 0=不启用(基线: 引擎移动/推进
                              //   时完全不拦, 只在阶段末 check_overstacking 事后清罚 —— 送回合盒 1-2
                              //   回合, 不可替换/断补者直接歼灭)
    "japan_south_opening",    // 1=日本 T2-5 南方开局硬目标: 未投降国家的「投降 key 格」(菲 马尼拉/达沃,
                              //   马 关丹/新加坡)升级为夺占条目(CONQUEST+requiresOccupation, 不再被 AZOI
                              //   覆盖判"完成"), 并剔除窗口内非 key 格的盟军 HQ 压制追猎条目(马尼拉陷落后
                              //   HQ 位移, 链首变成澳洲 Townsville, 整条南方轴被拉走); 0=官方图表(逐位一致)
    "japan_south_opening_dei",// 1=[japan_south_opening] 附带东印度 8 key 也入硬目标(把图表本来的东印度
                              //   压制条目换成占领); 实测拖慢首降/条约胜利 8.4→10.6 均值回合, 默认关
    "battle_decl_gate",       // 1=申报窗战斗前景闸门: 激活阶段用与引擎同一判据(offensive.js
                              //   compute_possible_battle_hexes 的口径)预检"激活后能否构成战斗格"——
                              //   窗口候选对任何敌占格都无引擎合法参与(queryGround/NavalReachability、
                              //   in_range_on_map), 且对焦点格也无法合法进入时, 不再把激活预算与部队
                              //   投进注定空转的攻势(取证 2 seed/232 攻势/61 次"激活后空转", 其中 56 次
                              //   连一格都没夺到); 0=基线(逐位一致)
    "force_concentration",    // 1=集中兵力: 主动发起会战前把"当轮引擎判定真能打到该格"的可达海空
                              //   (及必要地面)编到 emConcentrationMargin 倍优势才收工 —— ①激活焦点/
                              //   选兵只用能参与该格会战的候选, 打不到的单位不再吃激活预算;
                              //   ②composeTaskForce 的 support/damage 门(只判兵种构成 + 打平)之后
                              //   追加"引擎口径兵力优势"判定, 未达 margin 不收工, 继续补兵;
                              //   ③岛群簇分流(cluster landing)在焦点主任务未达 margin 时停用, 兵力
                              //   不再被摊薄到次级登陆格; ④申报窗按"优势最大"选战斗格, 而不是"离焦点
                              //   最近"(旧行为把同一支攻势拆到多格, 每格都不成优势)。
                              //   取证(15 局): 主动会战进攻方投入单位数中位数 1(守方 2-3), 每攻势
                              //   激活 ~3.7 单位但只 46% 进得了引擎 possible_units(26% 无 br 地面、
                              //   28% 当轮打不到任何敌格) → 每场会战实际只剩 1 个单位。
                              //   0=基线: 不介入任何环节, 决策路径逐位一致
]

// 数值参数(敏感性问题分析对象; 均有工程注释)
const EM_PARAMS_BASE = {
    emWWin: 1.0,            // 夺格/战胜概率效用权重
    emWLoss: 0.6,           // 己方期望损失惩罚权重(cf 加权)
    emWCost: 0.05,          // 单位激活固定成本
    emMinPWin: 0.30,        // 两栖登陆最低可接受获胜概率, 低于则取消空攻势
    emScoreDistDecay: 0.9,  // 目标评分距离衰减因子
    emDoctrineDecay: 0.92,  // 链序衰减: 越靠链首 doctrine 权重越高
    emCvReserveMinAdv: 1.5, // CV 投入所需最低边际效用倍数
    emRaidResTrigger: 10,   // 日本资源 ≤ 该值时盟军追加资源 raid 目标(原子弹门槛 5/3)
    emRaidMaxTargets: 4,    // 每次战略链最多追加的 raid 资源格数
    emAmphNavalMargin: 1.0, // 两栖登陆放行所需海空战力优势倍数(对未建模反应的保守边际)
    emAmphEscortDist: 4,    // 护航海军与登陆地面可会合的最大距离(同格或该距离内)
    emReactionWeight: 0.35,  // 反应兵力折算系数(反应需掷骰/天气成立, 非必然到场)
    emBlockadeTurnMin: 7,   // [allies_blockade] 封锁推进启动的最早回合(1943=T7 只剩收尾, 1942=T7 余 6 回合)
    emSweepAdvDist: 3,      // [island_sweep] 推进兜底: 地面到最近空虚敌控格超过该距离不选(防深腹地暴露行军)
    emSweepHarborNav: 6,    // [island_sweep] 港内敌舰 cf ≥ 该值(航母/战列级)的登陆目标跳过(港湾海空战风险)
    emSweepCluster: 4,      // [island_sweep 段2] 岛群簇大小上限(焦点外次级登陆格数)
    emSweepClusterDist: 2,  // [island_sweep 段2] 岛群簇收集半径(到焦点 hex 距离)
    emBlkInsAfterPending: 2,   // [allies_blockade_v2] raid 格插到链首前 N 个 pending 夺占目标之后(不占绝对首位)
    emBlkGarrisonSteps: 2,     // [allies_blockade_v2] 己控资源格 GARRISON 所需地面步数(防日本夺回)
    emBlkManchCutTurn: 5,      // [allies_blockade_v2] 满洲通路切断目标(Pusan CONQUEST)最早回合
    emBlkPinResTargets: 4,     // [allies_blockade_v2] 链级封锁主轴每次前插的 JP 资源格上限(按前沿距离取最近)
    emBlkPinResReach: 20,
    emChainPrereqDist: 6,      // [chain_prereq] 前置跳板判定半径(格): 己方控制的港口/机场到焦点目标 ≤ 该距离
                               //   即视为"两栖/航空跳板已在战程内"(取证: 链路跳过菲律宾/帕劳/塞班直取台湾/上海,
                               //   孤军被日军航空 ZOI 断补; 6 格 ≈ 两栖一跳+航空基地照应, 不放行纵深跳跃)
    emSouthOpenMinTurn: 2,  // [japan_south_opening] 南方开局硬目标窗口起始回合
    emSouthOpenMaxTurn: 5,  // [japan_south_opening] 窗口结束回合(此后交回图表战略; 马来亚期望 T3-T5 首降)
    // [force_concentration] 集中兵力参数 (引擎口径兵力, 单位 = 实兵 cf)
    emConcentrationMargin: 1.5, // 主动会战放行所需海空战力优势倍数: 攻方空海 ≥ 该倍数 ×
                                //   (守方格内空海 + emReactionWeight × 可反应空海)。1.0 = 打平,
                                //   1.5 = 明显优势(用户要求); 与 amphib_escort_math 的
                                //   emAmphNavalMargin 同族, 但适用范围从"仅登陆"扩到所有主动会战
    emConcentrationMinUnits: 3, // 集中格判定所需的"可共同投入"最少单位数(引擎口径: 当轮 br/ebr
                                //   覆盖该敌占格的已激活单位 + 可两栖抵达的 asp/strat_move 地面)。
                                //   低于该值的格不算"集中", 不改变原有选格
    emTojoTurn: 8,         // [tojo_pressure] 开始袭扰日本地区的最早回合     // [allies_blockade_v2] 链级前插资源格的前沿半径(地面距离; 两栖目标经海军一跳可达,
                          //  地面距离 6 会漏掉全部 DEI/婆罗洲目标——放宽后由编队可行性过滤, 簇按距离仍就近优先)
}

// 未设 EOTS_OPT_PROFILE 时 erasmus-v2-opt 的内置默认(可玩项默认配置):
// 已验证最优组合(dawn-final32/blk2 系列定版), 兼容双方角色(盟军专属 flag 对日惰性)。
// card_hq_priority 暂不入默认: 实现已就绪(攻势 HQ 优先牌面 card.hq / logistic_alt 奖励
// HQ), 但实测开启后盟军终局日资源压制指标 6.60→7.80(behavior-tests ResourcePressureDirection),
// 无正向证据前保持关闭, 供消融/后续验证。
const EM_DEFAULT_PROFILE = "taskforce_math,island_sweep,allies_resource_raid,allies_blockade_v2,allies_pow_quota,allies_cv_preserve,loss_optimal"
// AI 5.0 = 4.0 + 两栖修复: ASP 运输闸门(装不上的登陆不编组/不选该目标) + 护航补到够
// (守方有海军/可反应海军时, 护航战力须达标才收工)。card_hq_priority 仍不入默认
// (实测开启后资源压制指标恶化, 见下)。
const EM_DEFAULT_PROFILE_V5 = EM_DEFAULT_PROFILE + ",amphib_asp_gate,amphib_escort_math,landing_value,chain_prereq,air_forward,hq_withdraw_guard"
// 注: japan_south_opening(南方开局链路修复) 暂不入默认 —— 单独测量有效(马来亚 0/5→3/5),
// 但与上面全套开关组合时实测未生效(新加坡未被夺/马来亚仍 T0), 且开启后行为测试 2 项失败。
// 待交互问题定位后再纳入。

function em_profile_from_env(defaultProfile) {
    // EOTS_OPT_PROFILE=all|baseline|逗号分隔开关列表(未设=该 bot 的内置默认)
    // EOTS_OPT_PARAMS=key=value,key=value (数值参数覆盖, 供参数扫描)
    if (typeof process === "undefined" || !process.env) return {}
    let raw = process.env.EOTS_OPT_PROFILE
    if (raw === "baseline") return {}
    if (!raw) raw = defaultProfile || EM_DEFAULT_PROFILE
    const p = {}
    if (raw === "all") { EM_FLAGS.forEach(f => p[f] = 1) }
    else raw.split(",").map(s => s.trim()).filter(Boolean).forEach(f => { if (EM_FLAGS.includes(f)) p[f] = 1 })
    const pv = process.env.EOTS_OPT_PARAMS
    if (pv) {
        pv.split(",").map(s => s.trim()).filter(Boolean).forEach(kv => {
            const [k, v] = kv.split("=")
            if (k in EM_PARAMS_BASE) { const n = Number(v); if (Number.isFinite(n)) p[k] = n }
        })
    }
    return p
}

let em_current = null

function em_cfg() {
    if (em_current) return em_current
    return null
}

// [opt 跨窗读取] 引擎侧(offensive.js/events.js 等)在 bot.decide 之外运行, 而 em_cfg()
// 只在 decide 期间有值(decide 结束 finally 里 em_reset_config 置 null) —— 实测引擎侧
// 恒为 null, 任何挂在 em_cfg() 上的引擎闸门都是死代码(如旧 swStackOk)。故在每次
// em_set_config 成功注入时同步一份模块级快照, 供引擎侧用 em_flag(name) 读取
// "本回合/本局最近一次注入的 profile"; 快照随 decide 更新, 不随 reset 清除。
// 基线 bot(erasmus-v2)从不调用 em_set_config → 快照恒空 → em_flag 恒 0 → 逐位不变。
let EM_LAST_FLAGS = {}

// 引擎侧/决策侧统一开关读取: decide 期内读当前注入配置, 期外读最近一次快照。
// 未知 flag / 未注入 profile 一律 0。
function em_flag(name) {
    const c = em_cfg()
    return (c ? c[name] : (EM_LAST_FLAGS[name] || 0)) ? 1 : 0
}

// opt bot 每次决策前按角色注入; 决策结束必须 reset(防串染基线 bot)。
function em_set_config(flags, params) {
    const merged = { ...EM_PARAMS_BASE }
    EM_FLAGS.forEach(f => merged[f] = 0)
    if (flags) for (const k of Object.keys(flags)) if (EM_FLAGS.includes(flags[k] !== undefined ? k : k)) merged[k] = flags[k] ? 1 : 0
    if (params) for (const k of Object.keys(params)) if (k in EM_PARAMS_BASE) merged[k] = params[k]
    em_current = merged
    EM_LAST_FLAGS = { ...merged }
}

function em_reset_config() { em_current = null }
