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
    emTojoTurn: 8,         // [tojo_pressure] 开始袭扰日本地区的最早回合     // [allies_blockade_v2] 链级前插资源格的前沿半径(地面距离; 两栖目标经海军一跳可达,
                          //  地面距离 6 会漏掉全部 DEI/婆罗洲目标——放宽后由编队可行性过滤, 簇按距离仍就近优先)
}

// 未设 EOTS_OPT_PROFILE 时 erasmus-v2-opt 的内置默认(可玩项默认配置):
// 已验证最优组合(dawn-final32/blk2 系列定版), 兼容双方角色(盟军专属 flag 对日惰性)。
const EM_DEFAULT_PROFILE = "taskforce_math,island_sweep,allies_resource_raid,allies_blockade_v2,allies_pow_quota,allies_cv_preserve,loss_optimal"

function em_profile_from_env() {
    // EOTS_OPT_PROFILE=all|baseline|逗号分隔开关列表(未设=内置默认)
    // EOTS_OPT_PARAMS=key=value,key=value (数值参数覆盖, 供参数扫描)
    if (typeof process === "undefined" || !process.env) return {}
    let raw = process.env.EOTS_OPT_PROFILE
    if (raw === "baseline") return {}
    if (!raw) raw = EM_DEFAULT_PROFILE
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

// opt bot 每次决策前按角色注入; 决策结束必须 reset(防串染基线 bot)。
function em_set_config(flags, params) {
    const merged = { ...EM_PARAMS_BASE }
    EM_FLAGS.forEach(f => merged[f] = 0)
    if (flags) for (const k of Object.keys(flags)) if (EM_FLAGS.includes(flags[k] !== undefined ? k : k)) merged[k] = flags[k] ? 1 : 0
    if (params) for (const k of Object.keys(params)) if (k in EM_PARAMS_BASE) merged[k] = params[k]
    em_current = merged
}

function em_reset_config() { em_current = null }
