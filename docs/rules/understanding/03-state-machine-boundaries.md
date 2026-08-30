# 状态机边界初稿

## 建议的层级状态机

```text
Game
└─ Turn
   ├─ StrategicPhase
   │  ├─ Reinforcement
   │  ├─ Replacement
   │  ├─ StrategicWarfare
   │  └─ DrawCards
   ├─ OffensivesPhase
   │  ├─ Initiative
   │  └─ ActionRound*
   │     ├─ SelectCardOrPass
   │     ├─ DeclareOCOrEC
   │     ├─ SelectHQAndActivate
   │     ├─ OffensiveMovement
   │     ├─ DeclareBattleHexes
   │     ├─ IntelligenceAndReaction
   │     ├─ ResolveBattles
   │     └─ PostBattleAndCleanup
   ├─ PoliticalPhase
   ├─ AttritionPhase
   └─ EndTurnPhase
```

## 设计原则

- 阶段状态机只负责流程和优先权，不直接决定策略。
- 合法动作生成器读取当前状态并返回有限动作集合。
- 状态转移器只接受合法动作，产生新状态和领域事件。
- AI 只能从合法动作集合中选择，不得直接修改状态。
- 反应牌、特殊反应和战斗内选择以可嵌套的 `decision_window` 表示。
- 每个决策点都应支持人类、伊拉斯谟或学习型策略互换。

## 最小动作契约

每个动作至少包含：

- `action_id`：在当前状态内稳定且唯一。
- `actor`：有权行动的阵营或系统。
- `type`：动作类别。
- `parameters`：卡牌、单位、路径、目标格或打击值分配。
- `rule_refs`：支持该动作的规则编号。
- `public_summary`：公开日志文本。

执行结果至少包含新状态、领域事件、随机事件记录和下一个决策窗口。
