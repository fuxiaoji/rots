# 伊拉斯谟自然语言到 AI 决策代码

## 目标

图表和脚注不能在运行时直接交给模型“猜着执行”。本项目把自然语言编译成稳定 ID、可计算谓词、候选选择器和显式状态转移；AI 最终仍只能提交 `view.actions` 中的合法动作。

## 七步转换链

1. **保存原文**：在 `data/erasmus/cdss_sources.json` 保存来源文件、SHA-256、段落号和原文，不修改原始证据。
2. **建立稳定节点**：把菱形、处理框、骰表和战略出口写入 `data/erasmus/pages/page-XX.json`，使用 `JP01-A`、`AP12-RF-D10` 等稳定 ID。
3. **命名语义**：条件使用全大写谓词 ID，例如 `US_POLITICAL_WILL_LT_4`；战略和动作使用稳定英文 ID，中文只作显示。
4. **派生阵营视图**：`js/server/game.js` 把规则状态投影为只读 `view.ai`。公开地图、己方卡牌元数据和合法候选可见，对手手牌不可见。
5. **求值与规划**：战略轴由 `erasmus_state.js` 求值；选牌由 `classifyCards`/`esm_card_selection_tree`；编队、反应和 PBM 由 `erasmus_ops.js` 规划；`bots/erasmus.js:evaluateChart` 负责显式边、D10 和轨迹。
6. **合法动作落地**：策略标签不能直接修改状态。它必须被翻译成具体 `{action, argument}`，且 `action` 存在于 `view.actions`、`argument` 属于该动作候选。
7. **执行并审计**：平台调用 `rules.action`，写入 replay、snapshot 和 AI trace；固定种子可复算条件、骰点、候选淘汰和最终动作。

## 三种自然语言结构

### 条件句

原文“美国政治意志小于 4”转换为：

```text
JP02-E
  predicate = US_POLITICAL_WILL_LT_4
  evidence = political_will
  formula = Number(political_will) < 4
  true  -> 图中 YES 出口
  false -> 图中 NO 出口
```

实现时应让谓词返回“值 + 证据”，轨迹至少记录节点、结果和参与计算的数据。未知谓词必须报错或暂停，不能默认为 `false`。

### 优先级/目标表

原文“按菲律宾、新加坡、ABDA 的顺序压制盟军 HQ”转换为有序目标，而不是给地点随意加分：

```js
{
  strategy: "JP_CONSERVATIVE_AIR_SUPERIORITY",
  goals: [
    { kind: "SUPPRESS_HQ", target: "Philippines", damage: 0.25 },
    { kind: "SUPPRESS_HQ", target: "Singapore", damage: 0.5 },
    { kind: "SUPPRESS_HQ", target: "ABDA", damage: 0.5 }
  ]
}
```

执行器先检查最高目标是否已完成以及是否可行，再进入下一个。压制目标按敌方 AZOI 是否仍覆盖判断，不被误译为“占领任意附近岛屿”。夺占目标必须含地面单位；敌控岛屿/港口还要验证两栖运输和海军护航。

### 操作性脚注

原文“为每个目标编成一个任务部队；OC 已指定一个战斗格后，把剩余单位向下一目标前推”转换成跨窗口规划状态：

```text
当前目标 → evaluateTargetFeasibility
          → composeTaskForce（最少但足够）
          → 目标达标但仍有激活量？
             YES: 下一目标任务部队 / 前推地面→航空→海军
             NO: 结束激活
```

这里“任务部队达标”只结束当前目标的编成，不等于结束整次攻势。

## 引擎中可以直接复用的数据

- 卡牌：`cards[]` 的阵营、类型、Ops、后勤值、反应/情报、HQ 限制等元数据。
- 单位：`pieces[]` 的阵营、兵种、战力、减面战力、航程、移动力、ASP 等公开属性。
- 地图：地点名称、港口、机场、资源格、地形、控制方、距离和 AZOI/补给派生量。
- 当前流程：回合、阶段、攻势类型、情报状态、战斗格、已激活单位和 PBM 集合。
- 合法性：`rules.view` 返回的 `view.actions` 是唯一动作白名单。

这些数据解决“事实是什么”；图表节点解决“按什么条件和顺序选择”。两者不能互相替代。

## 代码放置约定

| 自然语言内容 | 代码/数据位置 |
|---|---|
| 图形拓扑、原文、边、骰表 | `data/erasmus/pages/page-XX.json` |
| 战略轴条件和目标链 | `js/server/erasmus_state.js` |
| 己方手牌分类与出牌意图 | `js/server/erasmus_state.js` |
| 目标可行性、任务部队、反应、PBM | `js/server/erasmus_ops.js` |
| 视图字段和公开谓词 | `js/server/game.js` |
| 通用图遍历、确定性骰点、合法动作封装 | `js/server/bots/erasmus.js` |
| 地面/海上移动和 PBM 地点评分 | `js/server/offensive.js` |
| 页面/节点到实现入口索引 | `data/erasmus/node-implementation-map.json` |

## 新增一条规则的最小闭环

1. 在来源数据登记原文、段落和图页。
2. 修改对应页面 JSON 的节点/边，禁止复用含义不同的旧 ID。
3. 条件节点增加 `view.ai` 派生量或专用轴谓词；动作节点增加候选过滤器/排序器。
4. 在 public trace 记录不泄密的证据，在 private trace 记录完整己方候选和淘汰原因。
5. 添加 true/false、边界骰点、目标不可行和合法动作测试。
6. 运行页面/图构建与内联构建，再跑固定种子回归。
7. 更新 `agent.md`、`plan.md`、`havedone.md`，最后提交单一主题变更。

## 禁止做法

- 禁止 `eval` 自然语言或让 LLM 在每步临场解释规则。
- 禁止把未知谓词当 `false` 继续。
- 禁止把策略标签随机映射成第一个合法按钮。
- 禁止从完整 `G` 暴露对手隐藏手牌给机器人。
- 禁止用胜率调参替代图表、脚注和基础规则的忠实实现。

## 当前实现边界

目前六张战略轴及部分目标派生仍在规则模块内部从 `G` 计算，再投影到轨迹；它们已走合法动作链，但尚未全部改造成只接受不可变 `view.ai` 的纯函数。因此，节点实现映射可用于找代码和审计调用路径，却不能作为隐藏信息隔离已经完成的证明。后续安全重构应先把所需公开量/己方私有量固化进 `view.ai`，再让 `erasmus_state.js` 与 `erasmus_ops.js` 脱离全局状态。
