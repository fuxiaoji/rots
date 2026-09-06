# EOTS / Erasmus v2.0 代码化缺口与整改清单

> 项目：`fuxiaoji/rots`  
> 目标：对照 Erasmus v2.0 中文决策图，将目前仍为代理值、启发式、部分实现或未实现的决策条件，逐步改造成基于 RTT 规则引擎的精确实现。  
> 原则：**Erasmus 负责“选什么”，RTT 规则引擎负责“什么是合法的”**。不要在 AI 层复制第二套移动、反应、补给、战斗、部署规则。

---

## 一、总体架构整改

### 1. 新增 RTT 规则查询层
**优先级：P0**

建议新增：

`js/server/rules_query.js`

统一封装/复用 RTT 现有规则逻辑，避免 Erasmus 直接自己推断合法性。

建议接口：

```js
queryGroundReachability(...)
queryNavalReachability(...)
queryAirCombatReachability(...)
queryActivationCandidates(...)
queryReactionCandidates(...)
querySpecialReaction(...)
queryBattleSupport(...)
queryPotentialCombatStrength(...)
querySupplyStatus(...)
queryZoi(...)
queryPbmDestinations(...)
queryLegalReinforcementHexes(...)
queryLegalCardActions(...)
```

设计要求：

- 尽量调用或重构 RTT 已有合法行动生成逻辑。
- 不使用简单距离代替合法移动。
- 不使用单位存在与否代替合法参与。
- 不使用资源格、战斗存在等代理值代替真实规则条件。
- Query 层必须是只读、可测试、尽量无副作用。
- Erasmus 从 Query 层获得合法候选，再做优先级排序。

现有可复用规则引擎能力包括：

- `js/move.js`
  - `get_ground_move(...)`
- `js/supply.js`
  - `get_ground_move_cost(...)`
  - `has_zoi(...)`
- `js/server/offensive.js`
  - 已有大量真实攻势移动、反应、战斗流程代码

---

# 二、P0：任务部队编成与攻击合法性

主要对应 Erasmus 图表：

- 日本：Page 5
- 盟军：Page 11

---

## 2. `CAN_GROUND_ADVANCE`

### 当前问题

目前本质上接近：

```js
CAN_GROUND_ADVANCE = aiStage === ATTACK_STAGE
```

这只能说明“现在是攻击阶段”，不能说明：

> 是否真的有一个可激活的地面单位能够按 RTT 规则合法前进到目标。

### 目标实现

新增：

```js
queryGroundReachability(unit, offensiveContext)
```

返回：

```js
{
  reachableHexes,
  costByHex,
  predecessor,
}
```

条件应检查：

- 单位是否可被当前 HQ / 卡牌激活
- 当前攻势移动点
- 地形
- hexside
- 敌我控制
- ZOI
- 补给/状态
- 当前移动类型
- 其他 RTT 地面移动限制

最终：

```js
CAN_GROUND_ADVANCE =
  legalGroundUnits.some(u => queryGroundReachability(u, ctx).reachableHexes.has(target))
```

### 禁止

不要写成：

```js
get_distance(unitHex, targetHex) <= movement
```

---

## 3. `GROUND_CAN_ENTER_EXIT`

### 当前问题

当前逻辑近似：

```js
GROUND_CAN_ENTER_EXIT =
  aiStage === ATTACK_STAGE &&
  publicUnits.some(u => u.faction === R && u.class === "ground")
```

这只表示“存在一个地面单位”。

但图表实际要求：

> 某个地面单位可以合法进入目标格，而且在进入后还能合法离开。

这是处理目标为空或仅有敌方海军时的重要规则语义。

### 目标实现

新增：

```js
canGroundEnterAndExit(unit, target, ctx)
```

建议逻辑：

1. 用 RTT 查询从当前位置到目标是否合法。
2. 模拟或状态查询单位已进入目标。
3. 检查剩余移动力和目标周围合法退出格。
4. 检查：
   - ZOI
   - 地形
   - 控制
   - 敌军
   - hexside
   - 当前攻势状态

返回：

```js
{
  canEnter: true,
  canExit: true,
  entryCost,
  exitHexes,
}
```

测试至少覆盖：

- 敌方仅有海军，能够进入并退出
- 移动力不足
- 进入后被 ZOI 卡死
- hexside 阻断
- 存在多个出口但只有一个合法

---

## 4. `TARGET_IS_SR`

### 当前问题

当前近似：

```js
TARGET_IS_SR = !!(aiFocusData && aiFocusData.resource)
```

也就是：

> “资源格” ≈ “特殊反应目标”

这是错误语义。

### 目标实现

新增：

```js
querySpecialReaction({
  offensive,
  target,
  reactingFaction,
})
```

返回：

```js
{
  eligible,
  reason,
  respondingHq,
  legalUnits,
}
```

应复用 RTT 的特殊反应条件，包括但不限于：

- 当前攻势
- HQ
- 反应范围
- ZOI
- 情报状态
- 反应单位合法性
- 其他规则限制

最终：

```js
TARGET_IS_SR = querySpecialReaction(...).eligible
```

---

## 5. `ENEMY_AIR_OR_CARRIER_CAN_REACT`

## 6. `ENEMY_NAVAL_GROUND_CAN_REACT`

### 当前问题

目前部分逻辑仍接近：

```js
predicate = aiBattle
```

也就是说：

> 有会战 ≈ 敌人可以反应

`erasmus_ops.js` 虽然已经开始扫描潜在反应单位，但仍较多依赖：

- 距离
- 作战半径
- 简化筛选

而不是完整 RTT 反应合法性。

### 目标实现

新增核心接口：

```js
queryReactionCandidates({
  reactionFaction,
  targetHex,
  offensiveCard,
  intelligenceCondition,
})
```

返回：

```js
{
  air: [],
  carrier: [],
  naval: [],
  ground: [],
  hq: [],
  specialReaction: [],
}
```

每一个候选必须是 RTT 规则意义上的合法反应单位。

必须处理：

- 补给
- HQ 指挥
- 激活资格
- 反应范围
- ZOI
- EC / OC 差异
- 情报状态
- Reaction Move
- ISR
- Extended Range
- 空军/航母反应限制
- 地面反应限制

最终：

```js
ENEMY_AIR_OR_CARRIER_CAN_REACT =
  reaction.air.length > 0 || reaction.carrier.length > 0
```

以及：

```js
ENEMY_NAVAL_GROUND_CAN_REACT =
  reaction.naval.length > 0 || reaction.ground.length > 0
```

---

## 7. `potentialReactionStrength`

### 当前问题

已有实现会估算潜在反应兵力，这是比早期版本更好的设计。

但目前反应池本身仍不是严格的 RTT 合法反应单位集合。

### 目标实现

改为：

```js
const reaction = queryReactionCandidates(...)
const potentialReactionStrength =
  reaction.all.reduce(...)
```

不要先按距离扫全地图，再计算反应力。

---

## 8. `FORCE_MEETS_BATTLE_SUPPORT_STANDARD`

### 当前问题

当前曾存在近似：

```js
FORCE_MEETS_BATTLE_SUPPORT_STANDARD = aiBattle
```

后续虽然开始根据空海地兵力计算，但仍容易将：

- “支援兵种标准”
- “伤害等级标准”

混为一体。

### 图表语义

这一条件应该只判断：

> 当前任务部队的兵种构成是否满足该战斗类型最低支援要求。

不要在这里判断总战斗力是否足够。

### 建议实现

```js
meetsBattleSupportStandard({
  battleType,
  selectedUnits,
  target,
})
```

输出：

```js
{
  met,
  missing: [],
}
```

例如分别处理：

- 空袭
- 地面攻击
- 海军支援登陆
- 空海联合支援登陆
- 航母是否可以满足某类空中支援要求

具体兵种要求应逐条以 Erasmus 图表原文为准。

---

## 9. `TARGET_DAMAGE_LEVEL_MET`

### 当前问题

目前已经有部分损害等级估算，因此应视为：

**Partial，而不是 Missing。**

但仍缺少完整 RTT 战斗语义。

### 应拆分

```js
meetsBattleSupportStandard(...)
meetsDamageLevel(...)
```

不要合并。

### 目标实现

建议新增：

```js
effectiveCombatStrength(unit, target, ctx)
```

以及：

```js
evaluateDamageLevel({
  attackers,
  defenders,
  reactionCandidates,
  targetDamageLevel,
})
```

需要处理：

- 当前单位全强/减损状态
- 攻防 CF
- 战斗类型
- 空军 Extended Range 后攻击力修正
- RTT 实际战斗规则
- 敌方潜在反应兵力
- 目标 Damage Level

### 地面进攻额外要求

除达到攻击损害要求外，还要判断：

> 至少一个攻击地面单位能够在敌方反击达到规定结果后存活，从而占领目标。

建议新增：

```js
groundOccupationSurvivalMet(...)
```

尽量调用 RTT 战斗结果计算器。

---

## 10. `composeTaskForce()` 重写

### 当前优点

现有 `composeTaskForce()` 已经有：

- 按单位类型排序
- 按战斗力排序
- 按距离排序
- 逐步增加单位

这是可保留的框架。

### 核心缺口

现在仍可能出现：

> 先把不可到达的单位纳入排序，再尝试移动。

这是错误方向。

### 正确流程

第一步必须是：

```text
规则引擎生成合法参与单位
        ↓
Erasmus 排序
        ↓
满足支援兵种
        ↓
满足 Damage Level
        ↓
满足地面存活/占领要求
        ↓
使用最少单位
```

新增：

```js
queryCombatParticipation(unit, target, ctx)
```

返回：

```js
{
  legal,
  moveMode,
  path,
  usesExtendedRange,
  effectiveAttack,
}
```

只有：

```js
legal === true
```

的单位才能进入 `composeTaskForce()` 候选池。

---

# 三、P1：反应部队与反应决策

主要对应：

- 日本：Page 6
- 盟军：Page 12

---

## 11. `REACTION_FORCE_STANDARD_MET`

### 当前实现进展

现有代码已经比最初好：

- 比较己方空海战斗力
- 比较双方空军数量

但仍没有完整覆盖图表中的 D10 地面标准。

### 图表语义应拆解为

```js
evaluateReactionForceStandard({
  battleHex,
  selectedReactionUnits,
  attackingUnits,
  d10,
})
```

返回：

```js
{
  airSeaOneXMet,
  airCountMet,
  groundTwoXRequired,
  groundTwoXMet,
  complete,
}
```

应包含：

1. 己方空海战斗力 ≥ 敌方空海战斗力的最低标准
2. 己方空军数量达到图表要求
3. D10 特定结果下，需要额外检查地面部队 2x 标准
4. 使用最少反应单位

### `planReaction()` 应改为

每次加入：

> 最能填补当前缺口的一个合法单位

一旦：

```js
complete === true
```

立即停止增加兵力。

---

## 12. 反应会战格优先级

### 当前进展

已有类似：

```text
HQ
Resource
Port
Airfield
Other
```

的排序，这是正确方向。

### 缺口

不能只是：

```js
sortedCandidates[0]
```

因为最高优先级目标可能根本无法凑够合法反应兵力。

### 正确逻辑

对每个候选会战格按优先级依次：

```text
生成合法反应单位
↓
判断 Reaction Force Standard 是否可达到
↓
若能达到，选该目标
↓
否则继续下一目标
```

---

## 13. `WEATHER_STANDARD_MET`

### 当前问题

目前仍可能是默认：

```js
false
```

或者尚未完整按图表实现。

### 目标实现

新增：

```js
weatherReactionStandard(offensive, die)
```

输入中必须使用：

- 当前攻势真实激活单位数
- 当前 D10
- Weather Card 相关修正
- Raid 等图表规定修正

禁止使用：

- 会战格数量
- 卡牌 Logistic Value
- 其他代理值

---

## 14. Kamikaze Standard

### 当前问题

“有 Kamikaze 卡”不等于：

> 当前满足神风攻击标准。

### 目标实现

新增：

```js
queryKamikazeStandard(battleHex)
```

返回：

```js
{
  met,
  legalCapitalShipTargets,
  eligibleAirUnits,
}
```

需要检查：

- 是否存在合法 BB / CV 等目标
- 是否存在符合图表要求、可以承担减损的日军航空单位
- 单位是否为合法参与单位
- 其他卡牌/阶段限制

应使用 RTT 单位类型字段，不建议靠名字正则。

---

## 15. 潜艇攻击目标优先级

### 当前问题

现有 `HAS_VALID_SUBMARINE_TARGET` 过于接近：

```js
aiBattle && enemyHasNaval
```

### 目标实现

首先由 RTT 提供：

```js
legalSubmarineTargets(...)
```

然后 Erasmus 决策层排序：

```text
CV
↓
BB
↓
CA
↓
DD
```

同类型：

```text
防御值最高优先
↓
稳定 deterministic ID 打破平局
```

新增：

```js
pickSubmarineTarget(legalTargets)
```

---

# 四、P1：PBM（战后移动）

---

## 16. 空军 PBM

### 图表优先级需要完整代码化

建议将目的地评分独立：

```js
scoreAirPbmDestination(unit, hex, ctx)
```

优先级包括图表规定的目标，例如：

- 非 Home HQ 且缺乏 ZOI 保护
- 敌方 HQ
- 友方港口处于敌方 AZOI
- 友方机场处于敌方 AZOI
- 友方地面部队处于敌方 AZOI
- 最近的资源格

如果一个机场同时满足多项，应有组合优先级。

### 必须使用

```js
has_zoi(...)
```

或安全状态模拟后的真实 ZOI 判断。

禁止：

```js
distance <= airRange
```

直接替代 AZOI。

### 硬约束

“一个机场一个空军单位”之类的规则如果图表要求，应做成：

```js
legal = false
```

而不是仅仅扣分。

### 当前可保留

“强空军先移动”的逻辑可以保留。

---

## 17. 海军 PBM

应将图表中的港口优先级精确编码。

推荐：

```js
queryPbmDestinations(unit, ctx)
```

先生成 RTT 合法 PBM 格。

然后：

```js
scoreNavalPbmDestination(...)
```

处理例如：

- South HQ 区域缺少海军单位
- 只有地面单位驻守的港口
- 最近合法港口

具体顺序以 Page 6 / 12 原文为准。

---

## 18. Failed-AA 地面 PBM

已有失败 AA 单位跟踪逻辑可继续使用。

缺口是目的地排序应严格按图表：

例如：

```text
有海军单位的友方港口
↓
最近合法港口
```

同样：

> RTT 先给合法 PBM 目的地，Erasmus 再排序。

---

# 五、P1/P2：多目标攻势与连续作战

---

## 19. `IS_LAST_TARGET`

### 当前问题

现在部分逻辑仍偏向：

```js
!is_space_controlled(hex, faction)
```

但不同目标类型的“完成”标准完全不同。

### 目标实现

统一新增：

```js
isTargetComplete(targetMeta, gameState)
```

根据目标类型处理：

```text
SUPPRESS
SUPPRESS_HQ
GARRISON
DEFEND
REDEPLOY
B29
ATOMIC
NAVAL
CONTROL
...
```

例如：

- 有些目标要求控制
- 有些目标要求 AZOI
- 有些目标要求驻军
- 有些目标是抽象战略条件

之后：

```js
IS_LAST_TARGET =
  pendingTargets.filter(t => !isTargetComplete(t)).length === 1
```

不要在 `game.js`、`erasmus_state.js`、`erasmus_ops.js` 各写一套完成判定。

---

## 20. OC 已有一个会战格后的“准备下一目标”

### 图表语义

若 OC 已存在一个会战格：

> 不再建立第二个会战格，而是利用剩余激活兵力向下一优先目标部署。

### 建议增加显式模式

```js
ATTACK_CURRENT_TARGET
PREPARE_NEXT_TARGET
```

触发条件：

```js
offensive.type === OC &&
offensive.battleHexes.length >= 1
```

此时：

- 不再创建新 Battle Hex
- 地面、空军、海军向下一个目标做合法重部署
- 使用 RTT 移动查询
- 不能靠“向目标距离变小”这一条启发式完成全部规则

---

## 21. 两张牌的 Setup → Attack 机制

### 当前缺口

当某战略目标这一张牌根本打不到时，AI 可能会：

- 无意义进攻
- 在目标方向漂移
- 没有明确的“准备牌”

### 建议状态

```js
SETUP_CARD
ATTACK_CARD
```

或者：

```js
G.eop_preparation = {
  target,
  desiredFormation,
  missingCapabilities,
}
```

第一张牌：

```text
重部署 / 集结 / 建立攻击位置
```

第二张牌：

```text
真正攻击战略目标
```

需要评估：

```js
feasibleNow
feasibleNextCard
```

如果：

```js
!feasibleNow && feasibleNextCard
```

则禁止为了“必须打一仗”而创建低价值会战。

---

# 六、P2：战略决策轴中的已知启发式

---

## 22. `CBI_DEFENSE_COMPLETE`

### 当前问题

项目文档曾明确承认是近似逻辑，例如：

- SEAC 是否在位
- 缅甸是否有盟军地面单位

这不能代表 Erasmus 图表要求。

### 图表语义

应检查：

> “加强 CBI 防御”清单中的全部指定单位是否已经到达规定防御位置。

被消灭单位可按图表规定忽略。

### 推荐实现

建立结构化数据：

```js
const CBI_DEFENSE_REQUIREMENTS = [
  {
    unit: "...",
    allowedHexes: [...],
  },
]
```

判断：

```js
CBI_DEFENSE_REQUIREMENTS.every(req =>
  isEliminated(req.unit) ||
  req.allowedHexes.includes(location(req.unit))
)
```

实际单位清单应从 Erasmus 中文图表逐条录入。

---

## 23. Orange Plan / 美军军团与航母条件

### 当前问题

项目文档曾明确说明有类似：

```js
distance <= 15
```

的近似。

但图表语义不是：

> 地图上分别存在一个航母和一个美军军团。

### 目标实现

需要检查完整组合条件：

- 1 艘指定类型航母
- 1 个 US Army Corps
- 二者叠放在同一格
- 该格为友方控制港口
- 位于菲律宾规定距离范围内
- 单位类别/国籍正确

建议：

```js
meetsOrangePlanCriteria(...)
```

不要拆成若干松散 existence predicates。

---

## 24. 日本 India Strategy 的“大部队地面步数”

### 图表要求

“大部队”应按地面单位防御强度门槛定义，例如：

```text
Defense Strength >= 12
```

然后比较：

> Burma / North India 区域双方 qualifying ground steps。

### 当前容易出错

按“单位枚数”统计。

### 正确实现

新增：

```js
unitSteps(unit)
```

根据：

- Full strength
- Reduced
- Eliminated

返回真实 step 数。

然后：

```js
countLargeForceSteps(faction, region)
```

---

## 25. `PERIMETER_TARGET_1_COMPLETE`

### 当前问题

某些外围防御目标真正要求的是：

> AZOI / 空中控制覆盖

而不是：

> 直接控制某格。

### 目标实现

按照目标类型调用：

```js
has_zoi(...)
```

或统一：

```js
isTargetComplete(...)
```

避免把战略目标全部简化为占领格。

---

# 七、P2：卡牌选择

---

## 26. Military Event 是否可打

### 当前进展

`erasmus_state.js` 已经开始使用类似：

```js
allowed.includes("event")
```

这一方向正确。

### 目标

所有“这张牌是否能作为事件打出”的合法性必须由 RTT 决定。

Erasmus 不应重新猜：

- HQ 是否满足
- 单位是否满足
- 补给是否满足
- 事件时机是否合法

推荐：

```js
queryLegalCardActions(card, context)
```

---

## 27. Restricted / Unrestricted Military Event

### 当前问题

不应靠：

- 特定 card ID
- 卡牌名字
- 人工零散正则

来判定 Restricted。

### 图表语义

Restricted Military Event 应按卡牌规则本身机械定义：

例如：

- 限制可激活单位类型
- 限制 Battle Hex 数
- 其他操作限制

### 建议

若原始 cards metadata 不足，增加：

```js
erasmusRestrictions: {
  unitClassRestriction: ...,
  battleHexRestriction: ...,
}
```

然后统一推导：

```js
isRestrictedMilitaryEvent(card)
```

---

# 八、P2：增援与补充

虽然不完全属于 12 张主流程图，但属于完整 CDSS / AI 行为。

---

## 28. Reinforcement Placement

### 原则

错误方式：

```text
先选“理想格”
↓
再尝试是否合法
```

正确方式：

```text
RTT 先生成全部合法部署格
↓
Erasmus 按战略优先级排序
```

推荐：

```js
queryLegalReinforcementHexes(unit)
```

再：

```js
scoreReinforcementHex(...)
```

例如按：

- 离敌人最近
- 离主攻方向最近
- 战略区域优先级
- HQ 覆盖

排序。

---

## 29. HQ 增援部署

目标不是简单：

> 离前线最近。

而是：

> 最大化真实可指挥友方地面单位数量/质量。

建议：

```js
scoreHqPlacement(hex, hq)
```

使用：

- HQ command range
- ZOI 阻断
- 实际可指挥单位
- 战略目标方向
- 补给

`erasmus_ops.js` 已有 `commandable` 一类概念，可重构复用。

---

# 九、P3：可审计性与工程质量

---

## 30. 不要再用“假实现”的 boolean 默认值

当前存在类似：

```js
DAMAGE_LEVEL_MET: false
WEATHER_STANDARD_MET: false
REACTION_FORCE_STANDARD_MET: aiBattle
```

这会让代码看起来“已实现”，实际却只是 placeholder。

### 建议数据结构

```js
{
  value: null,
  fidelity: "missing"
}
```

或完全不生成该 predicate。

精确实现后：

```js
{
  value: true,
  fidelity: "exact-engine",
  evidence: {
    requiredStrength: 36,
    committedStrength: 40,
    legalUnits: [...]
  }
}
```

---

## 31. 重做 implementation map 的状态定义

当前“implemented”过于宽泛。

建议全部改为：

```text
exact-engine
exact-derived
partial
heuristic
missing
```

含义：

### `exact-engine`
直接由 RTT 规则引擎合法性/规则计算得到。

### `exact-derived`
基于准确、完整的公开游戏状态进行确定性派生。

### `partial`
只实现了条件的一部分。

### `heuristic`
结果主要依赖距离、估值或经验代理。

### `missing`
没有真实实现。

---

## 32. 优先重新审计以下 predicates

```text
CAN_GROUND_ADVANCE
GROUND_CAN_ENTER_EXIT
TARGET_IS_SR
ENEMY_AIR_OR_CARRIER_CAN_REACT
ENEMY_NAVAL_GROUND_CAN_REACT
FORCE_MEETS_BATTLE_SUPPORT_STANDARD
TARGET_DAMAGE_LEVEL_MET
REACTION_FORCE_STANDARD_MET
WEATHER_STANDARD_MET
EARLY_DEFENSE_DONE_AND_KAMIKAZE_STANDARD
HAS_VALID_SUBMARINE_TARGET
IS_LAST_TARGET
CBI_DEFENSE_COMPLETE
ORANGE_PLAN_CRITERIA
PERIMETER_TARGET_1_COMPLETE
```

---

## 33. 新增 `predicate-fidelity.json`

建议：

```text
data/erasmus/predicate-fidelity.json
```

示例：

```json
{
  "CAN_GROUND_ADVANCE": {
    "pages": ["JP05", "AP11"],
    "fidelity": "exact-engine",
    "implementation": "rules_query.queryGroundReachability",
    "tests": [
      "ground-advance-basic",
      "ground-advance-zoi-blocked",
      "ground-advance-insufficient-mp"
    ]
  }
}
```

---

# 十、测试体系

---

## 34. Predicate Golden Tests

不能只依赖：

> 20 局 / 50 局自对弈能跑完。

Campaign 完成只能证明：

> 没崩。

不能证明：

> Erasmus 图表语义实现正确。

### 每个关键 predicate 都需要正反例

例如：

### `GROUND_CAN_ENTER_EXIT`

```text
✓ 敌军只有海军，地面单位能进能出
✗ 进入后剩余 MP 不足
✗ ZOI 阻断出口
✗ terrain/hexside 阻断
```

### `TARGET_IS_SR`

```text
✓ 满足 Special Reaction
✗ 资源格但不满足 SR
✗ 非资源格但按规则满足 SR
```

### `REACTION_FORCE_STANDARD_MET`

```text
✓ 空海 1x + 空军数量标准
✗ 空海战力不足
✗ D10 要求地面 2x，但地面不足
✓ D10 不要求地面时可通过
```

---

## 35. Rules Query 单元测试

为：

```text
rules_query.js
```

单独建立测试。

要求测试：

- query 只读
- query 不修改 `G`
- 相同 state 输入结果 deterministic
- query 与 RTT 当前真实合法 actions 一致

理想情况下：

> Query 结果与游戏流程真正提供给玩家的合法操作集合进行交叉验证。

---

## 36. Campaign Regression

保留现有：

```text
tests/erasmus-campaign-audit.js
```

继续检查：

- 游戏是否完整结束
- fallback
- unexplainedNoBattle
- traceNodeMissing
- Ground Move
- capture
- Battle
- reaction
- strategy selection

但将其定位为：

```text
Regression / Integration Test
```

而不是：

```text
Rules Fidelity Test
```

---

# 十一、建议 PR 实施顺序

---

## PR1 — RTT Query API

目标：

> 建立规则查询层，不改变 Erasmus 行为。

新增/重构：

```text
js/server/rules_query.js
tests/rules-query-*.js
```

优先暴露：

```text
Ground Reachability
Reaction Candidates
Special Reaction
Combat Participation
PBM Destinations
Reinforcement Legal Hexes
```

---

## PR2 — Page 5 / Page 11 Predicate 精确化

依次修复：

```text
CAN_GROUND_ADVANCE
GROUND_CAN_ENTER_EXIT
TARGET_IS_SR
ENEMY_AIR_OR_CARRIER_CAN_REACT
ENEMY_NAVAL_GROUND_CAN_REACT
FORCE_MEETS_BATTLE_SUPPORT_STANDARD
TARGET_DAMAGE_LEVEL_MET
```

要求：

- 不得使用 `aiBattle`
- 不得使用 `aiStage`
- 不得使用 `resource`
- 不得使用简单距离

作为规则合法性的代理。

---

## PR3 — `composeTaskForce()` 重构

流程必须固定为：

```text
合法参与候选
↓
支援标准
↓
Damage Level
↓
地面占领生存要求
↓
最少单位
```

---

## PR4 — Page 6 / Page 12 Reaction + PBM

修复：

```text
REACTION_FORCE_STANDARD_MET
WEATHER_STANDARD_MET
Kamikaze Standard
Submarine Target
Reaction Hex Priority
Air PBM
Naval PBM
Failed-AA PBM
```

---

## PR5 — 战略层残余启发式

修复：

```text
CBI_DEFENSE_COMPLETE
ORANGE_PLAN_CRITERIA
Large Force Steps
PERIMETER_TARGET_1_COMPLETE
AZOI Target Completion
SETUP_CARD / ATTACK_CARD
OC Next Target Preparation
```

---

## PR6 — Fidelity Audit

新增：

```text
predicate-fidelity.json
```

重新生成：

```text
node-implementation-map
architecture docs
audit docs
```

所有 258 个 Erasmus chart node 都不能只标：

```text
implemented
```

而应至少区分：

```text
exact-engine
exact-derived
partial
heuristic
missing
```

---

# 十二、最高价值的 6 个修复

如果只先做第一轮，按价值排序：

## 1. 真实 Reaction Candidate Search

替换：

```text
aiBattle
distance/range heuristic
```

影响：

- 目标选择
- Damage Level
- Task Force
- Reaction
- 卡牌选择

这是整体收益最高的一项。

---

## 2. 真实 Unit Reachability

建立：

```js
queryGroundReachability(...)
queryCombatParticipation(...)
```

彻底停止用：

```js
get_distance(...)
```

判断单位能不能打目标。

---

## 3. `GROUND_CAN_ENTER_EXIT`

这是 Page 5 / 11 中非常具体、现在实现偏差很大的条件。

应独立完成完整状态查询。

---

## 4. Battle Support Standard

把：

```text
兵种构成
```

与：

```text
Damage Level
```

彻底拆开。

---

## 5. Damage Level + 2x Ground Survival

真正决定：

> “这支攻击部队够不够。”

不能只计算一个大概攻击力阈值。

---

## 6. Reaction Force Standard

完成：

```text
Air/Sea 1x
Air unit count
D10
Ground 2x
Minimum units
```

之后反应 AI 才能真正符合 Erasmus 图表。

---

# 十三、建议最终完成标准

只有同时满足以下条件，才建议将 Erasmus v2.0 标记为“规则代码化完成”。

### 规则层

- 所有合法性判断来自 RTT engine/query
- 无简单距离替代移动合法性
- 无 `aiBattle` 替代反应合法性
- 无 `resource` 替代 SR
- 无 placeholder false 冒充已实现 predicate

### 图表层

- 12 张主流程图全部走真实 predicate
- 258 个 node 都有 fidelity 标记
- 所有核心条件有 source mapping

### 测试层

- 每个 P0/P1 predicate 有 golden tests
- Query 与 RTT 合法 action 交叉验证
- Campaign regression 20/50 局无崩溃
- `traceNodeMissing = 0`
- `fallback` 可解释
- `unexplainedNoBattle = 0` 或每例都有明确原因

### 工程层

- Erasmus 不复制 RTT 规则
- Query 层只读
- deterministic
- 所有 heuristic 都显式标记
- documentation 与代码实现同步

---

# 十四、结论

当前项目已经具备较完整的 Erasmus 状态机、图表节点、任务部队规划、反应规划和 Campaign 自对弈框架。

当前最大的剩余问题不是：

> “还有多少 node 没有写代码”

而是：

> **一部分 node 虽然有 predicate、有代码、有 trace，但其规则语义仍是 heuristic / proxy，而不是 RTT 规则引擎意义上的 exact implementation。**

因此后续工作重点应从：

```text
继续增加 if/else
```

转为：

```text
把 Erasmus predicate 接到 RTT Rules Query
↓
建立真实合法候选集合
↓
Erasmus 只负责优先级决策
↓
为每个关键条件建立 golden test
↓
重做 fidelity audit
```

这也是将当前实现从“能完整跑完游戏的 Erasmus Bot”提升为“严格按照 Erasmus v2.0 决策图执行的规则型 Bot”的关键路径。
