"""
Erasmus Complete AI Execution Engine（Python 参考实现 / 执行引擎补全）

角色：补上状态机参考（erasmus_complete_ai_state_machine.py）没有的一层——
     「执行引擎」：把决策轴选出的战略（StrategyDetails，含目标优先级清单）
     落实成有序的具体地图目标（真实 hex）+ 逐目标的编成/兵力判定/结算，
     解决"AI 为什么不集中进攻、不打仗、不推进战略目标"的问题。

溯源与置信度约定（遵守 agent.md）
----------------------------------
- 战略目标优先级 / 执行注释（本文件 JP_*/AL_*/CARD_*/TF_* 字典）为用户
  "我录入了目标" 手工转录稿，源头是 docs/rules/normalized/erasmus-v2-zh-charts/charts/*.md。
- 地图 hex 名称/region/旗标来自 js/common/data_map.js 的一次性导出
  data/erasmus/map_names.json（tools/dump_erasmus_map.js 生成）。
  hex 统一用引擎内部索引 idx = (floor(id/100)-10)*29 + id%100（与日志 H#### 同口径）。
- 目标词 → hex 用"规范化子串匹配真实地图名"；数字目标如 2912/3606 是地图 hex id。
- 简化结算（兵力/损耗）是参考级模型，非 EotS 9.0 规则；JS 端复用真实引擎结算。
  本文件被 JS 移植复用的是：目标清单 → 有序 hex 序列 + "当前目标未达成不换目标"的
  操作层算法，以及每类目标的编成/伤损判定逻辑。
- 随机性只能来自显式种子：全文件掷骰走注入的 rng（Random(seed)），默认 SEED。

运行：
    python erasmus_complete_ai_execution_engine.py            # 场景演示
    python erasmus_complete_ai_execution_engine.py --self-test  # 自测
"""

import json
import os
import random
import re
from typing import Dict, List, Optional, Tuple

SEED = 20260903  # 确定性种子（与 headless 验证 seed 同系）

# ---------------------------------------------------------------------------
# 地图注册表（一次性导出，见 tools/dump_erasmus_map.js）
# ---------------------------------------------------------------------------
def idx_of_id(hex_id: int) -> int:
    return (hex_id // 100 - 10) * 29 + hex_id % 100


def id_of_idx(idx: int) -> int:
    return (idx // 29) * 100 + 1000 + idx % 29


def _load_map():
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "erasmus", "map_names.json")
    if not os.path.exists(p):
        return {"hexes": {}, "landHexes": {}}
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


_MAP = _load_map()
HEXES = {int(k): v for k, v in _MAP["hexes"].items()}        # 有名字的格
LAND = {int(k): v for k, v in _MAP["landHexes"].items()}     # 有 region 的格

REGION_HEXES: Dict[str, List[int]] = {}
for _idx, _e in LAND.items():
    REGION_HEXES.setdefault(_e["region"], []).append(_idx)

# 地图文本别名（拼写变体/图内不存在的叫法 → 真实地图名 / 语义）
_ALIASES = {
    "uluthi": "Ulithi", "uluth": "Ulithi", "timor": "Koepang",
    "gili-gili": "Gili Gili", "marcus island": "Marcus",
    "marshalls": "Kwajalein", "saipan/tinian": "Saipan",
    "dutch harbor": "Dutch Harbor", "attukiska": "Attu/Kiska",
    "sasebo": "Kynshu",  # 佐世保≈九州本岛(引擎无独立 Sasebo 格)
}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def hex_label(idx: int) -> str:
    e = HEXES.get(idx)
    return e["name"] if e else f"H{idx}({id_of_idx(idx)})"


def region_of(idx: int) -> Optional[str]:
    e = LAND.get(idx)
    return e["region"] if e else None


def name_to_hexes(token: str) -> List[int]:
    """规范化子串匹配地图名；返回匹配的 idx 序列（不含别名未命中时的空结果）。"""
    t = _norm(token)
    if t in _ALIASES:
        t = _norm(_ALIASES[t])
    if not t or len(t) < 3:
        return []
    hits = []
    for idx, e in HEXES.items():
        n = _norm(e["name"])
        if t in n or n in t:
            hits.append(idx)
    return hits


def line_to_hexes(text: str) -> List[int]:
    """把一行目标文本解析成有序 hex idx 序列（按文本出现顺序，去重）。

    顺序 = 目标优先级顺序；先数字 id（如 2912六角格），再子串匹配英文名。
    """
    hexes: List[int] = []
    for m in re.finditer(r"\d{4}", text):
        idx = idx_of_id(int(m.group()))
        if idx not in hexes:
            hexes.append(idx)
    # 用注册表名做子串匹配，按在文本中的首次出现排序，保证优先级顺序
    for m in re.finditer(r"[A-Za-z][A-Za-z\-/\. ]{1,30}[A-Za-z]", text):
        for idx in name_to_hexes(m.group()):
            if idx not in hexes:
                hexes.append(idx)
    return hexes


def get_distance(a: int, b: int) -> int:
    """轴向六边距离（与 js/common/utils.js get_distance 同一口径，纯坐标运算）。"""
    ya, yb = a % 29, b % 29
    xa, xb = (a - ya) // 29, (b - yb) // 29
    rx = abs(xb - xa)
    ry = yb - ya - (rx % 2) * (xa % 2)
    if ry <= (-rx >> 1):
        ry = abs(ry) - rx % 2
    elif ry < rx >> 1:
        c = (rx >> 1) - ry
        ry = (rx >> 1) + ((c + (rx % 2)) >> 1)
        rx -= c
    return rx + ry - (rx >> 1)


def region_has_named(region: str) -> List[int]:
    return sorted(REGION_HEXES.get(region, []))


# 常用区域集合（与 data_map region 名一致）
def named_hexes_of_regions(regions) -> List[int]:
    out = []
    for r in regions:
        out += [i for i in REGION_HEXES.get(r, []) if i in HEXES]
    return sorted(set(out))


class StrategyDetails:
    """
    战略详情数据类。
    封装了PDF中每个战略方块里的所有信息，包括：
    - 战略名称 (Name)
    - 目标优先级列表 (Targets)
    - 执行注释 (Notes)
    - 其他说明 (Instructions, 如HQ限制等)
    """
    def __init__(self, name: str, targets: List[str], notes: List[str], instructions: str = ""):
        self.name = name
        self.targets = targets
        self.notes = notes
        self.instructions = instructions
        
    def __str__(self):
        t_str = "\n    ".join(self.targets) if self.targets else "无特定目标"
        n_str = "\n    ".join(self.notes) if self.notes else "无执行注释"
        return (f"【判定战略】: {self.name}\n"
                f"  [说明]: {self.instructions}\n"
                f"  [目标优先级]:\n    {t_str}\n"
                f"  [执行注释]:\n    {n_str}")

JP_EARLY_NOTES = {
    "1": "[1].激活必须使盟军HQ断补。",
    "2": "[2].登陆的一个地面单位可以在指定目标的损耗中存活下来。",
    "3": "[3].如果卡牌条件允许,按照策略指示使用卡牌。",
    "4": "[4].如有可能,战后移动一个空中单位到目标格,不然移动一个航母过去。",
    "5": "[5].如果欧洲战事为正数,则打出可用的欧战牌,否则按指示投骰。",
    "6": "[6].如果已经控制,则用至少3step的地面单位加固这里,其他情况则忽视该条。",
    "7": "[7].以足够的力量,按伤害等级消灭覆盖目标的敌方AZOI单位的力量进行空中/海上攻击..."
}

JP_EARLY_STRATEGIES = {
    "激进的空优战略": StrategyDetails(
        "激进的空优战略",
        [
            "1. 压制东印度: Jolo [4], Makassar [4], Teloekbetoeng [4], Bandjermasin [4]"
        ],
        [JP_EARLY_NOTES["4"], JP_EARLY_NOTES["7"]]
    ),
    "保守的空优战略": StrategyDetails(
        "保守的空优战略",
        [
            "1. 压制盟军HQ: 菲律宾(0.25x), 新加坡(0.5x), ABDA(0.5x)", 
            "2. 压制东印度: Jolo, Makassar, Teloekbetoeng, Bandjermasin"
        ],
        [JP_EARLY_NOTES["1"]]
    ),
    "激进的南方资源战略": StrategyDetails(
        "激进的南方资源战略",
        [
            "1. 压制盟军HQ: 菲律宾(0.25x), 新加坡(0.5x), ABDA(0.5x)",
            "2. 东印度投降: Balikpapan, Tarakan, Batavia(若无日军则占领), Tjilatjap, Soerabaja, Bangka, Palembang, Medan",
            "3. 马来亚投降: Kuantan关丹, Singapore新加坡",
            "4. 菲律宾投降: Manila马尼拉, Davao达沃",
            "5. Roll 1d10 分配"
        ],
        [JP_EARLY_NOTES["1"]]
    ),
    "保守的南方资源战略": StrategyDetails(
        "保守的南方资源战略",
        [
            "1. 压制东印度: Jolo, Makassar, Teloekbetoeng, Bandjermasin",
            "2. 马来亚投降: Kuantan, Singapore",
            "3. 菲律宾投降: Manila, Davao",
            "4. Roll 1d10 分配"
        ],
        []
    ),
    "中缅印战略": StrategyDetails(
        "中缅印战略 (CBI)",
        [
            "1. 缅甸投降: Rangoon仰光, Mandalay曼德勒, Lashio腊戍, Myitkyina密支那",
            "2. 中国投降: Lashio腊戍, 中国攻势, 中国事件"
        ],
        []
    ),
    "中太平洋战略": StrategyDetails(
        "中太平洋战略",
        [
            "1. 拉包尔 Rabaul (若被盟军控制)", 
            "2. 阿图/吉斯卡 Attu/Kiska [6]", 
            "3. 马绍尔防御: Wake威克岛, Tarawa塔拉瓦", 
            "4. 中途岛 Midway"
        ],
        [JP_EARLY_NOTES["6"]]
    ),
    "马绍尔防御": StrategyDetails(
        "马绍尔防御",
        ["1. Wake威克岛", "2. Tarawa塔拉瓦"],
        [JP_EARLY_NOTES["6"]],
        "补全键(图表第1页 M 出口); evaluate_early 引用它, 早期库原缺此键。"
    ),
    "外围防御战略": StrategyDetails(
        "外围防御战略",
        [
            "1. 澳洲委任统治地: 西北新几内亚(Sarong, Vogelkop, Biak), Guadalcanal瓜岛, Port Moresby莫尔茨比",
            "2. 新几内亚: Hollandia, Lae, Buna, Biak, Vogelkop, Wewak, Gili-Gili, Port Moresby"
        ],
        []
    ),
    "事件战略": StrategyDetails(
        "事件战略",
        [
            "1. 欧战为正打欧战牌,否则FOQ", 
            "2. 结束日本ISR", 
            "3. 造成美国ISR", 
            "4. 东京玫瑰", 
            "5. 补员牌", 
            "6. 天气牌", 
            "7. 东条作为1OC", 
            "8. 其他放牌"
        ],
        [JP_EARLY_NOTES["3"], JP_EARLY_NOTES["5"]]
    )
}

JP_MID_NOTES = {
    "1": "[1].如果卡牌条件允许,按照策略指示使用卡牌。",
    "2": "[2].登陆的一个地面单位可以在指定目标的损耗中存活下来。",
    "3": "[3].占领尽可能多的资源格,直到日本控制至少13个(优先无敌军、弱敌军)。",
    "4": "[4].如果可能的话,用AZOI覆盖这些目标,否则转移到下一个目标。",
    "5": "[5].在指定位置放置至少3step地面或1step空中单位。"
}

JP_MID_STRATEGIES = {
    "资源战略": StrategyDetails(
        "资源战略",
        [
            "1. 占领资源: Seoul首尔, Manila马尼拉, Kuantan关丹, 所有东印度资源", 
            "2. 新几内亚投降: 16个目标顺序推进 (见外围防御)", 
            "3. 缅甸投降: Rangoon, Mandalay, Lashio, Myitkyina", 
            "4. 中国投降: Lashio, 中国攻势, 中国事件", 
            "5. 加强港口: Truk, Rabaul, Saipan, Davao, Saigon, Eniwetok, Kwajalein, Palau"
        ],
        [JP_MID_NOTES["3"], JP_MID_NOTES["5"]]
    ),
    "中太平洋战略": StrategyDetails(
        "中太平洋战略",
        ["1. Attu/Kiska阿图", "2. Wake威克岛", "3. Midway中途岛", "4. 攻击美国舰队"],
        []
    ),
    "中缅印战略": StrategyDetails(
        "中缅印战略 (CBI)",
        [
            "1. 缅甸投降: Rangoon, Mandalay, Lashio, Myitkyina", 
            "2. 中国投降: Lashio, 中国攻势, 中国事件", 
            "3. 加强港口", 
            "4. 印度投降: Akyab, Imphal, Dimasur, Jarhat, Ledo, Dacca", 
            "5. 事件战略"
        ],
        [JP_MID_NOTES["1"]]
    ),
    "印度战略": StrategyDetails(
        "印度战略",
        [
            "1. 印度投降: Akyab, Imphal, Dimasur, Jarhat, Ledo, Dacca", 
            "2. 中国投降: Lashio, 中国攻势, 中国事件", 
            "3. 加强港口"
        ],
        []
    ),
    "外围防御战略": StrategyDetails(
        "外围防御战略",
        [
            "1. 南太平洋侧翼: Biak, Vogelkop, Hollandia, Lae, Buna, Buin, Gili-Gili, Port Moresby", 
            "2. 加强港口"
        ],
        [JP_MID_NOTES["4"], JP_MID_NOTES["5"]]
    ),
    "事件战略": StrategyDetails(
        "事件战略",
        ["同早期阶段事件战略"],
        [JP_MID_NOTES["1"]]
    ),
    "PASS": StrategyDetails("PASS", ["跳过本回合行动"], [])
}

JP_LATE_NOTES = {
    "1": "[1].如果满足条件按顺序执行。第12回合绝不把牌作为FOQ。",
    "3": "[3].将任意空中/海上补员用于本州岛，维持到资源格的AZOI。",
    "4": "[4].移动地面单位填满盟军占据格的相邻格。",
    "5": "[5].尽可能在本州岛每个六角格放置空中/海上单位。",
    "6": "[6].如果相邻格被占据满，用最大战力进攻盟军。",
    "7": "[7].所有本州岛战斗派空中/海上单位支援。",
    "8": "[8].战斗到最后一step地面单位。"
}

JP_LATE_STRATEGIES = {
    "最终国防圈战略": StrategyDetails(
        "最终国防圈战略",
        [
            "1. 港口驻军: Okinawa冲绳, Seoul首尔, Pusan釜山, Tainan台南, Saipan/Tinian塞班", 
            "2. 机场驻军: Iwo Jima硫磺岛, Kyoto京都", 
            "3. 日本港口驻军: Sasebo佐世保, Kure吴, Tokyo东京, Osaka大阪, Nagoya名古屋, Ominato大凑, Hakodate函馆"
        ],
        [JP_LATE_NOTES["3"]]
    ),
    "最终防御战略": StrategyDetails(
        "最终防御战略",
        ["1. 集结部队", "2. 海空支援", "3. 板载冲锋"],
        [JP_LATE_NOTES["4"], JP_LATE_NOTES["5"], JP_LATE_NOTES["6"], JP_LATE_NOTES["7"], JP_LATE_NOTES["8"]]
    ),
    "事件战略": StrategyDetails(
        "事件战略",
        ["同早期阶段事件战略"],
        [JP_LATE_NOTES["1"]]
    ),
    "PASS": StrategyDetails("PASS", ["跳过本回合行动"], [])
}

CARD_STRATEGIES = {
    "先发打击 EC": StrategyDetails("先发打击 EC", ["1. 伊号作战 (JP) / 燧发枪行动 (AL)", "2. 第二阶段作战 (JP) / 脚指甲行动 (AL)"], []),
    "无限制事件 EC": StrategyDetails("无限制事件 EC", ["选择后勤值(LV)最高的牌，优先有进攻奖励的"], []),
    "有限制事件 EC": StrategyDetails("有限制事件 EC", ["选择后勤值(LV)最高的牌，优先有进攻奖励的"], ["不能考虑中途岛(除非特定战略)"]),
    "无军事事件 OC": StrategyDetails("无军事事件 OC", ["选择行动值(OV)最高的牌"], []),
    "有限制事件 OC": StrategyDetails("有限制事件 OC", ["选择行动值(OV)最高的牌"], ["限制条件导致无法攻击时退化为OC"]),
    "事件战略": StrategyDetails("事件战略", ["按顺序打出政治/资源牌"], []),
    "卡牌分类": StrategyDetails("卡牌分类", ["整理手牌排序"], ["攻势第一步进行"])
}

TF_FORMATIONS = {
    "航空打击": "为目标激活单位(仅空/海/航母)。若可能，提供足够的制空权。",
    "带航空支援的地面攻击": "激活地面、空中、航母(范围内的)。必须有1空/海单位支援。",
    "向目标进军": "无需战斗直接移动地面单位进入。如果有敌方海上单位，进入后离开避免战斗格。",
    "带航空/海上支援的地面攻击": "激活地面、海上、空中和航母。对最弱堆叠攻击。",
    "带海上支援的登陆": "激活海上、两栖地面、航母。至少需要1海上单位。",
    "带航空/海上支援的登陆": "激活空中、海上、两栖地面、航母。至少1海+1空，或1航母。",
    "无支援登陆": "仅激活两栖地面单位。仅在空目标且无敌方反应时使用。"
}

AL_EARLY_STRATEGIES = {
    "撤离菲律宾": StrategyDetails(
        "撤离菲律宾", 
        ["1. P旅到Biak", "2. R军到Kendari", "3. [SL]军到Manila", "4. [FEAF]到Manila", "5. [19 LRB]到Timor"], 
        ["如果单位已就位则视为完成"]
    ),
    "撤离马来亚": StrategyDetails(
        "撤离马来亚", 
        ["1. 8 Aus到Kendari", "2. MA Air到Palembang"], 
        []
    ),
    "建立ABDA": StrategyDetails(
        "建立 ABDA 指挥部", 
        ["放置ABDA HQ到: 1. Tjilatjap, 2. Kendari, 3. Balikpapan, 4. Soerabaja, 5. Tarakan"], 
        []
    ),
    "增强CBI防御": StrategyDetails(
        "增强 CBI 防御", 
        ["1. 1 Ind到Rangoon", "2. B Ind师到Akyab", "3. 66集团军到Lashio", "4. 6集团军到Mandalay", "5. 5集团军到Myitkyina", "6. 1 Burma到Imphal"], 
        ["所有单位就位视作建立完成"]
    ),
    "DEI防御": StrategyDetails(
        "DEI 防御", 
        ["派英联邦或美军前往ABDA HQ港口 (Tjilatjap, Kendari, Balikpapan, Soerabaja, Tarakan)"], 
        []
    ),
    "橙色计划": StrategyDetails(
        "橙色计划 (Plan Orange)", 
        ["1. 美国军护航派往莱特岛(Leyte)", "2. 若莱特被控，派往马尼拉(Manila)"], 
        []
    ),
    "攻势进攻": StrategyDetails(
        "攻势进攻", 
        ["1. 对最弱日本单位发起1x海空攻击", "2. 脱离最后一支航母避免被灭"], 
        []
    ),
    "事件战略": StrategyDetails(
        "事件战略", 
        ["1. 欧战事件", "2. 结束ISR或FOQ", "3. 造成日本ISR", "4. 杜立特空袭", "5. 巴丹行军", "6. FOQ"], 
        []
    )
}

AL_MID_STRATEGIES = {
    "反攻战略": StrategyDetails(
        "反攻战略", 
        [
            "1. Midway中途岛", "2. Dutch Harbor荷兰港", "3. Dacca达卡(仅地面推进)", 
            "4. Dimasur迪马布尔", "5. Jarhat乔尔哈特", "6. Ledo雷多", 
            "7. Imphal/Kohima英帕尔", "8. 澳洲港口(优先地面,其次AA)", 
            "9. 澳洲机场(优先地面,其次AA)", "10. Guadalcanal瓜岛", 
            "11. Attu/Kiska阿图岛", "12. Port Moresby莫尔茨比(仅地面推进)",
            "13. Gili-Gili吉里吉里(仅地面推进)", "14. New Hebrides新赫布里底(通过AA)",
            "15. Noumea努美阿(优先AA,其次地面)", "16. Roll 1d10 切换其他战略"
        ], 
        ["按顺序占领, 无法攻击则向前移动基地", "多余激活点攻击日军航空兵"]
    ),
    "南太平洋战略": StrategyDetails(
        "南太平洋战略", 
        [
            "1. Guadalcanal", "2. Gili-Gili", "3. Port Moresby", "4. Buna", 
            "5. Lae", "6. New Georgia", "7. Bougainville", "8. Gasmata/Rabaul", 
            "9. Madang", "10. Wewak", "11. Aitape", "12. Admiralty Islands", 
            "13. Hollandia", "14. Biak", "15. Sarong", "16. Vogelkop"
        ], 
        ["优先ANZAC或SW Pac HQ"]
    ),
    "中太平洋战略": StrategyDetails(
        "中太平洋战略", 
        [
            "1. Wake威克岛", "2. Tarawa塔拉瓦", "3. Kwajalein夸贾林", 
            "4. Eniwetok恩尼威托克", "5. Palau帕劳", "6. Uluthi乌利西", "7. Saipan塞班"
        ], 
        ["优先Cen Pac HQ，其次SW Pac HQ"]
    ),
    "CBI战略": StrategyDetails(
        "CBI 战略", 
        [
            "1. Dacca", "2. Akyab", "3. Dimasur", "4. Jarhat", "5. Imphal/Kohima", 
            "6. Ledo", "7. Myitkyina", "8. Lashio", "9. Mandalay", "10. Rangoon"
        ], 
        ["优先SEAC HQ或联合HQ"]
    ),
    "DEI战略": StrategyDetails(
        "DEI 战略", 
        ["1. Timor", "2. Kendari", "3. Soerabaja", "4. Balikpapan", "5. Tarakan"], 
        ["优先ANZAC或SW Pac HQ"]
    )
}

AL_LATE_STRATEGIES = {
    "占领轰炸基地": StrategyDetails(
        "占领战略轰炸基地", 
        [
            "1. Saipan塞班", "2. Guam关岛", "3. Marcus Island南鸟岛", 
            "4. Iwo Jima硫磺岛", "5. Okinawa冲绳", "6. Tainan台南", "7. Taihoku台北"
        ], 
        ["使用最大攻势卡占领"]
    ),
    "推进B29": StrategyDetails(
        "推进 B29", 
        ["使用OC移动B29到战略基地", "剩余激活点攻击指挥范围内日军航母/空军"], 
        []
    ),
    "重返菲律宾": StrategyDetails(
        "重返菲律宾", 
        [
            "1. 占领连接SW Pac HQ距莱特4格基地", "2. Leyte莱特", 
            "3. Davao达沃", "4. 2912六角格(与马尼拉相邻)", "5. Manila马尼拉",
            "6. 解放 DEI", "7. 解放马来亚"
        ], 
        ["优先SW Pacific HQ"]
    ),
    "跳岛作战": StrategyDetails(
        "跳岛作战", 
        [
            "1. Kwajalein夸贾林", "2. Eniwetok恩尼威托克", "3. Saipan塞班", 
            "4. Iwo Jima硫磺岛", "5. Okinawa冲绳", "6. 登陆日本"
        ], 
        ["优先Cen Pacific HQ", "在最高优先级目标达成前，不要执行下一个目标"]
    ),
    "登陆日本": StrategyDetails(
        "登陆日本", 
        [
            "1. Sasebo佐世保", "2. Tokyo东京", "3. Ominato大凑", 
            "4. 3606格", "5. Nagoya名古屋", "6. Kyoto京都", 
            "7. Kure吴", "8. Osaka大阪"
        ], 
        []
    ),
    "原子弹胜利": StrategyDetails(
        "原子弹胜利", 
        ["1. 打出苏联入侵满洲", "2. 占领剩下的日本资源格"], 
        ["需无战略轰炸失败且日本资源<=3 (未打出苏联入侵时<=5)"]
    )
}

class ErasmusContext:
    def __init__(self):
        # 通用
        self.cards_in_hand = 5
        self.can_pass = False
        self.current_turn = 2
        
        # --- 日本特有变量 ---
        # 早期
        self.jp_A_allied_hq_oos_in_phil_dei_mal = False
        self.jp_B_dei_surrender_hexes_occupied = False
        self.jp_D_res_lt_13 = False
        self.jp_F_logistics_ge_20 = False
        self.jp_H_logistics_le_19 = False
        self.jp_I_azoi_covers_dei_ports = False
        self.jp_J_controls_rabaul_guadalcanal = False
        self.jp_K_controls_4_to_6_ng_ports = False
        self.jp_L_mal_phil_dei_not_conquered = True
        self.jp_M_perimeter_target_1_complete = False
        
        # 中期
        self.jp_E_us_will_lt_4 = False
        self.jp_F_burma_surrendered = False
        self.jp_G_logistics_ge_15 = False
        self.jp_H_has_gandhi = False
        self.jp_I_more_steps_in_burma = False
        self.jp_J_logistics_ge_18 = False
        
        # 晚期
        self.jp_L_B_garrisons_within_8_of_tokyo = False
        self.jp_L_C_airfields_within_5_of_tokyo = False
        self.jp_L_E_allied_on_honshu = False
        
        # --- 盟军特有变量 ---
        # 早期
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
        
        # 中期
        self.al_M_B_needs_war_progress = True
        self.al_M_D_jp_controls_counterattack_target = True
        
        # 晚期
        self.al_L_B_is_turn_12 = False
        self.al_L_D_has_strategic_bombing_base = False
        self.al_L_E_all_b29_on_base = False
        self.al_L_F_controls_hex_within_8_tokyo = False
        self.al_L_G_meets_atomic_bomb_criteria = False

class JapaneseDecisionTree:
    def __init__(self, ctx: ErasmusContext, rng: Optional[random.Random] = None):
        self.ctx = ctx
        self.rng = rng if rng is not None else random.Random(SEED)

    def _d10(self) -> int:
        return self.rng.randrange(0, 10)

    def evaluate_early(self) -> StrategyDetails:
        """日本早期阶段图表逻辑 (Page 1)"""
        if self.ctx.jp_A_allied_hq_oos_in_phil_dei_mal:
            if self.ctx.cards_in_hand >= 3:
                if self.ctx.jp_D_res_lt_13:
                    return JP_EARLY_STRATEGIES["激进的空优战略"]
                else:
                    if self.ctx.current_turn >= 3:
                        if self.ctx.jp_F_logistics_ge_20:
                            if not self.ctx.jp_D_res_lt_13: # E = Res >= 13
                                return JP_EARLY_STRATEGIES["中太平洋战略"]
                            else:
                                return JP_EARLY_STRATEGIES["中缅印战略"]
                        else:
                            # F = NO -> Check (H or I) + J
                            if (self.ctx.jp_H_logistics_le_19 or self.ctx.jp_I_azoi_covers_dei_ports) and self.ctx.jp_J_controls_rabaul_guadalcanal:
                                return JP_EARLY_STRATEGIES["中太平洋战略"]
                            else:
                                if self.ctx.jp_M_perimeter_target_1_complete:
                                    return JP_EARLY_STRATEGIES["马绍尔防御"]
                                return JP_EARLY_STRATEGIES["外围防御战略"]
                    else:
                        return JP_EARLY_STRATEGIES["外围防御战略"]
            else:
                return JP_EARLY_STRATEGIES["激进的南方资源战略"]
        else:
            if self.ctx.jp_B_dei_surrender_hexes_occupied:
                return JP_EARLY_STRATEGIES["保守的空优战略"]
            else:
                if self.ctx.cards_in_hand >= 3 and self.ctx.jp_L_mal_phil_dei_not_conquered:
                    roll = self._d10()
                    if roll <= 2: return JP_EARLY_STRATEGIES["事件战略"]
                    elif roll <= 6: return JP_EARLY_STRATEGIES["激进的南方资源战略"]
                    else: return JP_EARLY_STRATEGIES["外围防御战略"]
                return JP_EARLY_STRATEGIES["事件战略"]

    def evaluate_mid(self) -> StrategyDetails:
        """日本中期阶段图表逻辑 (Page 2)"""
        if self.ctx.cards_in_hand < 3:
            if self.ctx.can_pass: return JP_MID_STRATEGIES["PASS"]
            return JP_MID_STRATEGIES["事件战略"]
            
        if self.ctx.jp_D_res_lt_13:
            return JP_MID_STRATEGIES["资源战略"]
            
        if self.ctx.jp_F_logistics_ge_20:
            if self.ctx.jp_E_us_will_lt_4:
                return JP_MID_STRATEGIES["中太平洋战略"]
            if self.ctx.jp_F_burma_surrendered:
                if (self.ctx.jp_H_has_gandhi or self.ctx.jp_I_more_steps_in_burma) and self.ctx.jp_J_logistics_ge_18:
                    return JP_MID_STRATEGIES["印度战略"]
                return JP_MID_STRATEGIES["外围防御战略"]
            return JP_MID_STRATEGIES["中缅印战略"]
        elif self.ctx.jp_G_logistics_ge_15:
            # 类似 F 判定
            if self.ctx.jp_F_burma_surrendered:
                if (self.ctx.jp_H_has_gandhi or self.ctx.jp_I_more_steps_in_burma) and self.ctx.jp_J_logistics_ge_18:
                    return JP_MID_STRATEGIES["印度战略"]
                return JP_MID_STRATEGIES["外围防御战略"]
            return JP_MID_STRATEGIES["中缅印战略"]
            
        return JP_MID_STRATEGIES["外围防御战略"]

    def evaluate_late(self) -> StrategyDetails:
        """日本终局阶段图表逻辑 (Page 3)"""
        if self.ctx.cards_in_hand < 3:
            return JP_LATE_STRATEGIES["事件战略"]
            
        if self.ctx.jp_L_B_garrisons_within_8_of_tokyo and self.ctx.jp_L_C_airfields_within_5_of_tokyo:
            return JP_LATE_STRATEGIES["最终国防圈战略"]
            
        if self.ctx.can_pass:
            return JP_LATE_STRATEGIES["PASS"]
            
        if self.ctx.jp_L_E_allied_on_honshu:
            return JP_LATE_STRATEGIES["最终防御战略"]
            
        return JP_LATE_STRATEGIES["事件战略"]

class AlliedDecisionTree:
    def __init__(self, ctx: ErasmusContext, rng: Optional[random.Random] = None):
        self.ctx = ctx
        self.rng = rng if rng is not None else random.Random(SEED)

    def _d10(self) -> int:
        return self.rng.randrange(0, 10)

    def evaluate_early(self) -> StrategyDetails:
        """盟军早期阶段图表逻辑 (Page 7)"""
        if self.ctx.cards_in_hand < 3:
            return AL_EARLY_STRATEGIES["事件战略"]
            
        if not self.ctx.al_B_hq_supplied_phil:
            return AL_EARLY_STRATEGIES["撤离菲律宾"]
            
        if not self.ctx.al_C_hq_supplied_malaya:
            return AL_EARLY_STRATEGIES["撤离马来亚"]
            
        if not self.ctx.al_D_arcadia_played:
            return AL_EARLY_STRATEGIES["建立ABDA"]
            
        if not self.ctx.al_E_cbi_def_established:
            return AL_EARLY_STRATEGIES["增强CBI防御"]
            
        if self.ctx.al_F_has_passes and self.ctx.al_G_only_1_card_left:
            return StrategyDetails("PASS", ["跳过本回合行动"], [])
            
        # 橙色计划的复杂条件 J+K+L+M+N
        if (self.ctx.al_J_phil_not_surrendered and self.ctx.al_K_service_agreement and 
            self.ctx.al_L_has_2_carriers and self.ctx.al_M_us_corps_near_carrier and 
            self.ctx.al_N_aus_no_jp_ground):
            return AL_EARLY_STRATEGIES["橙色计划"]
            
        if self.ctx.al_O_dei_not_surrendered and self.ctx.al_P_abda_hq_supplied:
            return AL_EARLY_STRATEGIES["DEI防御"]
            
        return AL_EARLY_STRATEGIES["攻势进攻"]

    def evaluate_mid(self) -> StrategyDetails:
        """盟军中期阶段图表逻辑 (Page 8)"""
        if self.ctx.can_pass:
            return StrategyDetails("PASS", ["跳过本回合行动"], [])
            
        if self.ctx.al_M_B_needs_war_progress:
            if self.ctx.cards_in_hand >= 3 and self.ctx.al_M_D_jp_controls_counterattack_target:
                return AL_MID_STRATEGIES["反攻战略"]
                
        if self.ctx.cards_in_hand < 3:
            return AL_EARLY_STRATEGIES["事件战略"] # 共用事件战略
            
        # 攻势卡牌分组，然后Roll
        roll = self._d10()
        if 0 <= roll <= 4: return AL_MID_STRATEGIES["南太平洋战略"]
        elif 5 <= roll <= 7: return AL_MID_STRATEGIES["中太平洋战略"]
        elif roll == 8: return AL_MID_STRATEGIES["DEI战略"]
        else: return AL_MID_STRATEGIES["CBI战略"]

    def evaluate_late(self) -> StrategyDetails:
        """盟军终局阶段图表逻辑 (Page 9)"""
        if self.ctx.can_pass:
            return StrategyDetails("PASS", ["跳过本回合行动"], [])
            
        if self.ctx.al_L_B_is_turn_12 and self.ctx.cards_in_hand < 3:
            return AL_EARLY_STRATEGIES["事件战略"]
            
        if not self.ctx.al_L_D_has_strategic_bombing_base:
            return AL_LATE_STRATEGIES["占领轰炸基地"]
            
        if not self.ctx.al_L_E_all_b29_on_base:
            return AL_LATE_STRATEGIES["推进B29"]
            
        if not self.ctx.al_L_F_controls_hex_within_8_tokyo:
            roll = self._d10()
            if 0 <= roll <= 2: return AL_LATE_STRATEGIES["重返菲律宾"]
            elif 3 <= roll <= 5: return AL_LATE_STRATEGIES["跳岛作战"]
            else: return StrategyDetails("轮流战略", ["上次重返，则跳岛。上次跳岛，则重返。"], [])
            
        if self.ctx.al_L_G_meets_atomic_bomb_criteria:
            return AL_LATE_STRATEGIES["原子弹胜利"]
            
        return AL_LATE_STRATEGIES["登陆日本"]

class TaskForceEvaluator:
    """
    通用任务部队评估器 (日盟逻辑在图表结构上是一致的)
    返回所需的具体行动类型。
    """
    def __init__(self):
        # 初始化TF相关的判断条件
        self.A_is_air_naval_strike = False
        self.B_is_coastal_island = True
        self.C_can_ground_advance = False
        self.D_hex_empty = False
        self.E_only_naval = False
        self.F_can_enter_leave = False
        self.G_potential_sr = False
        self.H_enemy_react = True
        self.I_enough_activation = True
        self.J_damage_level_met = True
        self.K_enemy_sea_ground_react = False
        self.L_is_ec = True

    def evaluate(self) -> str:
        if self.A_is_air_naval_strike:
            return TF_FORMATIONS["航空打击"]
            
        if not self.B_is_coastal_island:
            if not self.D_hex_empty:
                return TF_FORMATIONS["带航空支援的地面攻击"]
            else:
                return TF_FORMATIONS["向目标进军"]
                
        # 沿岸或岛屿 (B = Yes)
        if self.C_can_ground_advance:
            if self.D_hex_empty or (self.E_only_naval and self.F_can_enter_leave):
                return TF_FORMATIONS["向目标进军"]
            else:
                return TF_FORMATIONS["带航空/海上支援的地面攻击"]
        else:
            # 无法通过地面推进
            if self.D_hex_empty:
                if self.G_potential_sr:
                    if self.H_enemy_react:
                        return TF_FORMATIONS["带航空/海上支援的登陆"]
                    else:
                        return TF_FORMATIONS["带海上支援的登陆"]
                else:
                    return TF_FORMATIONS["无支援登陆"]
            else:
                return TF_FORMATIONS["带航空/海上支援的登陆"]

# ===========================================================================
# 目标解析：把"目标优先级文本"解析成有序 Goal（带真实 hex 与执行属性）
# ---------------------------------------------------------------------------
# 每个战略.targets 的每一行 = 一个优先级目标(数字序)。行内 hex 名保持书写顺序,
# 即目标格优先级顺序(图表对同一投降/夺取组也按名单先后进攻)。
# ===========================================================================

# Goal 类型
CONQUEST = "CONQUEST"       # 夺取/占领/投降名单: 逐格攻占(空目标直接进军)
SUPPRESS = "SUPPRESS"       # 压制敌方AZOI: 空中/海上打击, 不占领
GARRISON = "GARRISON"       # 驻军/加固: 把部队放到己方目标格(需已控制)
PORTS = "PORTS"             # 加强港口: 同驻军
INVADE_JAPAN = "INVADE_JAPAN"  # 登陆日本本土: 攻占剩余日本本土格
B29 = "B29"                 # 推进B29/战略轰炸(行政)
NAVAL = "NAVAL"             # 海战/护航(行政, 舰队机动)
ADMIN = "ADMIN"             # 事件/掷骰/换战略等非地图执行


class Goal:
    def __init__(self, priority: int, text: str, kind: str, hexes: List[int],
                 region: Optional[str] = None, sub: Optional[List[str]] = None):
        self.priority = priority
        self.text = text
        self.kind = kind
        self.hexes = hexes            # 有序(优先级即下标序)
        self.region = region          # 该目标所属大区(data_map region 名)
        self.sub = sub or []          # 未映射成 hex 的抽象子项(保留原文)

    @property
    def only_ground(self) -> bool:
        return "仅地面推进" in self.text or "仅地面" in self.text

    @property
    def prefer_air(self) -> bool:
        return "优先AA" in self.text or "通过AA" in self.text or "压制" in self.text

    @property
    def if_enemy_controlled(self) -> bool:
        return "若被盟军控制" in self.text or "若被日军" in self.text or "若被敌方" in self.text

    def as_dict(self) -> Dict:
        return {"priority": self.priority, "kind": self.kind, "text": self.text,
                "hexes": self.hexes, "hex_labels": [hex_label(h) for h in self.hexes],
                "region": self.region, "sub": self.sub}

    def __repr__(self):
        return f"<Goal#{self.priority} {self.kind} {self.hexes} {self.text[:28]}>"


# 中文区域短语 -> data_map region(仅用于"全体目标/所有X资源"的兜底展开)
_CN_REGION = {
    "东印度": "DEI", "菲律宾": "Philippines", "马来亚": "Malaya", "缅甸": "Burma",
    "中国": "China", "印度": "India", "新几内亚": "Guinea", "日本": "Japan",
    "中太平洋": "Marshall", "澳洲": "Australia",
    "塞班": None, "硫磺岛": None, "冲绳": None, "台湾": None,
}


def _resource_hexes(region: str) -> List[int]:
    return sorted(h for h in region_has_named(region)
                  if HEXES.get(h, {}).get("resource"))


def _resolve_pointer(text: str) -> List[int]:
    """"见外围防御" 等跨战略指针: 解析被指向战略的目标链 hex。"""
    m = re.search(r"见\s*([一-鿿]+)", text)
    if not m:
        return []
    token = m.group(1)
    best: List[int] = []
    for lib in (JP_MID_STRATEGIES, JP_EARLY_STRATEGIES, JP_LATE_STRATEGIES,
                AL_MID_STRATEGIES, AL_LATE_STRATEGIES, AL_EARLY_STRATEGIES):
        for key, s in lib.items():
            if token in key or key in token:
                cand = [h for g in parse_goals(s) for h in g.hexes]
                if len(cand) > len(best):
                    best = cand
    return best


def _classify(text: str) -> str:
    if any(k in text for k in ("Roll", "1d10", "切换", "放牌", "跳过", "PASS", "FOQ",
                               "按顺序", "整理手牌", "同早期", "事件战略", "其他放牌",
                               "如果已控制则加固", "欧战为正打欧战牌")):
        return ADMIN
    if "压制" in text:
        return SUPPRESS
    if "登陆日本" in text or "板载冲锋" in text:
        return INVADE_JAPAN
    if "攻击美国舰队" in text or "脱离" in text or "护航" in text or "航母" in text and "攻击" in text:
        return NAVAL
    if "B29" in text or "轰炸" in text:
        return B29
    if "驻军" in text or "加固" in text:
        return GARRISON
    if "加强港口" in text:
        return PORTS
    if "投降" in text or "占领" in text or "夺" in text or "攻占" in text \
            or "推进" in text or "登陆" in text or "进军" in text:
        return CONQUEST
    # 单名(如 "1. Saipan", "1. Attu/Kiska阿图")视为夺取
    if line_to_hexes(text):
        return CONQUEST
    return ADMIN


def _region_of(text: str) -> Optional[str]:
    for cn, reg in _CN_REGION.items():
        if reg and cn in text and reg not in text:
            return reg
    return None


def parse_goals(strategy: StrategyDetails) -> List[Goal]:
    """把一个战略的目标优先级清单解析成 Goal 序列(保持优先顺序)。

    区域整体目标按文本形态展开, 而不是无脑扫光整个 region:
      * "见外围防御" 等指针     -> 解析被指向战略的目标 hex 链;
      * "所有X资源"            -> 展开该区域带 resource 标记的命名格;
      * 其余区域整体占领(如"新几内亚投降")
                             -> 仅在文本给不出任何具体格/指针时兜底为 region 命名格;
      * 纯抽象目标(中国投降/中国攻势等事件类) -> 保留为 hexes=[] 抽象格,
        由执行器记入 trace, 不静默丢弃。
    """
    goals: List[Goal] = []
    for i, line in enumerate(strategy.targets, start=1):
        text = line.strip()
        if not text:
            continue
        kind = _classify(text)
        hexes = line_to_hexes(text)
        region = _region_of(text)
        if kind == INVADE_JAPAN:
            # 若文本自带城市名单(见 AL_LATE 登陆日本)由 line_to_hexes 解析;
            # 空名单的"登陆日本"(如跳岛尾步)只作本土登陆预案标记, 不自动横扫全部本土格
            pass
        if kind == CONQUEST and not hexes:
            # 指针: "见外围防御" -> 外围防御战略自己的目标链
            if not hexes:
                hexes = _resolve_pointer(text)
            # "所有东印度资源" -> 区域资源格
            if not hexes and region:
                m = re.search(r"所有[一-鿿]{0,8}资源", text)
                if m:
                    hexes = _resource_hexes(region)
            # 兜底: 区域整体占领(文本无任何具体格可给) -> region 命名格
            if not hexes and region:
                hexes = [h for h in region_has_named(region) if HEXES.get(h)]
        goals.append(Goal(i, text, kind, hexes, region=region))
    return goals


# ===========================================================================
# 参考世界模型(最小)：控制 + 兵力步数 + 基地射程 + 行动预算。
# 简化结算, 仅供参考/审计; JS 引擎侧复用真实 rules.js 结算。
# ===========================================================================
class ReferenceWorld:
    def __init__(self, role: str, control: Optional[Dict[int, str]] = None,
                 ground: Optional[Dict[Tuple[int, str], int]] = None,
                 bases: Optional[List[int]] = None, action_points: int = 99,
                 activation: int = 4, reach: int = 30):
        self.role = role
        self.enemy = "Allies" if role == "Japan" else "Japan"
        self.control: Dict[int, str] = dict(control or {})
        self.ground: Dict[Tuple[int, str], int] = dict(ground or {})
        self.bases: List[int] = list(bases or [])
        self.action_points = action_points        # 本回合/攻势可用行动预算
        self.activation = activation              # 单次攻势可用打击力上限
        self.reach = reach                        # 从己方基地算的最大推进距离
        self.captured: List[int] = []
        self.offensives = 0
        self.fallbacks = 0
        self.deferred = 0

    def owner(self, idx: int) -> Optional[str]:
        return self.control.get(idx)

    def my(self, idx: int, kind: str = "ground") -> int:
        return self.ground.get((idx, self.role), 0)

    def enemy_ground(self, idx: int) -> int:
        return self.ground.get((idx, self.enemy), 0)

    def in_reach(self, idx: int) -> bool:
        """从任一己方基地到目标的 hex 距离 <= reach(或已在控制)。"""
        if self.owner(idx) == self.role:
            return True
        return any(get_distance(b, idx) <= self.reach for b in self.bases)

    def nearest_base_dist(self, idx: int) -> int:
        if not self.bases:
            return 9999
        return min(get_distance(b, idx) for b in self.bases)

    def set_owner(self, idx: int, side: str):
        self.control[idx] = side

    def place(self, idx: int, side: str, steps: int):
        self.ground[(idx, side)] = self.ground.get((idx, side), 0) + steps

    def add_base(self, idx: int):
        if idx not in self.bases:
            self.bases.append(idx)

    def spend(self, n: int = 1) -> bool:
        if self.action_points < n:
            return False
        self.action_points -= n
        return True


# ===========================================================================
# 执行引擎(核心): 把战略目标清单按优先级落实成地图进攻序列。
# ---------------------------------------------------------------------------
# 关键规则(移植到 JS 的操作层算法):
#   1. 目标清单被解析成有序 hex 链(真实地图 idx), 优先级 = 文本序号;
#   2. 只进攻当前链首(最高优先且未达成)的目标——达成前不跳到下一个目标
#      (实现"AI 为什么不集中: 因为缺这层, 以前每回合到处乱打");
#   3. 对每个链首目标评估: 是否已达成(己方控制)/ 是否在射程/ 敌方兵力
#      (伤害等级 J) / 我方可用兵力 → 决定进攻、空目标进军、或图表后备
#      (仅靠近/攻最弱/跳过);
#   4. 目标被攻下后加入基地, 推进下一个目标(逐岛推进 / 夺格节奏)。
# ===========================================================================
class ErasmusExecutor:
    def __init__(self, role: str, ctx: ErasmusContext, world: ReferenceWorld,
                 rng: Optional[random.Random] = None):
        self.role = role
        self.ctx = ctx
        self.world = world
        self.rng = rng if rng is not None else random.Random(SEED)
        self.trace: List[Dict] = []

    # ---- 对外入口：执行一个战略 ----------------------------------------
    def execute(self, strategy: StrategyDetails) -> Dict:
        goals = parse_goals(strategy)
        chain = [h for g in goals for h in g.hexes]
        entry = {
            "role": self.role, "strategy": strategy.name,
            "target_chain": [{"idx": h, "label": hex_label(h), "region": region_of(h)}
                             for h in chain],
            "goals": [g.as_dict() for g in goals],
        }
        self._log("start", strategy.name, note=f"目标链 {len(chain)} 格, 依优先级推进")
        for g in goals:
            if g.kind in (ADMIN, NAVAL, B29):
                self._log("admin", g.text, kind=g.kind,
                          note="行政/海战/轰炸目标: 交事件窗或舰队机动, 不占地面攻势")
                continue
            if g.kind == SUPPRESS:
                self._pursue(g, capture=False)   # 只压制不打下来
                continue
            if g.kind in (GARRISON, PORTS):
                self._garrison(g)
                continue
            if g.kind == INVADE_JAPAN and not g.hexes:
                self._log("invade_plan", g.text, kind="INVADE_JAPAN",
                          note="本土登陆预案: 待前置基地(冲绳/硫磺岛)得手后执行「登陆日本」战略目标链")
                continue
            if g.kind == CONQUEST and not g.hexes:
                self._log("abstract", g.text, kind="CONQUEST",
                          note="抽象目标(事件类, 如中国投降): 交事件窗结算, 不占跳岛攻势")
                continue
            self._pursue(g, capture=True)        # CONQUEST / INVADE_JAPAN(带城市名单)
        entry.update({
            "captures": [{"idx": h, "label": hex_label(h)} for h in self.world.captured],
            "offensives": self.world.offensives, "fallbacks": self.world.fallbacks,
            "deferred": self.world.deferred, "action_points_left": self.world.action_points,
            "trace": list(self.trace),
        })
        return entry

    # ---- 追逐一个目标清单(达成前不换目标) ------------------------------
    def _pursue(self, goal: Goal, capture: bool):
        """依优先级推进 goal.hexes。capture=False → 只压制不夺控(清 AZOI, 为后续夺控铺路)。"""
        for hx in goal.hexes:
            retries = 0
            while self.world.action_points > 0:
                owner = self.world.owner(hx)
                if owner == self.role:
                    self._log("achieved", goal.text, hx=hx, note="已控制/达成, 放行下一目标")
                    break
                if not self.world.in_reach(hx):
                    self.world.deferred += 1
                    self._log("deferred", goal.text, hx=hx,
                              note=f"距最近基地 {self.world.nearest_base_dist(hx)} > 射程 {self.world.reach}, 等前级基地推进")
                    break  # 不可达不硬打(达成前不换目标, 但也不空耗预算)

                threat = self.world.enemy_ground(hx)
                if not capture:
                    # 压制格: 一次空/海打击即可(消除覆盖该目标的敌方 AZOI), 不夺控
                    if not self.world.spend(1):
                        self._log("budget", goal.text, hx=hx, note="行动预算耗尽")
                        return
                    self.world.offensives += 1
                    self._log("suppressed", goal.text, hx=hx, threat=threat,
                              note="空中/海上打击完成: 敌方覆盖该目标的 AZOI 被压制")
                    break  # 本压制格完成 → 下一个压制格

                if threat == 0:
                    # 空目标: 直接进军占领(不打仗)——EotS 空敌格由移动夺控
                    if not self.world.spend(1):
                        self._log("budget", goal.text, hx=hx, note="行动预算耗尽")
                        return
                    self._apply_capture(hx, goal, battle=False)
                    continue

                # 目标有敌军: 编成 + 伤害等级判定(Node J)
                formation = self._choose_formation(goal, hx)
                required = self._required_power(threat, formation)
                available = self._gather_power(hx)
                if available < required:
                    # Node J = NO → 图表后备方案(掷骰), 不宣告硬攻; 本格重试上限防空转
                    self.world.fallbacks += 1
                    roll = self.rng.randrange(0, 10)
                    fb = "仅移动靠近(不宣告战斗)" if roll <= 3 else "打范围内最弱堆叠或跳过"
                    self._log("fallback", goal.text, hx=hx, threat=threat,
                              required=required, available=available,
                              note=f"伤害等级未达标(J=NO, d10={roll}): {fb}")
                    if not self.world.spend(1):
                        return
                    retries += 1
                    if retries >= 3:
                        self.world.deferred += 1
                        self._log("deferred", goal.text, hx=hx,
                                  note="多次判定伤害不足(守军太强/补给不足), 转较弱目标或等下回合增援")
                        break
                    continue
                # 兵力足够: 进攻
                if not self.world.spend(1):
                    self._log("budget", goal.text, hx=hx, note="行动预算耗尽")
                    return
                self.world.offensives += 1
                self._log("attack", goal.text, hx=hx, kind=formation,
                          threat=threat, required=required, available=available,
                          note=f"进攻: 目标防御 {threat} 步, 我方可用 {available}")
                self._apply_capture(hx, goal, battle=True)

    # ---- 编成 / 兵力判定 / 夺控 / 注释 --------------------------------
    def _choose_formation(self, goal: Goal, hx: int) -> str:
        tf = TaskForceEvaluator()
        if goal.kind == SUPPRESS:
            tf.A_is_air_naval_strike = True
            return tf.evaluate()
        # 沿海/岛屿 vs 内陆地面推进(参考用目标文本"仅地面推进"与是否陆地格近似)
        coastal = region_of(hx) is not None and not goal.only_ground
        tf.B_is_coastal_island = coastal
        tf.C_can_ground_advance = goal.only_ground
        tf.D_hex_empty = False
        tf.E_only_naval = False
        tf.F_can_enter_leave = False
        return tf.evaluate()

    def _required_power(self, threat: int, formation: str) -> float:
        # 海空打击只需 0.5x, 登陆/地面强攻需 1x(参考简化; JS 用真实损伤表)
        return threat * (0.5 if formation == TF_FORMATIONS["航空打击"] else 1.0)

    def _gather_power(self, hx: int) -> float:
        # 单次攻势可投入的打击力: 不超过 activation 上限(参考: 忽略 HQ 逐格扫描)
        return min(self.world.activation, 4.0)

    def _apply_capture(self, hx: int, goal: Goal, battle: bool):
        enemy = self.world.enemy_ground(hx)
        self.world.set_owner(hx, self.role)
        self.world.place(hx, self.role, 1)
        if enemy > 0:
            self.world.ground[(hx, self.world.enemy)] = 0  # 守军被消灭
        self.world.captured.append(hx)
        self.world.add_base(hx)   # 攻下的格通常含港口/机场, 成为下一跳基地
        self._log("captured", goal.text, hx=hx,
                  note=f"{'战斗夺控' if battle else '空目标进军'}({hex_label(hx)}, {region_of(hx)}) → 加入基地")

    def _garrison(self, goal: Goal):
        placed = 0
        for hx in goal.hexes:
            if self.world.owner(hx) != self.role:
                self._log("garrison_skip", goal.text, hx=hx, note="非己方控制, 跳过驻军")
                continue
            self.world.place(hx, self.role, 1)
            placed += 1
        self._log("garrison", goal.text, note=f"驻军 {placed} 格(至少3step地面/1step空中)")

    def _log(self, event: str, text: str, note: str = "", hx: Optional[int] = None,
             **kw) -> None:
        row: Dict = {"event": event, "goal": text[:40], "note": note}
        if hx is not None:
            row["hex"] = hx
            row["hex_label"] = hex_label(hx)
        row.update({k: v for k, v in kw.items() if v is not None})
        self.trace.append(row)


# ===========================================================================
# 场景驱动器: 决策树(选战略) → 执行引擎(按目标优先级落实进攻)
# ===========================================================================
def _hex(name: str) -> Optional[int]:
    hits = name_to_hexes(name)
    return hits[0] if hits else None


def _bases(*names: str) -> List[int]:
    """取若干名字里第一个能在注册表命中的 hex 作基地(按序, 只留已控前哨)。"""
    for n in names:
        h = _hex(n)
        if h is not None:
            return [h]
    return []


def island_hop_world(seed: int, turn: int = 0) -> Tuple[str, ErasmusContext, ReferenceWorld, int]:
    """盟军晚期跳岛参考局: 基地(中途岛已控前哨)逐跳向日本。"""
    role = "Allies"
    ctx = ErasmusContext()
    ctx.current_turn = 11
    ctx.al_L_D_has_strategic_bombing_base = True
    ctx.al_L_E_all_b29_on_base = True
    ctx.al_L_F_controls_hex_within_8_tokyo = False
    w = ReferenceWorld(role=role)
    # 己方基地: 已控中途岛(不在目标链上)
    base = _hex("Midway")
    if base is None:
        base = _hex("Wake")
    w.bases = [base] if base is not None else []
    if base is not None:
        w.set_owner(base, role)
        w.place(base, role, 3)
    # 目标链全部日军把守(每格 1 步守军, 需战斗夺控)
    for name in ("Kwajalein", "Eniwetok", "Saipan", "Iwo Jima", "Okinawa"):
        h = _hex(name)
        if h is not None:
            w.set_owner(h, "Japan")
            w.place(h, "Japan", 1)
    return role, ctx, w, 4


def scenario_demo() -> None:
    print("=" * 70)
    print("执行引擎参考演示：决策树选战略 → 目标优先级清单 → 逐格落实进攻")
    print("=" * 70)

    # ---- 演示1: 盟军晚期 - 跳岛作战(多回合逐岛推进) -------------------
    print("\n--- [演示1] 盟军晚期 跳岛作战(目标达成前不换目标, 预算限制推进) ---")
    seed = SEED
    role, ctx, world, per_turn = island_hop_world(seed)
    # 决策轴应选中"跳岛作战"(无战略轰炸基地场景 → 先占轰炸基地 → 再跳岛)
    ctx2probe = ErasmusContext()
    ctx2probe.current_turn = 11
    ctx2probe.cards_in_hand = 5
    al_tree = AlliedDecisionTree(ctx2probe, random.Random(seed))
    selected = al_tree.evaluate_late()
    print(f"决策轴(尚无战略轰炸基地时)优先: {selected.name}"
          f" —— 本演示直接演练攻下基地后的「{AL_LATE_STRATEGIES['跳岛作战'].name}」")
    strat = AL_LATE_STRATEGIES["跳岛作战"]
    goals = parse_goals(strat)
    print(f"战略: {strat.name}  |  目标链: {', '.join(hex_label(h) for g in goals for h in g.hexes)}")
    for turn_i in range(2):
        world.action_points = per_turn
        ex = ErasmusExecutor(role, ctx, world, random.Random(seed + turn_i))
        rep = ex.execute(strat)
        print(f"  ── 第 {turn_i + 1} 次攻势(预算 {per_turn}) ──")
        for t in rep["trace"]:
            if t["event"] in ("captured", "fallback", "deferred", "attack", "suppressed", "budget"):
                tag = t["event"].ljust(10)
                where = t.get("hex_label", "")
                print(f"    [{tag}] {where} {t['note']}")
        in_scope = [h for h in world.captured]
        done = "✔ 本阶段目标链已全部达成(剩余预算留作他处)" if _hex("Okinawa") in in_scope else "（预算耗尽, 停在链中, 下轮继续——目标未达成不换）"
        print(f"    → 累计夺格: {', '.join(hex_label(h) for h in in_scope)}"
              f" (行动剩余 {world.action_points}) {done}")

    # ---- 演示2: 日本中期 资源战略(空目标进军 vs 有守军强攻) -----------
    print("\n--- [演示2] 日本中期 资源战略(南方资源夺控: 空目标直接进军) ---")
    ctx2 = ErasmusContext()
    ctx2.current_turn = 6
    ctx2.cards_in_hand = 5
    ctx2.jp_D_res_lt_13 = True
    jp_tree = JapaneseDecisionTree(ctx2, random.Random(seed))
    strat2 = jp_tree.evaluate_mid()
    print(f"决策轴选中: {strat2.name}")
    w2 = ReferenceWorld(role="Japan", bases=_bases("Saigon", "Davao", "Manila"))
    for name, side, steps in (("Seoul", "Japan", 1), ("Manila", "Allies", 1),
                              ("Kuantan", "Allies", 1),
                              ("Balikpapan", "Allies", 1), ("Tarakan", "Allies", 0)):
        h = _hex(name)
        if h is not None:
            w2.set_owner(h, side)
            w2.place(h, side, steps)
    w2.action_points = 8
    ex2 = ErasmusExecutor("Japan", ctx2, w2, random.Random(seed))
    rep2 = ex2.execute(strat2)
    for t in rep2["trace"]:
        if t["event"] in ("captured", "fallback", "deferred", "attack", "achieved", "budget"):
            print(f"    [{t['event'].ljust(9)}] {t.get('hex_label','')} {t['note']}")
    print(f"  → 夺格: {', '.join(hex_label(h) for h in w2.captured)}")

    # ---- 演示3: 任务编成 + 盟军登陆日本预案 ---------------------------
    print("\n--- [演示3] 盟军终局 登陆日本(日本本土各城为链) ---")
    ctx3 = ErasmusContext()
    ctx3.current_turn = 12
    for a in ("al_L_D_has_strategic_bombing_base", "al_L_E_all_b29_on_base",
              "al_L_F_controls_hex_within_8_tokyo", "al_L_G_meets_atomic_bomb_criteria"):
        setattr(ctx3, a, True)
    strat3 = AL_LATE_STRATEGIES["登陆日本"]
    goals3 = parse_goals(strat3)
    print("  目标链:", " → ".join(hex_label(h) for g in goals3 for h in g.hexes))
    w3 = ReferenceWorld(role="Allies", bases=_bases("Okinawa", "Iwo Jima", "Saipan"))
    for name in ("Kynshu", "Tokyo", "Ominato", "Nagoya", "Kyoto", "Kure", "Osaka", "Hakodate"):
        h = _hex(name)
        if h is not None:
            w3.set_owner(h, "Japan")
            w3.place(h, "Japan", 2)
    w3.action_points = 20
    ex3 = ErasmusExecutor("Allies", ctx3, w3, random.Random(seed))
    rep3 = ex3.execute(strat3)
    for t in rep3["trace"]:
        if t["event"] in ("captured", "fallback", "deferred", "attack", "achieved"):
            print(f"    [{t['event'].ljust(9)}] {t.get('hex_label','')} {t['note']}")
    print(f"  → 日本本土夺格: {', '.join(hex_label(h) for h in w3.captured)} / "
          f"{len(w3.captured)} 个城市")


def run_ai_complete_mockup(seed: int = SEED) -> None:
    scenario_demo()


# ===========================================================================
# 自测
# ===========================================================================
def _assert(ok: bool, msg: str, errors: List[str]) -> None:
    if not ok:
        errors.append(msg)


def self_test() -> None:
    errors: List[str] = []
    print("SELF-TEST erasmus_complete_ai_execution_engine")
    seed = SEED
    rng = random.Random(seed)

    # 1) 地图注册表
    _assert(len(HEXES) > 150, f"地图 named 注册表缺失: {len(HEXES)}", errors)
    _assert(len(LAND) > 300, f"地图 land 注册表缺失: {len(LAND)}", errors)

    # 2) 引用完整性: 决策树引用的 key 必须存在
    missing = []
    for lib, keys in [(JP_EARLY_STRATEGIES, ["激进的空优战略", "保守的空优战略", "激进的南方资源战略",
                                             "中缅印战略", "中太平洋战略", "马绍尔防御", "外围防御战略", "事件战略"]),
                      (JP_MID_STRATEGIES, ["资源战略", "中太平洋战略", "中缅印战略", "印度战略",
                                           "外围防御战略", "事件战略", "PASS"]),
                      (JP_LATE_STRATEGIES, ["事件战略", "PASS", "最终国防圈战略", "最终防御战略"]),
                      (AL_MID_STRATEGIES, ["反攻战略", "南太平洋战略", "中太平洋战略", "DEI战略", "CBI战略"]),
                      (AL_LATE_STRATEGIES, ["占领轰炸基地", "推进B29", "重返菲律宾", "跳岛作战",
                                            "原子弹胜利", "登陆日本"])]:
        for k in keys:
            if k not in lib:
                missing.append(k)
    _assert(not missing, f"缺失战略 key: {missing}", errors)

    # 3) 决策树各分支不抛 KeyError(覆盖 马绍尔防御/终局事件/PASS 出口)
    def tree_run(role: str, ctx: ErasmusContext, phase: str) -> str:
        t = JapaneseDecisionTree(ctx, rng) if role == "Japan" else AlliedDecisionTree(ctx, rng)
        m = {"early": t.evaluate_early, "middle": t.evaluate_mid, "end": t.evaluate_late}[phase]
        s = m()
        return s.name if s else ""

    c = ErasmusContext()
    c.current_turn = 4                       # 需 >=3 才走 F 分支(否则早期默认外围防御)
    c.jp_A_allied_hq_oos_in_phil_dei_mal = True
    c.jp_D_res_lt_13 = False                 # E: 资源 >= 13
    c.jp_F_logistics_ge_20 = False
    c.jp_H_logistics_le_19 = True
    c.jp_J_controls_rabaul_guadalcanal = False
    c.jp_M_perimeter_target_1_complete = True
    _assert(tree_run("Japan", c, "early") == "马绍尔防御", "JP早期 M出口应为马绍尔防御", errors)
    c2 = ErasmusContext(); c2.cards_in_hand = 2
    _assert(tree_run("Japan", c2, "end") == "事件战略", "JP终局手牌不足应事件", errors)
    c3 = ErasmusContext(); c3.cards_in_hand = 5; c3.can_pass = True
    _assert(tree_run("Japan", c3, "end") == "PASS", "JP终局可PASS应PASS", errors)
    for phase in ("early", "middle", "end"):
        for side in ("Japan", "Allies"):
            n = tree_run(side, ErasmusContext(), phase)
            _assert(n, f"{side}/{phase} 决策无输出", errors)

    # 4) 目标解析: 真实 hex + 优先级顺序
    hop = AL_LATE_STRATEGIES["跳岛作战"]
    goals = parse_goals(hop)
    flat = [h for g in goals for h in g.hexes]
    kwaj = _hex("Kwajalein"); eniw = _hex("Eniwetok"); saip = _hex("Saipan")
    _assert(len(flat) >= 5, f"跳岛目标链不足: {flat}", errors)
    if kwaj and eniw and saip:
        _assert(flat.index(kwaj) < flat.index(eniw) < flat.index(saip),
                f"跳岛顺序错: {[hex_label(h) for h in flat]}", errors)

    # 5) 确定性 + 目标达成前不换目标 + 子序列推进
    role, ctx5, w5, per = island_hop_world(seed)
    exA = ErasmusExecutor(role, ctx5, w5, random.Random(seed))
    repA = exA.execute(AL_LATE_STRATEGIES["跳岛作战"])
    role, ctx5b, w5b, _ = island_hop_world(seed)
    exB = ErasmusExecutor(role, ctx5b, w5b, random.Random(seed))
    repB = exB.execute(AL_LATE_STRATEGIES["跳岛作战"])
    capA = [t["hex"] for t in repA["trace"] if t["event"] == "captured"]
    _assert(capA == [t["hex"] for t in repB["trace"] if t["event"] == "captured"],
            f"同 seed 夺格顺序不一致: {capA}", errors)
    # 目标达成前不换目标: 任何一次 attack/captured 的 hex 都必须是尚未达成时的链首
    remaining = [h for h in flat]
    for t in repA["trace"]:
        if t["event"] == "captured":
            _assert(remaining and t["hex"] == remaining[0],
                    f"越序夺格: {hex_label(t['hex'])} (当前应攻 {[hex_label(r) for r in remaining[:2]]})",
                    errors)
            if remaining and t["hex"] == remaining[0]:
                remaining.pop(0)
    _assert(len(capA) <= len(flat), "夺格数超过目标链长度", errors)

    if errors:
        raise AssertionError("\n".join(f"- {e}" for e in errors))
    print("SELF-TEST PASSED: 地图注册表 / 引用完整性 / 决策树全分支 / 目标解析顺序 / "
          "确定性 / 目标达成前不换目标 全部通过。")


if __name__ == "__main__":
    import sys
    if "--self-test" in sys.argv:
        self_test()
    else:
        run_ai_complete_mockup()