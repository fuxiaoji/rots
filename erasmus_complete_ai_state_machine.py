"""
Erasmus Complete AI State Machine（Python 参考实现 / 状态机草案补全）

角色：把《伊拉斯谟 v2.0 图表汉化》决策轴/选牌/任务部队编成/反应四类决策
     组织成一个确定性、可审计、可回放的状态机 AI，供 JS 引擎侧 PvE 复刻核对。

溯源与置信度约定（遵守 agent.md）
----------------------------------
- 策略方块文字（目标优先级 / 执行注释）来自
  docs/rules/normalized/erasmus-v2-zh-charts/charts/*.md（PDF 逐页提取文本）。
- 图中“A..M”条件方块的文字来自同一批逐页文件；方块之间的箭头拓扑至今
  仍未人工校对（逐页 JSON 的 edges 多数标为 inferred），因此本文件内的
  分支走向属于“基于用户草案的实现假设”。
- 每个决策都返回 trace：chart（页图 ID）、触发条件、掷骰与策略代码 ID；
  涉及未视觉校对的走向统一标记 confidence="inferred"，不伪装成确定规则。
- 随机性只能来自显式种子：全部掷骰走 self._rng（Random(seed)）。

本文件是仓库 P4 研究实现，不直接修改服务器状态；只消费“上下文”并产出
“动作语义建议 + 决策轨迹”。
"""

import random
from typing import Dict, List, Optional, NamedTuple


POLICY_VERSION = "erasmus-v2.0-zh.draft-py1"


class StrategyDetails:
    """战略方块数据类（含英文稳定代码 ID，供跨语言/轨迹审计使用）。"""

    def __init__(self, sid: str, name: str, targets: List[str], notes: List[str],
                 instructions: str = "", source_page: int = 0, kind: str = "strategy"):
        self.id = sid                 # 稳定英文代码（trace/未来跨语言对账用）
        self.name = name              # 中文显示名
        self.targets = targets
        self.notes = notes
        self.instructions = instructions
        self.source_page = source_page  # PDF 图表页码
        self.kind = kind

    def describe(self) -> str:
        t = "\n    ".join(self.targets) if self.targets else "无特定目标"
        n = "\n    ".join(self.notes) if self.notes else "无执行注释"
        return (f"【{self.name}】 <{self.id}>\n"
                f"  [说明]: {self.instructions}\n"
                f"  [目标优先级]:\n    {t}\n"
                f"  [执行注释]:\n    {n}")


class Decision(NamedTuple):
    strategy: StrategyDetails      # 命中的战略方块（决策轴/选牌/编成/反应共用）
    action_hint: str               # 引擎语义动作建议（见 ACTION_HINTS）
    chart: str                     # 图页代码，例如 ERASMUS-JP-01
    source_page: int
    conditions: List[Dict]         # [{"node":..., "predicate":..., "value":...}]
    dice: Optional[Dict]           # {"id","sides","result"} 或 None
    confidence: str                # "confirmed" | "inferred"
    reason: str                    # 人读决策理由（中文）

    def as_dict(self) -> Dict:
        return {
            "policy": POLICY_VERSION,
            "strategy": self.strategy.id,
            "strategy_zh": self.strategy.name,
            "action_hint": self.action_hint,
            "chart": self.chart,
            "source_page": self.source_page,
            "conditions": self.conditions,
            "dice": self.dice,
            "confidence": self.confidence,
            "reason": self.reason,
        }


ACTION_HINTS = {
    # 决策轴 → 选牌/打牌入口
    "play_event": "本回合以事件（EC）打出军事/事件牌",
    "play_ops": "本回合以行动（OC）打出行动牌",
    "play_foq": "把一张牌放入未来攻势（FOQ）",
    "pass": "跳过本轮/放弃行动",
    # 任务部队编成 → 引擎需要的部队种类组合
    "air_naval_strike": "航空/海上打击（压制 AZOI）",
    "air_support_ground": "带航空支援的地面攻击",
    "air_sea_ground": "带航空/海上支援的地面攻击",
    "sea_support_landing": "带海上支援的两栖登陆",
    "air_sea_landing": "带航空/海上支援的两栖登陆",
    "unsupported_landing": "无支援两栖登陆（仅空目标/无反应时）",
    "ground_advance": "向目标进军（地面移动不交战）",
    # 反应
    "intel_reaction": "情报反应（JN-25 等）",
    "naval_reaction": "海上/航母反应",
    "air_reaction": "航空反应",
    "reinforce_reaction": "增援反应",
    "counterattack_reaction": "反攻反应",
    "pbm": "战后移动（PBM）",
}


# ---------------------------------------------------------------------------
# 页码表：页 JSON 已按 PDF 原页登记，这里保持一致供 trace 引用
# ---------------------------------------------------------------------------
JP_CHART = {
    ("early", "decision-axis"): ("ERASMUS-JP-01", 1),
    ("middle", "decision-axis"): ("ERASMUS-JP-02", 2),
    ("end", "decision-axis"): ("ERASMUS-JP-03", 3),
    ("all", "card-selection"): ("ERASMUS-JP-04", 4),
    ("all", "task-force"): ("ERASMUS-JP-05", 5),
    ("all", "reaction"): ("ERASMUS-JP-06", 6),
}
AP_CHART = {
    ("early", "decision-axis"): ("ERASMUS-AP-07", 7),
    ("middle", "decision-axis"): ("ERASMUS-AP-08", 8),
    ("end", "decision-axis"): ("ERASMUS-AP-09", 9),
    ("all", "card-selection"): ("ERASMUS-AP-10", 10),
    ("all", "task-force"): ("ERASMUS-AP-11", 11),
    ("all", "reaction"): ("ERASMUS-AP-12", 12),
}

# ---------------------------------------------------------------------------
# 执行注释文本（编号与 PDF 图表一致；来源 docs/.../charts/*.md）
# ---------------------------------------------------------------------------
JP_EARLY_NOTES = {
    "1": "[1].激活必须使盟军HQ断补。",
    "2": "[2].登陆的一个地面单位可以在指定目标的损耗中存活下来。",
    "3": "[3].如果卡牌条件允许,按照策略指示使用卡牌。",
    "4": "[4].如有可能,战后移动一个空中单位到目标格,不然移动一个航母过去。",
    "5": "[5].如果欧洲战事为正数,则打出可用的欧战牌,否则按指示投骰。",
    "6": "[6].如果已经控制,则用至少3step的地面单位加固这里,其他情况则忽视该条。",
    "7": "[7].以足够的力量,按伤害等级消灭覆盖目标(或特定HQ)的敌方AZOI单位"
         "的力量进行空中/海上攻击,如有必要占领一个基地,战后移动时把ZOI覆盖敌方HQ。",
}
JP_MID_NOTES = {
    "1": "[1].如果卡牌条件允许,按照策略指示使用卡牌。",
    "2": "[2].登陆的一个地面单位可以在指定目标的损耗中存活下来。",
    "3": "[3].占领尽可能多的资源格,直到日本控制至少13个(优先无敌军、弱敌军)。",
    "4": "[4].如果可能的话,用AZOI覆盖这些目标,否则转移到下一个目标。",
    "5": "[5].在指定位置放置至少3step地面或1step空中单位。",
}
JP_LATE_NOTES = {
    "1": "[1].如果满足条件按顺序执行。第12回合绝不把牌作为FOQ。",
    "3": "[3].将任意空中/海上补员用于本州岛,维持到资源格的AZOI。",
    "4": "[4].移动地面单位填满盟军占据格的相邻格。",
    "5": "[5].尽可能在本州岛每个六角格放置空中/海上单位。",
    "6": "[6].如果相邻格被占据满,用最大战力进攻盟军。",
    "7": "[7].所有本州岛战斗派空中/海上单位支援。",
    "8": "[8].战斗到最后一step地面单位。",
}
CARD_NOTES = {
    "preemptive": "先发打击:按顺序打出 1.伊号作战 2.第二阶段作战。",
    "ec_lv": "EC 标准:选择后勤值最高的牌;有进攻奖励则优先:伞兵→非伞兵→无奖励。",
    "oc_highest": "OC 标准:选择行动值(OC)最高的牌。",
    "oc_limited": "有限制军事事件 OC:选择OC最高;若它是军事事件牌且存在非军事事件选择,则随机一张OC牌。",
    "event_order": "事件顺序:欧战→补员→结束日本ISR→使美国ISR→其他(随机)。",
    "last_cards": "按事件顺序留出最后两张:东京玫瑰,东条,欧战,结束日本军种对立,开始美国军种对立,补员,天气。",
}

# ---------------------------------------------------------------------------
# 日本早期 / 中期 / 终局 决策轴战略库（中文名保持草稿一致；补全缺失键）
# ---------------------------------------------------------------------------
JP_EARLY_STRATEGIES = {
    "激进的空优战略": StrategyDetails(
        "JP_EARLY_AGGRESSIVE_AIR", "激进的空优战略",
        ["1. 压制东印度", "2. Makassar [4]", "3. Teloekbetoeng [4]", "4. Bandjermasin [4]"],
        [JP_EARLY_NOTES["4"], JP_EARLY_NOTES["7"]],
        source_page=1),
    "保守的空优战略": StrategyDetails(
        "JP_EARLY_CONSERVATIVE_AIR", "保守的空优战略",
        ["1. 压制盟军HQ", "2. 压制东印度"],
        [JP_EARLY_NOTES["1"],
         "压制盟军HQ目标: 1.菲律宾(0.25x) 2.新加坡(0.5x) 3.ABDA(0.5x)"],
        source_page=1),
    "激进的南方资源战略": StrategyDetails(
        "JP_EARLY_AGGRESSIVE_SOUTH", "激进的南方资源战略",
        ["1. 压制盟军HQ", "2. 东印度投降", "3. 马来亚投降", "4. 菲律宾投降", "5. Roll 1d10 分配"],
        [JP_EARLY_NOTES["1"], "东印度投降格: Balikpapan, Tarakan, Batavia, Tjilatjap..."],
        source_page=1),
    "保守的南方资源战略": StrategyDetails(
        "JP_EARLY_CONSERVATIVE_SOUTH", "保守的南方资源战略",
        ["1. 压制东印度", "2. 马来亚投降", "3. 菲律宾投降", "4. Roll 1d10 分配"],
        [], source_page=1),
    "中缅印战略": StrategyDetails(
        "JP_CBI", "中缅印战略 (CBI)",
        ["1. 缅甸投降 (Rangoon, Mandalay, Lashio, Myitkyina)",
         "2. 中国投降 (Lashio, 中国攻势, 中国事件)"],
        [], source_page=1),
    "中太平洋战略": StrategyDetails(
        "JP_CENTRAL_PACIFIC", "中太平洋战略",
        ["1. 拉包尔(若被盟军控制)", "2. 阿图/吉斯卡", "3. 马绍尔防御 (Wake, Tarawa)", "4. 中途岛"],
        [JP_EARLY_NOTES["6"]], source_page=1),
    "马绍尔防御": StrategyDetails(
        "JP_MARSHALL_DEFENSE", "马绍尔防御",
        ["1. Wake威克岛", "2. Tarawa塔拉瓦"],
        [JP_EARLY_NOTES["6"]], source_page=1),
    "外围防御战略": StrategyDetails(
        "JP_PERIMETER_DEFENSE", "外围防御战略",
        ["1. 澳洲委任统治地 (西北新几内亚, 瓜岛, 莫尔茨比)",
         "2. 新几内亚 (Hollandia, Lae, Buna...)"],
        [], source_page=1),
    "事件战略": StrategyDetails(
        "JP_EVENT", "事件战略",
        ["1. 欧战为正打欧战牌,否则FOQ", "2. 结束日本ISR", "3. 造成美国ISR",
         "4. 东京玫瑰", "5. 补员牌", "6. 天气牌", "7. 东条作为1OC", "8. 其他放牌"],
        [JP_EARLY_NOTES["3"], JP_EARLY_NOTES["5"]], source_page=1),
}

JP_MID_STRATEGIES = {
    "资源战略": StrategyDetails(
        "JP_RESOURCE", "资源战略",
        ["1. 占领资源 (首尔, 马尼拉, 关丹, 所有东印度)", "2. 新几内亚投降",
         "3. 缅甸投降", "4. 中国投降", "5. 加强港口"],
        [JP_MID_NOTES["3"], JP_MID_NOTES["5"]], source_page=2),
    "中太平洋战略": StrategyDetails(
        "JP_CENTRAL_PACIFIC", "中太平洋战略",
        ["1. Attu/Kiska阿图", "2. Wake威克岛", "3. Midway中途岛", "4. 攻击美国舰队"],
        [], source_page=2),
    "中缅印战略": StrategyDetails(
        "JP_CBI", "中缅印战略 (CBI)",
        ["1. 缅甸投降", "2. 中国投降", "3. 加强港口", "4. 印度投降", "5. 事件战略"],
        [JP_MID_NOTES["1"]], source_page=2),
    "印度战略": StrategyDetails(
        "JP_INDIA", "印度战略",
        ["1. 印度投降 (Jarhat, Ledo, Dacca)", "2. 中国投降", "3. 加强港口"],
        [], source_page=2),
    "外围防御战略": StrategyDetails(
        "JP_PERIMETER_DEFENSE", "外围防御战略",
        ["1. 南太平洋侧翼 (Hollandia, Lae, Buna...)", "2. 加强港口"],
        [JP_MID_NOTES["4"], JP_MID_NOTES["5"]], source_page=2),
    "事件战略": StrategyDetails(
        "JP_EVENT", "事件战略",
        ["同早期阶段事件战略"],
        [JP_MID_NOTES["1"]], source_page=2),
    "PASS": StrategyDetails("JP_PASS", "PASS", ["跳过本回合行动"], [], source_page=2),
}

JP_LATE_STRATEGIES = {
    "最终国防圈战略": StrategyDetails(
        "JP_FINAL_EMPIRE_DEFENSE", "最终国防圈战略",
        ["1. 港口驻军 (冲绳, 首尔, 釜山, 台南, 塞班)", "2. 机场驻军 (硫磺岛, 京都)",
         "3. 日本港口驻军 (佐世保, 吴, 东京...)"],
        [JP_LATE_NOTES["3"]], source_page=3),
    "最终防御战略": StrategyDetails(
        "JP_FINAL_DEFENSE", "最终防御战略",
        ["1. 集结部队", "2. 海空支援", "3. 板载冲锋"],
        [JP_LATE_NOTES["4"], JP_LATE_NOTES["5"], JP_LATE_NOTES["6"],
         JP_LATE_NOTES["7"], JP_LATE_NOTES["8"]],
        source_page=3),
    "事件战略": StrategyDetails(
        "JP_EVENT", "事件战略", ["同中/早期阶段事件战略"],
        [JP_LATE_NOTES["1"]], source_page=3),
    "PASS": StrategyDetails("JP_PASS", "PASS", ["跳过本回合行动"], [], source_page=3),
}

# ---------------------------------------------------------------------------
# 盟军 早期 / 中期 / 终局 决策轴战略库
# ---------------------------------------------------------------------------
AL_EARLY_STRATEGIES = {
    "撤离菲律宾": StrategyDetails(
        "AP_EVACUATE_PHILIPPINES", "撤离菲律宾",
        ["P旅到Biak", "R军到Kendari", "[SL]军到马尼拉..."],
        ["如果单位已就位则视为完成"], source_page=7),
    "撤离马来亚": StrategyDetails(
        "AP_EVACUATE_MALAYA", "撤离马来亚",
        ["8 Aus到Kendari", "MA Air到Palembang"], [], source_page=7),
    "建立ABDA": StrategyDetails(
        "AP_ESTABLISH_ABDA", "建立 ABDA 指挥部",
        ["打出阿卡迪亚会议,放置ABDA HQ到有效港口"], [], source_page=7),
    "增强CBI防御": StrategyDetails(
        "AP_STRENGTHEN_CBI", "增强 CBI 防御",
        ["1 Ind到仰光", "B Ind师到Akyab..."],
        ["所有单位就位视作建立完成"], source_page=7),
    "DEI防御": StrategyDetails(
        "AP_DEI_DEFENSE", "DEI 防御",
        ["派英联邦或美军前往ABDA HQ港口 (Tjilatjap, Kendari...)"], [], source_page=7),
    "橙色计划": StrategyDetails(
        "AP_PLAN_ORANGE", "橙色计划 (Plan Orange)",
        ["1. 美国军护航派往莱特岛", "2. 若莱特被控,派往马尼拉"], [], source_page=7),
    "攻势进攻": StrategyDetails(
        "AP_OFFENSIVE_ATTACK", "攻势进攻",
        ["1. 对最弱日本单位发起1x海空攻击", "2. 脱离最后一支航母避免被灭"],
        [], source_page=7),
    "事件战略": StrategyDetails(
        "AP_EVENT", "事件战略",
        ["按盟军早期事件优先级打出可用事件牌"], [], source_page=7),
    "PASS": StrategyDetails("AP_PASS", "PASS", ["跳过本回合行动"], [], source_page=7),
}

AL_MID_STRATEGIES = {
    "反攻战略": StrategyDetails(
        "AP_COUNTEROFFENSIVE", "反攻战略",
        ["中途岛, 荷兰港, Dacca, 瓜岛, 阿图岛..."],
        ["按顺序占领,无法攻击则向前移动基地"], source_page=8),
    "南太平洋战略": StrategyDetails(
        "AP_SOUTH_PACIFIC", "南太平洋战略",
        ["瓜岛, 吉里吉里, 莫尔茨比..."], ["优先ANZAC/SW HQ"], source_page=8),
    "中太平洋战略": StrategyDetails(
        "AP_CENTRAL_PACIFIC", "中太平洋战略",
        ["威克岛, 塔拉瓦, 塞班..."], ["优先Cen Pac HQ"], source_page=8),
    "CBI战略": StrategyDetails(
        "AP_CBI", "CBI 战略",
        ["Dacca, Akyab, 仰光..."], ["优先SEAC HQ"], source_page=8),
    "DEI战略": StrategyDetails(
        "AP_DEI", "DEI 战略",
        ["Timor, Kendari, 泗水..."], ["优先ANZAC/SW HQ"], source_page=8),
    "事件战略": StrategyDetails(
        "AP_EVENT", "事件战略", ["同早期阶段事件战略"], [], source_page=8),
    "PASS": StrategyDetails("AP_PASS", "PASS", ["跳过本回合行动"], [], source_page=8),
}

AL_LATE_STRATEGIES = {
    "占领轰炸基地": StrategyDetails(
        "AP_CAPTURE_STRATEGIC_BASE", "占领战略轰炸基地",
        ["塞班, 关岛, 南鸟岛, 硫磺岛, 冲绳, 台北"], ["使用最大攻势卡占领"], source_page=9),
    "推进B29": StrategyDetails(
        "AP_PUSH_B29", "推进 B29",
        ["使用OC移动B29到战略基地", "剩余激活点攻击日军航母/空军"], [], source_page=9),
    "重返菲律宾": StrategyDetails(
        "AP_RETURN_PHILIPPINES", "重返菲律宾",
        ["连接SW Pac HQ距莱特4格基地", "莱特", "达沃", "马尼拉"], [], source_page=9),
    "跳岛作战": StrategyDetails(
        "AP_ISLAND_HOPPING", "跳岛作战",
        ["夸贾林, 恩尼威托克, 塞班, 硫磺岛, 冲绳, 登陆日本"], [], source_page=9),
    "原子弹胜利": StrategyDetails(
        "AP_ATOMIC_VICTORY", "原子弹胜利",
        ["1. 打出苏联入侵满洲", "2. 占领剩下的日本资源格"],
        ["需连续轰炸成功且日本资源<=3"], source_page=9),
    "登陆日本": StrategyDetails(
        "AP_INVADE_JAPAN", "登陆日本",
        ["准备并执行对日本本土的登陆/占领"], [], source_page=9),
    "轮流战略": StrategyDetails(
        "AP_ALTERNATE", "轮流战略",
        ["上次重返菲律宾则跳岛,上次跳岛则重返"], [], source_page=9),
    "事件战略": StrategyDetails(
        "AP_EVENT", "事件战略", ["同早期阶段事件战略"], [], source_page=9),
    "PASS": StrategyDetails("AP_PASS", "PASS", ["跳过本回合行动"], [], source_page=9),
}

# ---------------------------------------------------------------------------
# 卡牌策略（第 4/10 页文本）与任务部队编成（第 5/11 页文本）
# ---------------------------------------------------------------------------
CARD_STRATEGIES = {
    "先发打击 EC": StrategyDetails(
        "PREEMPTIVE_EC", "先发打击 EC",
        ["1. 伊号作战 (JP) / 燧发枪行动 (AL)", "2. 第二阶段作战 (JP) / 脚指甲行动 (AL)"],
        [], source_page=4),
    "无限制事件 EC": StrategyDetails(
        "UNRESTRICTED_EVENT_EC", "无限制事件 EC",
        ["选择后勤值(LV)最高的牌,优先有进攻奖励的"], [CARD_NOTES["ec_lv"]], source_page=4),
    "有限制事件 EC": StrategyDetails(
        "RESTRICTED_EVENT_EC", "有限制事件 EC",
        ["选择后勤值(LV)最高的牌,优先有进攻奖励的"],
        [CARD_NOTES["ec_lv"], "评估时不考虑中途岛(除非特定战略)"], source_page=4),
    "有限制事件 OC": StrategyDetails(
        "RESTRICTED_EVENT_OC", "有限制事件 OC",
        ["选择行动值(OV/OC)最高的牌"],
        [CARD_NOTES["oc_limited"], "限制导致无法攻击时退化为OC"], source_page=4),
    "无军事事件 OC": StrategyDetails(
        "NO_MILITARY_OC", "无军事事件 OC",
        ["选择行动值(OC)最高的牌"], [CARD_NOTES["oc_highest"]], source_page=4),
    "事件战略": StrategyDetails(
        "EVENT_STRATEGY", "事件战略",
        ["按顺序打出可用事件牌: 欧战→补员→ISR→其他"],
        [CARD_NOTES["event_order"], CARD_NOTES["last_cards"]], source_page=4),
    "未来攻势": StrategyDetails(
        "FUTURE_OFFENSIVE", "未来攻势",
        ["将一张牌放入未来攻势区"],
        [CARD_NOTES["last_cards"]], source_page=4),
    "卡牌分类": StrategyDetails(
        "CLASSIFY_HAND", "卡牌分类",
        ["整理手牌排序"], [CARD_NOTES["last_cards"]], source_page=4),
}

TF_FORMATIONS = {
    "航空打击": StrategyDetails(
        "TF_AIR_STRIKE", "航空打击",
        ["激活空中/海上/航母单位"], ["若可能,提供足够的制空权"], source_page=5),
    "带航空支援的地面攻击": StrategyDetails(
        "TF_AIR_SUPPORT_GROUND", "带航空支援的地面攻击",
        ["激活地面、空中、航母(范围内的)"], ["必须有1空/海单位支援"], source_page=5),
    "向目标进军": StrategyDetails(
        "TF_GROUND_ADVANCE", "向目标进军",
        ["无需战斗直接移动地面单位进入"],
        ["若有敌方海上单位,进入后离开避免战斗格"], source_page=5),
    "带航空/海上支援的地面攻击": StrategyDetails(
        "TF_AIR_SEA_GROUND", "带航空/海上支援的地面攻击",
        ["激活地面、海上、空中和航母"], ["对最弱堆叠攻击"], source_page=5),
    "带海上支援的登陆": StrategyDetails(
        "TF_SEA_SUPPORT_LANDING", "带海上支援的登陆",
        ["激活海上、两栖地面、航母"], ["至少需要1海上单位"], source_page=5),
    "带航空/海上支援的登陆": StrategyDetails(
        "TF_AIR_SEA_LANDING", "带航空/海上支援的登陆",
        ["激活空中、海上、两栖地面、航母"], ["至少1海+1空,或1航母"], source_page=5),
    "无支援登陆": StrategyDetails(
        "TF_UNSUPPORTED_LANDING", "无支援登陆",
        ["仅激活两栖地面单位"], ["仅在空目标且无敌方反应时使用"], source_page=5),
}

# ---------------------------------------------------------------------------
# 反应类型（第 6/12 页的决策出口，详细文字见逐页 MD）
# ---------------------------------------------------------------------------
REACTION_STRATEGIES = {
    "天气反应": StrategyDetails("RX_WEATHER", "天气反应", ["打出天气反应牌"], [], source_page=6),
    "情报反应": StrategyDetails("RX_INTEL", "情报反应", ["打出JN-25/情报反应"], [], source_page=6),
    "反攻反应": StrategyDetails("RX_COUNTERATTACK", "反攻反应",
                                ["在敌方攻势后执行一次反击进攻"], [], source_page=6),
    "海上反应": StrategyDetails("RX_NAVAL", "海上反应", ["激活海上/航母单位进行拦截反应"], [], source_page=6),
    "航空反应": StrategyDetails("RX_AIR", "航空反应", ["激活空中单位进行反应/拦截"], [], source_page=6),
    "增援反应": StrategyDetails("RX_REINFORCE", "增援反应", ["把单位/牌作为增援投入"], [], source_page=6),
    "战后移动": StrategyDetails("RX_PBM", "战后移动(PBM)", ["移动获胜单位离开战斗格"], [], source_page=6),
    "不反应": StrategyDetails("RX_NONE", "不反应", ["放弃本反应窗口"], [], source_page=6),
}


class ErasmusContext:
    """AI 能看到的裁判状态（视图模型）。

    值在驱动层由引擎视图填充;测试用 run() 脚本直接构造。布尔含义尽量沿用
    用户草案中的字段名,新增字段按图表条件文字命名。
    """

    def __init__(self):
        # 通用
        self.cards_in_hand = 5
        self.can_pass = False
        self.current_turn = 2
        self.hand_first_card = False       # C: 这是本局第一张牌吗
        self.played_this_offensive = False  # A: 攻势阶段本回合已出过牌
        self.offensive_bonus_available = False  # 手牌有进攻奖励的军事事件
        self.has_reaction_event = False    # 剩余可用事件是反应牌

        # ---- 日本（决策轴条件 A..M / 中期 / 终局）----
        self.jp_A_allied_hq_oos_in_phil_dei_mal = False   # A: 盟军HQ断补
        self.jp_B_dei_surrender_hexes_occupied = False    # B: DEI投降格已全占
        self.jp_D_res_lt_13 = False                       # D: 资源格<13
        self.jp_F_logistics_ge_20 = False                 # F: 后勤>=20
        self.jp_H_logistics_le_19 = False                 # H: 后勤<=19
        self.jp_I_azoi_covers_dei_ports = False           # I: AZOI覆盖DEI港口
        self.jp_J_controls_rabaul_guadalcanal = False     # J: 控制拉包尔+瓜岛
        self.jp_K_controls_4_to_6_ng_ports = False        # K: 控制/AZOI 4~6个新几内亚港口
        self.jp_L_mal_phil_dei_not_conquered = True       # L: 马来/菲/东印未全征服
        self.jp_M_perimeter_target_1_complete = False     # M: 外围防御目标1完成

        self.jp_E_us_will_lt_4 = False                    # 中期: 美国意志<4
        self.jp_F_burma_surrendered = False               # 中期: 缅甸已投降
        self.jp_G_logistics_ge_15 = False                 # 中期: 后勤>=15
        self.jp_H_has_gandhi = False                      # 中期: 有甘地
        self.jp_I_more_steps_in_burma = False             # 中期: 缅甸盟军step更多
        self.jp_J_logistics_ge_18 = False                 # 中期: 后勤>=18

        self.jp_L_B_garrisons_within_8_of_tokyo = False   # 终局: 东京8格内驻军
        self.jp_L_C_airfields_within_5_of_tokyo = False   # 终局: 东京5格内机场
        self.jp_L_E_allied_on_honshu = False              # 终局: 盟军登上本州

        # ---- 日本 选牌/FO 条件 ----
        self.jp_first_card_played = False
        self.jp_has_fo_card = False                       # 手上有伊号/第二阶段
        self.jp_has_unrestricted_mil_event = False
        self.jp_has_restricted_mil_event = False
        self.jp_all_events_limited = False
        self.jp_dei_targets_done_early = False            # I: DEI目标全占(仅早期)
        self.jp_one_card_left = False
        self.jp_fo_this_turn = False                      # 本回合已选未来攻势

        # ---- 盟军 ----
        self.al_B_hq_supplied_phil = True
        self.al_C_hq_supplied_malaya = True
        self.al_D_arcadia_played = False
        self.al_E_cbi_def_established = False
        self.al_F_has_passes = False
        self.al_G_only_1_card_left = False
        self.al_J_phil_not_surrendered = True
        self.al_K_service_agreement = False
        self.al_L_has_2_carriers = False
        self.al_M_us_corps_near_carrier = False
        self.al_N_aus_no_jp_ground = True
        self.al_O_dei_not_surrendered = True
        self.al_P_abda_hq_supplied = False

        self.al_M_B_needs_war_progress = True             # 中期: 需要推进战局
        self.al_M_D_jp_controls_counterattack_target = True

        self.al_L_B_is_turn_12 = False
        self.al_L_D_has_strategic_bombing_base = False
        self.al_L_E_all_b29_on_base = False
        self.al_L_F_controls_hex_within_8_tokyo = False
        self.al_L_G_meets_atomic_bomb_criteria = False
        self.al_FO_active = False
        self.al_has_unrestricted_mil_event = False
        self.al_has_restricted_mil_event = False
        self.al_first_card = False

        # ---- 任务部队编成 / 反应共用 ----
        self.tf = TaskForceConditions()
        self.rx = ReactionConditions()

    def phase_for_turn(self) -> str:
        """按回合推导决策轴阶段(早期/中期/终局),与 JS select_chart 一致。"""
        if self.current_turn >= 10:
            return "end"
        if self.current_turn >= 5:
            return "middle"
        return "early"


class TaskForceConditions:
    """任务部队编成需要知道的局面条件(第5/11页)。"""

    def __init__(self):
        self.air_naval_strike = False        # A: 目标仅是压制/打击(空海)
        self.coastal_island = True           # B: 目标是沿海/岛屿(可登陆)
        self.can_ground_advance = False      # C: 地面可推进到位
        self.hex_empty = False               # D: 目标格为空
        self.only_naval = False              # E: 目标仅有敌方海上单位
        self.enter_exit = False              # F: 地面可进入后离开(避免战斗)
        self.target_is_sr = False            # G: 目标是战略资源/补给要点
        self.enemy_air_can_react = True      # H: 敌方有空中单位可反应
        self.enemy_naval_ground_can_react = False  # K: 敌方海/地单位可反应
        self.enough_support = True           # I: 有足够激活/支援点数
        self.damage_level_met = True         # J: 能达成所需伤害等级
        self.is_ec = True                    # L: 本攻势为 EC(事件)攻势
        self.enemy_in_hex = False            # 目标格有敌人(与 hex_empty 互补)


class ReactionConditions:
    """反应窗口需要的局面信息(第6/12页)。"""

    def __init__(self):
        self.window = "none"                 # none/intel/battle/pbm/weather/isr/nuke/counter
        self.have_weather_card = False
        self.have_intel_card = False         # 如 JN-25 / 情报
        self.have_carrier_in_range = False
        self.have_air_in_range = False
        self.enemy_stronger = False
        self.is_final_turn = False
        self.pbm_units_available = False     # 是否有需要 PBM 的获胜单位


# ---------------------------------------------------------------------------
# 决策基础工具：日志式条件记录 + 确定性随机数
# ---------------------------------------------------------------------------
class Branch:
    """把条件求值写入 trace,返回 bool。"""

    def __init__(self, conditions: List[Dict]):
        self._conditions = conditions

    def __call__(self, predicate: str, value: bool) -> bool:
        self._conditions.append({"predicate": predicate, "value": bool(value)})
        return bool(value)


def pick_hint_for(strategy_id: str) -> str:
    """按战略代码映射到引擎语义动作建议。"""
    if strategy_id in ("JP_PASS", "AP_PASS"):
        return "pass"
    if strategy_id in ("JP_EVENT", "AP_EVENT", "EVENT_STRATEGY"):
        return "play_event"
    if "OC" in strategy_id:
        return "play_ops"
    if strategy_id == "FUTURE_OFFENSIVE":
        return "play_foq"
    if strategy_id.startswith("TF_"):
        return {
            "TF_AIR_STRIKE": "air_naval_strike",
            "TF_AIR_SUPPORT_GROUND": "air_support_ground",
            "TF_GROUND_ADVANCE": "ground_advance",
            "TF_AIR_SEA_GROUND": "air_sea_ground",
            "TF_SEA_SUPPORT_LANDING": "sea_support_landing",
            "TF_AIR_SEA_LANDING": "air_sea_landing",
            "TF_UNSUPPORTED_LANDING": "unsupported_landing",
        }[strategy_id]
    if strategy_id.startswith("RX_"):
        return {
            "RX_WEATHER": "air_reaction",
            "RX_INTEL": "intel_reaction",
            "RX_COUNTERATTACK": "counterattack_reaction",
            "RX_NAVAL": "naval_reaction",
            "RX_AIR": "air_reaction",
            "RX_REINFORCE": "reinforce_reaction",
            "RX_PBM": "pbm",
            "RX_NONE": "pass",
        }[strategy_id]
    # 其余决策轴战略: 下一步通常是选牌/打牌,由引擎按合法动作展开
    return "play_ops" if strategy_id.startswith("JP_EARLY_AGGRESSIVE") else "play_event"


# ===========================================================================
# 一、决策轴状态机（日本 / 盟军 × 早/中/终）
# ===========================================================================
class JapaneseDecisionTree:
    """日本决策轴（图页 1/2/3）。每个 evaluate_* 都走同一套确定性分支。"""

    def __init__(self, ctx: ErasmusContext, rng: random.Random, conditions: List[Dict]):
        self.ctx = ctx
        self.rng = rng
        self.cond = conditions
        self.br = Branch(conditions)

    def evaluate_early(self) -> Decision:
        chart, page = JP_CHART[("early", "decision-axis")]
        self.br("JP_HQ_OOS", self.ctx.jp_A_allied_hq_oos_in_phil_dei_mal)
        if self.ctx.jp_A_allied_hq_oos_in_phil_dei_mal:
            self.br("JP_HAND_GE_3", self.ctx.cards_in_hand >= 3)
            if self.ctx.cards_in_hand >= 3:
                self.br("JP_RESOURCES_LTE_13", self.ctx.jp_D_res_lt_13)
                if self.ctx.jp_D_res_lt_13:
                    return self._result("激进的空优战略", chart, page,
                                        "A∧C∧D: HQ断补+手牌足+资源不足,空优压制东印度。")
                # E: 资源 >=13
                self.br("TURN_GE_3", self.ctx.current_turn >= 3)
                if self.ctx.current_turn >= 3:
                    self.br("JP_LOGISTICS_GTE_20", self.ctx.jp_F_logistics_ge_20)
                    if self.ctx.jp_F_logistics_ge_20:
                        return self._result("中太平洋战略", chart, page,
                                            "A∧C∧¬D∧F: 后勤充裕,转入中太平洋攻势。")
                    self.br("JP_LOWLOG_OR_AZOI_AND_RABAUL",
                            (self.ctx.jp_H_logistics_le_19 or self.ctx.jp_I_azoi_covers_dei_ports)
                            and self.ctx.jp_J_controls_rabaul_guadalcanal)
                    if (self.ctx.jp_H_logistics_le_19 or self.ctx.jp_I_azoi_covers_dei_ports) \
                            and self.ctx.jp_J_controls_rabaul_guadalcanal:
                        return self._result("中太平洋战略", chart, page,
                                            "A∧C∧¬D∧F¬∧(H∨I)∧J: 已握外圈据点,继续中太平洋。")
                    self.br("JP_PERIMETER_TARGET_1", self.ctx.jp_M_perimeter_target_1_complete)
                    if self.ctx.jp_M_perimeter_target_1_complete:
                        return self._result("马绍尔防御", chart, page,
                                            "A∧C∧¬D∧…∧M: 外圈目标1完成,固守马绍尔。")
                    return self._result("外围防御战略", chart, page,
                                        "A∧C∧¬D∧早期: 转外围防御。")
                return self._result("外围防御战略", chart, page,
                                    "A∧C∧¬D∧¬G(第3回合前): 先守外圈。")
            return self._result("激进的南方资源战略", chart, page,
                                "A∧¬C: HQ断补而手牌不足,仍激进南取资源。")
        self.br("JP_DEI_SURRENDER_DONE", self.ctx.jp_B_dei_surrender_hexes_occupied)
        if self.ctx.jp_B_dei_surrender_hexes_occupied:
            return self._result("保守的空优战略", chart, page,
                                "¬A∧B: DEI投降完成,空优保守压制。")
        self.br("JP_HAND_GE_3_AND_NOT_CONQUERED",
                self.ctx.cards_in_hand >= 3 and self.ctx.jp_L_mal_phil_dei_not_conquered)
        if self.ctx.cards_in_hand >= 3 and self.ctx.jp_L_mal_phil_dei_not_conquered:
            roll = self.rng.randrange(0, 10)          # 1d10, 0-9
            dice = {"id": "JP_EARLY_D10", "sides": 10, "result": roll}
            self.cond.append({"predicate": "JP_D10_ROLL", "value": roll})
            if roll <= 2:
                return self._result("事件战略", chart, page,
                                    f"¬A∧¬B∧C∧L∧d10={roll}(0-2): 事件。", dice=dice)
            if roll <= 6:
                return self._result("激进的南方资源战略", chart, page,
                                    f"¬A∧¬B∧C∧L∧d10={roll}(3-6): 激进南取。", dice=dice)
            return self._result("外围防御战略", chart, page,
                                f"¬A∧¬B∧C∧L∧d10={roll}(7-9): 外围防御。", dice=dice)
        return self._result("事件战略", chart, page, "¬A∧¬B∧¬(C∧L): 事件。")

    def evaluate_mid(self) -> Decision:
        chart, page = JP_CHART[("middle", "decision-axis")]
        if self.ctx.cards_in_hand < 3:
            self.br("JP_CAN_PASS", self.ctx.can_pass)
            if self.ctx.can_pass:
                return self._result("PASS", chart, page, "手牌不足且可PASS。")
            return self._result("事件战略", chart, page, "手牌不足,事件。")
        self.br("JP_RESOURCES_LTE_13", self.ctx.jp_D_res_lt_13)
        if self.ctx.jp_D_res_lt_13:
            return self._result("资源战略", chart, page, "资源<13,补资源。")
        self.br("JP_LOGISTICS_GTE_20", self.ctx.jp_F_logistics_ge_20)
        if self.ctx.jp_F_logistics_ge_20:
            self.br("JP_US_WILL_LTE_4", self.ctx.jp_E_us_will_lt_4)
            if self.ctx.jp_E_us_will_lt_4:
                return self._result("中太平洋战略", chart, page, "后勤足+美意志弱,中太平洋。")
            self.br("JP_BURMA_SURRENDERED", self.ctx.jp_F_burma_surrendered)
            if self.ctx.jp_F_burma_surrendered:
                self.br("JP_INDIA_OPEN", (self.ctx.jp_H_has_gandhi or self.ctx.jp_I_more_steps_in_burma)
                        and self.ctx.jp_J_logistics_ge_18)
                if (self.ctx.jp_H_has_gandhi or self.ctx.jp_I_more_steps_in_burma) \
                        and self.ctx.jp_J_logistics_ge_18:
                    return self._result("印度战略", chart, page, "后勤足+缅甸降+印度打开。")
                return self._result("外围防御战略", chart, page, "后勤足+缅甸降,转外围。")
            return self._result("中缅印战略", chart, page, "后勤足+缅甸未降,CBI。")
        self.br("JP_LOGISTICS_GTE_15", self.ctx.jp_G_logistics_ge_15)
        if self.ctx.jp_G_logistics_ge_15:
            self.br("JP_BURMA_SURRENDERED_MID", self.ctx.jp_F_burma_surrendered)
            if self.ctx.jp_F_burma_surrendered:
                if (self.ctx.jp_H_has_gandhi or self.ctx.jp_I_more_steps_in_burma) \
                        and self.ctx.jp_J_logistics_ge_18:
                    return self._result("印度战略", chart, page, "后勤>=15+缅甸降+印度打开。")
                return self._result("外围防御战略", chart, page, "后勤>=15+缅甸降,外围。")
            return self._result("中缅印战略", chart, page, "后勤>=15+缅甸未降,CBI。")
        return self._result("外围防御战略", chart, page, "资源足但后勤低,外围防御。")

    def evaluate_late(self) -> Decision:
        chart, page = JP_CHART[("end", "decision-axis")]
        if self.ctx.cards_in_hand < 3:
            return self._result("事件战略", chart, page, "终局手牌不足,事件。")
        self.br("JP_GARRISON_AND_AIRFIELD",
                self.ctx.jp_L_B_garrisons_within_8_of_tokyo
                and self.ctx.jp_L_C_airfields_within_5_of_tokyo)
        if self.ctx.jp_L_B_garrisons_within_8_of_tokyo and self.ctx.jp_L_C_airfields_within_5_of_tokyo:
            return self._result("最终国防圈战略", chart, page, "东京8格驻军+5格机场就绪,固守国防圈。")
        self.br("JP_CAN_PASS", self.ctx.can_pass)
        if self.ctx.can_pass:
            return self._result("PASS", chart, page, "终局可PASS。")
        self.br("JP_ALLIED_ON_HONSHU", self.ctx.jp_L_E_allied_on_honshu)
        if self.ctx.jp_L_E_allied_on_honshu:
            return self._result("最终防御战略", chart, page, "盟军登上本州,最终防御。")
        return self._result("事件战略", chart, page, "终局其余情形,事件。")

    def _result(self, key: str, chart: str, page: int, reason: str,
                dice: Optional[Dict] = None) -> Decision:
        strategy = JP_LATE_STRATEGIES.get(key) or JP_MID_STRATEGIES.get(key) \
            or JP_EARLY_STRATEGIES.get(key)
        assert strategy is not None, f"未定义的日本战略: {key}"
        return Decision(strategy=strategy, action_hint=pick_hint_for(strategy.id),
                        chart=chart, source_page=page, conditions=list(self.cond),
                        dice=dice, confidence="inferred", reason=reason)


class AlliedDecisionTree:
    """盟军决策轴（图页 7/8/9）。"""

    def __init__(self, ctx: ErasmusContext, rng: random.Random, conditions: List[Dict]):
        self.ctx = ctx
        self.rng = rng
        self.cond = conditions
        self.br = Branch(conditions)

    def evaluate_early(self) -> Decision:
        chart, page = AP_CHART[("early", "decision-axis")]
        if self.ctx.cards_in_hand < 3:
            return self._result("事件战略", chart, page, "手牌不足,事件。")
        self.br("AP_PHIL_HQ_SUPPLY", self.ctx.al_B_hq_supplied_phil)
        if not self.ctx.al_B_hq_supplied_phil:
            return self._result("撤离菲律宾", chart, page, "菲律宾HQ断补,撤离菲军。")
        self.br("AP_MALAYA_HQ_SUPPLY", self.ctx.al_C_hq_supplied_malaya)
        if not self.ctx.al_C_hq_supplied_malaya:
            return self._result("撤离马来亚", chart, page, "马来亚HQ断补,撤离马来亚。")
        if not self.ctx.al_D_arcadia_played:
            return self._result("建立ABDA", chart, page, "阿卡迪亚未打,建立ABDA。")
        if not self.ctx.al_E_cbi_def_established:
            return self._result("增强CBI防御", chart, page, "CBI防线未建,先增防。")
        self.br("AP_PASS_AND_LAST_CARD", self.ctx.al_F_has_passes and self.ctx.al_G_only_1_card_left)
        if self.ctx.al_F_has_passes and self.ctx.al_G_only_1_card_left:
            return self._result("PASS", chart, page, "已PASS且只剩1张,停。")
        self.br("AP_ORANGE_OPEN",
                self.ctx.al_J_phil_not_surrendered and self.ctx.al_K_service_agreement
                and self.ctx.al_L_has_2_carriers and self.ctx.al_M_us_corps_near_carrier
                and self.ctx.al_N_aus_no_jp_ground)
        if (self.ctx.al_J_phil_not_surrendered and self.ctx.al_K_service_agreement
                and self.ctx.al_L_has_2_carriers and self.ctx.al_M_us_corps_near_carrier
                and self.ctx.al_N_aus_no_jp_ground):
            return self._result("橙色计划", chart, page, "条件齐备,实施橙色护航计划。")
        self.br("AP_DEI_OPEN", self.ctx.al_O_dei_not_surrendered and self.ctx.al_P_abda_hq_supplied)
        if self.ctx.al_O_dei_not_surrendered and self.ctx.al_P_abda_hq_supplied:
            return self._result("DEI防御", chart, page, "DEI未降且ABDA在补给,守DEI。")
        return self._result("攻势进攻", chart, page, "其余情形:以攻势推进。")

    def evaluate_mid(self) -> Decision:
        chart, page = AP_CHART[("middle", "decision-axis")]
        self.br("AP_CAN_PASS", self.ctx.can_pass)
        if self.ctx.can_pass:
            return self._result("PASS", chart, page, "可PASS。")
        self.br("AP_NEEDS_PROGRESS_AND_OPEN",
                self.ctx.al_M_B_needs_war_progress and self.ctx.cards_in_hand >= 3
                and self.ctx.al_M_D_jp_controls_counterattack_target)
        if self.ctx.al_M_B_needs_war_progress and self.ctx.cards_in_hand >= 3 \
                and self.ctx.al_M_D_jp_controls_counterattack_target:
            return self._result("反攻战略", chart, page, "需推进且反攻目标被日控,反攻。")
        if self.ctx.cards_in_hand < 3:
            return self._result("事件战略", chart, page, "手牌不足,事件。")
        roll = self.rng.randrange(0, 10)
        dice = {"id": "AP_MID_D10", "sides": 10, "result": roll}
        self.cond.append({"predicate": "AP_MID_D10_ROLL", "value": roll})
        if roll <= 4:
            return self._result("南太平洋战略", chart, page, f"d10={roll}(0-4):南太平洋。", dice=dice)
        if roll <= 7:
            return self._result("中太平洋战略", chart, page, f"d10={roll}(5-7):中太平洋。", dice=dice)
        if roll == 8:
            return self._result("DEI战略", chart, page, f"d10={roll}(8):DEI。", dice=dice)
        return self._result("CBI战略", chart, page, f"d10={roll}(9):CBI。", dice=dice)

    def evaluate_late(self) -> Decision:
        chart, page = AP_CHART[("end", "decision-axis")]
        self.br("AP_CAN_PASS", self.ctx.can_pass)
        if self.ctx.can_pass:
            return self._result("PASS", chart, page, "可PASS。")
        self.br("AP_TURN12_AND_LOW_HAND", self.ctx.al_L_B_is_turn_12 and self.ctx.cards_in_hand < 3)
        if self.ctx.al_L_B_is_turn_12 and self.ctx.cards_in_hand < 3:
            return self._result("事件战略", chart, page, "第12回合手牌不足,事件。")
        if not self.ctx.al_L_D_has_strategic_bombing_base:
            return self._result("占领轰炸基地", chart, page, "无战略轰炸基地,先占。")
        if not self.ctx.al_L_E_all_b29_on_base:
            return self._result("推进B29", chart, page, "B29未全部上基地,推进。")
        if not self.ctx.al_L_F_controls_hex_within_8_tokyo:
            roll = self.rng.randrange(0, 10)
            dice = {"id": "AP_LATE_D10", "sides": 10, "result": roll}
            self.cond.append({"predicate": "AP_LATE_D10_ROLL", "value": roll})
            if roll <= 2:
                return self._result("重返菲律宾", chart, page,
                                    f"d10={roll}(0-2):重返菲律宾。", dice=dice)
            if roll <= 5:
                return self._result("跳岛作战", chart, page, f"d10={roll}(3-5):跳岛。", dice=dice)
            return self._result("轮流战略", chart, page, f"d10={roll}(6-9):轮流反跳。", dice=dice)
        if self.ctx.al_L_G_meets_atomic_bomb_criteria:
            return self._result("原子弹胜利", chart, page, "原子弹条件满足,走原子弹胜利。")
        return self._result("登陆日本", chart, page, "已到东京8格内,登陆日本。")

    def _result(self, key: str, chart: str, page: int, reason: str,
                dice: Optional[Dict] = None) -> Decision:
        strategy = AL_LATE_STRATEGIES.get(key) or AL_MID_STRATEGIES.get(key) \
            or AL_EARLY_STRATEGIES.get(key)
        assert strategy is not None, f"未定义的盟军战略: {key}"
        return Decision(strategy=strategy, action_hint=pick_hint_for(strategy.id),
                        chart=chart, source_page=page, conditions=list(self.cond),
                        dice=dice, confidence="inferred", reason=reason)


# ===========================================================================
# 二、选牌状态机（图页 4 / 10）
# ---------------------------------------------------------------------------
# 以“手牌构成 + 是否本回合已打牌/未来攻势”驱动,分支标签沿用第 4 页条件字母。
# 拓扑未视觉校对,出口固定为 CARD_STRATEGIES 中的 8 类之一。
# ===========================================================================
class CardSelectionMachine:
    def __init__(self, ctx: ErasmusContext, rng: random.Random, conditions: List[Dict]):
        self.ctx = ctx
        self.rng = rng
        self.cond = conditions
        self.br = Branch(conditions)

    def evaluate(self, role: str, phase: str) -> Decision:
        is_jp = role == "Japan"
        chart, page = JP_CHART[("all", "card-selection")] if is_jp \
            else AP_CHART[("all", "card-selection")]
        ctx = self.ctx

        # A: 本攻势阶段已出过牌?
        self.br("OFFENSIVE_PLAYED", ctx.played_this_offensive)
        # 已经出过牌(第二轮及以后)且没有可行动事件 → 放未来攻势/随机
        if ctx.played_this_offensive and ctx.cards_in_hand <= 1:
            return self._card(CARD_STRATEGIES["未来攻势"], chart, page,
                              "本回合已行动且手牌只剩1张:放入未来攻势。")
        if not is_jp and ctx.al_FO_active:
            return self._card(CARD_STRATEGIES["未来攻势"], chart, page,
                              "盟军未来攻势已激活,先出未来攻势牌。")
        if is_jp and ctx.jp_fo_this_turn:
            return self._card(CARD_STRATEGIES["未来攻势"], chart, page,
                              "本回合已选FO牌,继续按攻势处理。")
        # 先发打击(伊号/第二阶段)
        if is_jp and ctx.jp_has_fo_card and not ctx.played_this_offensive:
            return self._card(CARD_STRATEGIES["先发打击 EC"], chart, page,
                              "手牌含先发打击军事牌且为第一动。")
        # EC: 无限制军事事件
        if is_jp and ctx.jp_has_unrestricted_mil_event:
            return self._card(CARD_STRATEGIES["无限制事件 EC"], chart, page,
                              "有可执行的有限制军事事件,按EC打。")
        # EC: 有限制军事事件
        if is_jp and ctx.jp_has_restricted_mil_event and not ctx.jp_all_events_limited:
            return self._card(CARD_STRATEGIES["有限制事件 EC"], chart, page,
                              "有可执行军事事件但受限制,退化为有限制EC。")
        # OC 方向(无事件可打或盟军)
        if not is_jp and ctx.al_has_unrestricted_mil_event:
            return self._card(CARD_STRATEGIES["无军事事件 OC"], chart, page,
                              "盟军:以OC值行动。")
        return self._card(CARD_STRATEGIES["事件战略"], chart, page,
                          "默认按事件顺序处理,动作交由引擎按合法动作展开。")

    def _card(self, strategy: StrategyDetails, chart: str, page: int, reason: str) -> Decision:
        return Decision(strategy=strategy, action_hint=pick_hint_for(strategy.id),
                        chart=chart, source_page=page, conditions=list(self.cond),
                        dice=None, confidence="inferred", reason=reason)


# ===========================================================================
# 三、任务部队编成状态机（图页 5 / 11）
# ---------------------------------------------------------------------------
# 按第 5/11 页条件链生成“编成类型”,供引擎翻译成具体单位激活序列。
# ===========================================================================
class TaskForceMachine:
    def __init__(self, ctx: ErasmusContext, rng: random.Random, conditions: List[Dict]):
        self.ctx = ctx
        self.rng = rng
        self.cond = conditions
        self.br = Branch(conditions)
        self.tf = ctx.tf

    def evaluate(self, role: str, phase: str) -> Decision:
        is_jp = role == "Japan"
        chart, page = JP_CHART[("all", "task-force")] if is_jp \
            else AP_CHART[("all", "task-force")]
        tf = self.tf

        self.br("TF_AIR_NAVAL_STRIKE", tf.air_naval_strike)
        if tf.air_naval_strike:
            return self._tf("航空打击", chart, page, "目标仅为压制敌方AZOI空/海。")

        self.br("TF_COASTAL_ISLAND", tf.coastal_island)
        if not tf.coastal_island:
            self.br("TF_HEX_EMPTY", tf.hex_empty)
            if not tf.hex_empty:
                return self._tf("带航空支援的地面攻击", chart, page,
                                "非沿海/岛屿且目标有敌:地面攻击+航空支援。")
            return self._tf("向目标进军", chart, page, "非沿海且目标空:直接进军。")

        # 沿海/岛屿
        self.br("TF_GROUND_ADVANCE", tf.can_ground_advance)
        if tf.can_ground_advance:
            self.br("TF_ENTER_EXIT", tf.hex_empty or (tf.only_naval and tf.enter_exit))
            if tf.hex_empty or (tf.only_naval and tf.enter_exit):
                return self._tf("向目标进军", chart, page,
                                "地面可推进且(空/仅海可进离):进军。")
            return self._tf("带航空/海上支援的地面攻击", chart, page,
                            "地面可推进但有敌:强攻。")
        # 无法地面推进 → 登陆/打击
        if tf.hex_empty:
            if tf.target_is_sr:
                self.br("TF_ENEMY_AIR_REACT", tf.enemy_air_can_react)
                if tf.enemy_air_can_react:
                    return self._tf("带航空/海上支援的登陆", chart, page,
                                    "空目标但敌可反应:重装登陆。")
                return self._tf("带海上支援的登陆", chart, page,
                                "空目标且敌无空中反应:海支援登陆。")
            return self._tf("无支援登陆", chart, page, "空目标且非SR要点:轻装登陆。")
        # 目标有敌 → 判断支援/伤害是否足够
        self.br("TF_ENOUGH_SUPPORT", tf.enough_support)
        self.br("TF_DAMAGE_MET", tf.damage_level_met)
        if tf.enough_support and tf.damage_level_met:
            return self._tf("带航空/海上支援的登陆", chart, page,
                            "目标有敌且支援/伤害足够:强登陆。")
        return self._tf("带海上支援的登陆", chart, page,
                        "目标有敌但支援受限:改用海上支援登陆/试探。")

    def _tf(self, key: str, chart: str, page: int, reason: str) -> Decision:
        strategy = TF_FORMATIONS[key]
        return Decision(strategy=strategy, action_hint=pick_hint_for(strategy.id),
                        chart=chart, source_page=page, conditions=list(self.cond),
                        dice=None, confidence="inferred", reason=reason)


# ===========================================================================
# 四、反应状态机（图页 6 / 12）
# ===========================================================================
class ReactionMachine:
    def __init__(self, ctx: ErasmusContext, rng: random.Random, conditions: List[Dict]):
        self.ctx = ctx
        self.rng = rng
        self.cond = conditions
        self.br = Branch(conditions)
        self.rx = ctx.rx

    def evaluate(self, role: str, phase: str) -> Decision:
        is_jp = role == "Japan"
        chart, page = JP_CHART[("all", "reaction")] if is_jp \
            else AP_CHART[("all", "reaction")]
        rx = self.rx

        self.br("RX_WINDOW", rx.window != "none")
        if rx.window == "weather" and rx.have_weather_card:
            return self._rx("天气反应", chart, page, "敌方攻势/天气窗口且有天气反应牌。")
        if rx.window == "intel" and rx.have_intel_card:
            return self._rx("情报反应", chart, page, "情报窗口且有JN-25。")
        if rx.window in ("battle", "counter") and not rx.enemy_stronger \
                and (rx.have_carrier_in_range or rx.have_air_in_range):
            return self._rx("反攻反应", chart, page, "战斗窗口可反击且不劣。")
        if rx.window in ("battle", "pbm") and rx.pbm_units_available:
            return self._rx("战后移动", chart, page, "战斗后移动(PBM)。")
        if rx.have_carrier_in_range or rx.have_air_in_range:
            return self._rx("海上反应", chart, page, "有海/空单位在范围:海上/航空反应。")
        return self._rx("不反应", chart, page, "无有效反应资源。")

    def _rx(self, key: str, chart: str, page: int, reason: str) -> Decision:
        strategy = REACTION_STRATEGIES[key]
        return Decision(strategy=strategy, action_hint=pick_hint_for(strategy.id),
                        chart=chart, source_page=page, conditions=list(self.cond),
                        dice=None, confidence="inferred", reason=reason)


# ===========================================================================
# 五、总装：窗口分类 + 选择对应状态机（与 JS select_chart 同一分类口径）
# ===========================================================================
class ErasmusCompleteAI:
    """完整状态机 AI 门面。

    decide(role, ctx, window=None, prompt="")：
      - window 缺省时按 prompt/ctx 分类:
        card-selection / task-force / reaction / decision-axis(默认)。
      - 返回 Decision(as_dict) + 便于引擎执行的语义动作建议。
    所有路径共享同一个 seeds → 同 seed 输出完全一致(可回放)。
    """

    def __init__(self, seed: int = 424242):
        self.seed = seed

    def classify_window(self, ctx: ErasmusContext, prompt: str = "") -> str:
        p = (prompt or "").lower()
        if any(k in p for k in ("card", "play", "出牌", "选牌", "事件", "行动")):
            return "card-selection"
        if any(k in p for k in ("react", "intell", "反应", "情报", "pbm", "拦截")):
            return "reaction"
        if any(k in p for k in ("unit", "hex", "offensiv", "编成", "部队", "目标", "进攻")):
            return "task-force"
        return "decision-axis"

    def decide(self, role: str, ctx: ErasmusContext,
               window: Optional[str] = None, prompt: str = "") -> Dict:
        if role not in ("Japan", "Allies"):
            raise ValueError(f"unknown role: {role}")
        phase = ctx.phase_for_turn()
        window = window or self.classify_window(ctx, prompt)
        rng = random.Random(self.seed)
        conditions: List[Dict] = []

        if window == "card-selection":
            decision = CardSelectionMachine(ctx, rng, conditions).evaluate(role, phase)
        elif window == "task-force":
            decision = TaskForceMachine(ctx, rng, conditions).evaluate(role, phase)
        elif window == "reaction":
            decision = ReactionMachine(ctx, rng, conditions).evaluate(role, phase)
        else:  # decision-axis: 与 phase_for_turn() 同一阶段口径(决策轴图分早/中/终)
            tree = JapaneseDecisionTree(ctx, rng, conditions) if role == "Japan" \
                else AlliedDecisionTree(ctx, rng, conditions)
            if role == "Japan":
                decision = {"early": tree.evaluate_early,
                            "middle": tree.evaluate_mid,
                            "end": tree.evaluate_late}[phase]()
            else:
                decision = {"early": tree.evaluate_early,
                            "middle": tree.evaluate_mid,
                            "end": tree.evaluate_late}[phase]()

        out = decision.as_dict()
        out["role"] = role
        out["phase"] = phase
        out["window"] = window
        out["seed"] = self.seed
        return out


# ===========================================================================
# 驱动器 + 自测
# ===========================================================================
def run_ai_complete_mockup(seed: int = 424242) -> None:
    print("Erasmus Complete AI State Machine（Python 参考实现）\n")
    ai = ErasmusCompleteAI(seed)

    scenarios = build_scenarios()
    for label, role, ctx, window, prompt in scenarios:
        result = ai.decide(role, ctx, window=window, prompt=prompt)
        print(f"\n--- [{label}] {role} / {result['window']} "
              f"(turn {ctx.current_turn}) ---")
        print(f"  策略: {result['strategy_zh']}  <{result['strategy']}>")
        print(f"  动作建议: {result['action_hint']}")
        print(f"  图表: {result['chart']} p.{result['source_page']} 置信:{result['confidence']}")
        if result["conditions"]:
            path = " → ".join(f"{c['predicate']}={c['value']}" for c in result["conditions"])
            print(f"  条件: {path}")
        if result["dice"]:
            d = result["dice"]
            print(f"  掷骰: {d['id']} = {d['result']} (1d{d['sides']})")
        print(f"  理由: {result['reason']}")


def build_scenarios():
    """代表性上下文集合,覆盖日/盟 × 早/中/终 × 各窗口。"""
    out = []
    # 日本早期-决策轴(HQ断补+资源足+后勤足)
    c = ErasmusContext()
    c.jp_A_allied_hq_oos_in_phil_dei_mal = True
    c.jp_D_res_lt_13 = False
    c.jp_F_logistics_ge_20 = True
    c.current_turn = 4
    out.append(("JP-early-axis-strong", "Japan", c, "decision-axis", ""))

    # 日本中期-决策轴(资源不足)
    c = ErasmusContext()
    c.current_turn = 6
    c.jp_D_res_lt_13 = True
    out.append(("JP-mid-axis-res<13", "Japan", c, None, "Select strategy"))

    # 日本终局-决策轴(盟军已登本州)
    c = ErasmusContext()
    c.current_turn = 11
    c.cards_in_hand = 5
    c.jp_L_E_allied_on_honshu = True
    out.append(("JP-end-axis-honshu", "Japan", c, None, "Select strategy"))

    # 盟军早期-决策轴(菲律宾断补)
    c = ErasmusContext()
    c.current_turn = 1
    c.cards_in_hand = 5
    c.al_B_hq_supplied_phil = False
    out.append(("AP-early-axis-evac-phil", "Allies", c, None, "Select strategy"))

    # 盟军中期-决策轴(反攻)
    c = ErasmusContext()
    c.current_turn = 6
    c.cards_in_hand = 4
    out.append(("AP-mid-axis", "Allies", c, None, "Select strategy"))

    # 盟军终局-决策轴(登陆日本)
    c = ErasmusContext()
    c.current_turn = 12
    c.cards_in_hand = 5
    c.al_L_D_has_strategic_bombing_base = True
    c.al_L_E_all_b29_on_base = True
    c.al_L_F_controls_hex_within_8_tokyo = True
    out.append(("AP-end-axis-invade", "Allies", c, None, "Select strategy"))

    # 选牌:日本先发打击
    c = ErasmusContext()
    c.jp_has_fo_card = True
    out.append(("JP-card-preemptive", "Japan", c, "card-selection", "Select card to play."))

    # 选牌:盟军默认
    c = ErasmusContext()
    c.al_has_unrestricted_mil_event = True
    out.append(("AP-card-oc", "Allies", c, "card-selection", "Select card to play."))

    # 任务部队:日本重装登陆
    c = ErasmusContext()
    c.tf.hex_empty = False
    c.tf.can_ground_advance = False
    c.tf.enough_support = True
    c.tf.damage_level_met = True
    out.append(("JP-tf-landing", "Japan", c, "task-force", "Select units for offensive."))

    # 反应:盟军情报反应
    c = ErasmusContext()
    c.rx.window = "intel"
    c.rx.have_intel_card = True
    out.append(("AP-rx-intel", "Allies", c, "reaction", "Reaction?"))
    return out


def self_test(seed: int = 424242) -> None:
    """确定性 + 全库引用完整性 + 覆盖性自测。"""
    errors: List[str] = []

    def check(ok: bool, msg: str) -> None:
        if not ok:
            errors.append(msg)

    # 1) 引用完整性:每本库都能找到 & id 唯一
    libraries = {
        "JP_EARLY": JP_EARLY_STRATEGIES, "JP_MID": JP_MID_STRATEGIES,
        "JP_LATE": JP_LATE_STRATEGIES, "AL_EARLY": AL_EARLY_STRATEGIES,
        "AL_MID": AL_MID_STRATEGIES, "AL_LATE": AL_LATE_STRATEGIES,
    }
    for lib_name, lib in libraries.items():
        ids = [s.id for s in lib.values()]
        check(len(ids) == len(set(ids)), f"{lib_name}: strategy id 重复")
        for key, s in lib.items():
            check(s.name != "", f"{lib_name}[{key}]: 无名称")
            check(s.source_page > 0, f"{lib_name}[{key}]: 缺 source_page")

    # 2) 每类窗口跑一整套(决定不抛异常且返回完整 trace)
    ai = ErasmusCompleteAI(seed)
    for label, role, ctx, window, prompt in build_scenarios():
        try:
            d = ai.decide(role, ctx, window=window, prompt=prompt)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{label}: 抛异常 {exc!r}")
            continue
        for field in ("strategy", "action_hint", "chart", "source_page",
                      "conditions", "confidence", "reason", "role", "phase", "window"):
            check(field in d, f"{label}: trace 缺字段 {field}")
        check(isinstance(d["source_page"], int) and d["source_page"] > 0,
              f"{label}: source_page 非法")

    # 3) 确定性:同 seed 复现
    a1 = ai.decide("Japan", ErasmusContext(), window="decision-axis")
    a2 = ai.decide("Japan", ErasmusContext(), window="decision-axis")
    check(a1 == a2, "同 seed 决策轴不可复现")
    b1 = ai.decide("Allies", ErasmusContext(), window="decision-axis")
    b2 = ai.decide("Allies", ErasmusContext(), window="decision-axis")
    check(b1 == b2, "同 seed 盟军决策不可复现")

    # 4) 关键分支期望(锁定草稿决策语义,防误改)
    def branch_ctx(**kw):
        c = ErasmusContext()
        for k, v in kw.items():
            setattr(c, k, v)
        return c

    expectations = [
        # 日本早期 激进空优: A∧C∧D
        ("JP early aggressive-air", ai.decide("Japan", branch_ctx(
            jp_A_allied_hq_oos_in_phil_dei_mal=True, jp_D_res_lt_13=True),
            window="decision-axis"), "JP_EARLY_AGGRESSIVE_AIR"),
        # 日本中期资源: res<13 (需进入中期决策轴图, current_turn>=5)
        ("JP mid resource", ai.decide("Japan", branch_ctx(
            current_turn=6, jp_D_res_lt_13=True), window="decision-axis"), "JP_RESOURCE"),
        # 盟军早期撤离菲律宾
        ("AP early evac phil", ai.decide("Allies", branch_ctx(
            al_B_hq_supplied_phil=False), window="decision-axis"), "AP_EVACUATE_PHILIPPINES"),
        # 盟军终局占领轰炸基地 (需进入终局决策轴图, current_turn>=10)
        ("AP late take base", ai.decide("Allies", branch_ctx(
            current_turn=12, al_L_D_has_strategic_bombing_base=False),
            window="decision-axis"), "AP_CAPTURE_STRATEGIC_BASE"),
    ]
    for name, d, expected in expectations:
        check(d["strategy"] == expected, f"{name}: 期望 {expected}, 实得 {d['strategy']}")

    if errors:
        raise AssertionError("\n".join(f"- {e}" for e in errors))
    print(f"SELF-TEST PASSED: {len(build_scenarios())} 个窗口场景 + 确定性/引用/分支断言全部通过。")


if __name__ == "__main__":
    import sys
    if "--self-test" in sys.argv:
        self_test()
    else:
        run_ai_complete_mockup()
