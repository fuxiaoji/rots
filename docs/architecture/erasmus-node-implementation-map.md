# 伊拉斯谟节点到引擎实现映射

> 本文件由 `node tools/rules/build_erasmus_implementation_map.js` 生成。它回答‘逻辑节点由哪段代码执行’，不替代 PDF 节点视觉坐标。坐标请填写 `docs/rules/normalized/erasmus-v2-zh-charts/node-regions.csv`。

- 策略版本：`erasmus-v2.0-zh.20`
- 图表：12 张
- 节点：258 个
- 实现分类：implemented-by-family=36，implemented-specialized=213，implemented-generic=9

## 执行链

`规则状态 → rules.view(role) → view.ai 派生字段/谓词 → 图表或专用求值器 → 候选过滤/排序 → view.actions 合法性校验 → rules.action → 回放与 AI trace`

## 第 1 页 · ERASMUS-JP-01

| 节点 | 类型 | 谓词/策略 | 中文标签 | 实现入口 | 状态 |
|---|---|---|---|---|---|
| JP01-START | start | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| JP01-A | condition | AP_HQ_OOS_PHI_DEI_MALAYA | 菲律宾、东印度或马来亚的盟军HQ断补？ | js/server/erasmus_state.js:esm_jp_eval_early | implemented-specialized |
| JP01-B | condition | DEI_SURRENDER_HEXES_ALL_OCCUPIED | 东印度投降格全部占领？ | js/server/erasmus_state.js:esm_jp_eval_early | implemented-specialized |
| JP01-CD | condition | JP_HAND_GE_3_AND_RES_LT_13 | C+D？ | js/server/erasmus_state.js:esm_jp_eval_early | implemented-specialized |
| JP01-F | condition | JP_LOGISTICS_GTE_20 | 后勤值≥20？ | js/server/erasmus_state.js:esm_jp_eval_early | implemented-specialized |
| JP01-G | condition | TURN_GE_3 | 第3回合或以后？ | js/server/erasmus_state.js:esm_jp_eval_early | implemented-specialized |
| JP01-ACD | condition | A_AND_HAND_GE_3_AND_RES_LT_13 | A+C+D？ | js/server/erasmus_state.js:esm_jp_eval_early | implemented-specialized |
| JP01-CEHI | condition | HAND_GE_3_AND_RES_GE_13_OR_LOGISTICS_LE_19_AND_DEI_AZOI | C+(E或H+I)？ | js/server/erasmus_state.js:esm_jp_eval_early | implemented-specialized |
| JP01-CJEBIK | condition | HAND_GE_3_AND_RABAUL_GUADALCANAL_AND_RES_GE_13_AND_DEI_OR_NG | C+J+E+(B或I或K)？ | js/server/erasmus_state.js:esm_jp_eval_early | implemented-specialized |
| JP01-CL | condition | HAND_GE_3_AND_MAL_PHI_DEI_INCOMPLETE | C+L？ | js/server/erasmus_state.js:esm_jp_eval_early | implemented-specialized |
| JP01-M | condition | PERIMETER_TARGET_1_COMPLETE | 外围防御目标1完成？ | js/server/erasmus_state.js:esm_jp_eval_early | implemented-specialized |
| JP01-D10 | dice | — | 掷D10 | js/server/bots/erasmus.js:evaluateChart | implemented-generic |
| JP01-S-AGGRESSIVE-AIR | action | — | 激进空优 | js/server/erasmus_state.js:esm_jp_eval_early | implemented-specialized |
| JP01-S-CONSERVATIVE-AIR | action | — | 保守空优 | js/server/erasmus_state.js:esm_jp_eval_early | implemented-specialized |
| JP01-S-AGGRESSIVE-RESOURCE | action | — | 激进南方资源 | js/server/erasmus_state.js:esm_jp_eval_early | implemented-specialized |
| JP01-S-PERIMETER | action | — | 外围防御 | js/server/erasmus_state.js:esm_jp_eval_early | implemented-specialized |
| JP01-S-EVENT | action | — | 事件 | js/server/erasmus_state.js:esm_jp_eval_early | implemented-specialized |
| JP01-S-CENTRAL-PACIFIC | action | — | 中太平洋 | js/server/erasmus_state.js:esm_jp_eval_early | implemented-specialized |
| JP01-FALLBACK | fallback | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| JP01-END | terminal | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |

## 第 2 页 · ERASMUS-JP-02

| 节点 | 类型 | 谓词/策略 | 中文标签 | 实现入口 | 状态 |
|---|---|---|---|---|---|
| JP02-START | start | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| JP02-A | condition | JP_HAND_GE_3 | 手牌≥3？ | js/server/erasmus_state.js:esm_jp_eval_mid | implemented-specialized |
| JP02-B | condition | JP_CAN_PASS | 可以PASS？ | js/server/erasmus_state.js:esm_jp_eval_mid | implemented-specialized |
| JP02-C | condition | JP_RESOURCE_COUNT_LT_13 | 资源格<13？ | js/server/erasmus_state.js:esm_jp_eval_mid | implemented-specialized |
| JP02-D | condition | JP_LOGISTICS_GTE_20 | 后勤值≥20？ | js/server/erasmus_state.js:esm_jp_eval_mid | implemented-specialized |
| JP02-E | condition | US_POLITICAL_WILL_LT_4 | 美国政治意志<4？ | js/server/erasmus_state.js:esm_jp_eval_mid | implemented-specialized |
| JP02-G | condition | JP_LOGISTICS_GTE_15 | 后勤值≥15？ | js/server/erasmus_state.js:esm_jp_eval_mid | implemented-specialized |
| JP02-F | condition | BURMA_SURRENDERED | 缅甸投降？ | js/server/erasmus_state.js:esm_jp_eval_mid | implemented-specialized |
| JP02-HIJ | condition | GANDHI_OR_MORE_LARGE_STEPS_AND_LOGISTICS_GTE_18 | 甘地或缅甸大军力步数优势，且后勤≥18？ | js/server/erasmus_state.js:esm_jp_eval_mid | implemented-specialized |
| JP02-S-PASS | action | — | PASS | js/server/erasmus_state.js:esm_jp_eval_mid | implemented-specialized |
| JP02-S-EVENT | action | — | 事件 | js/server/erasmus_state.js:esm_jp_eval_mid | implemented-specialized |
| JP02-S-RESOURCE | action | — | 资源 | js/server/erasmus_state.js:esm_jp_eval_mid | implemented-specialized |
| JP02-S-CENTRAL-PACIFIC | action | — | 中太平洋 | js/server/erasmus_state.js:esm_jp_eval_mid | implemented-specialized |
| JP02-S-CBI | action | — | 中缅印 | js/server/erasmus_state.js:esm_jp_eval_mid | implemented-specialized |
| JP02-S-INDIA | action | — | 印度 | js/server/erasmus_state.js:esm_jp_eval_mid | implemented-specialized |
| JP02-S-PERIMETER | action | — | 外围防御 | js/server/erasmus_state.js:esm_jp_eval_mid | implemented-specialized |
| JP02-FALLBACK | fallback | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| JP02-END | terminal | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |

## 第 3 页 · ERASMUS-JP-03

| 节点 | 类型 | 谓词/策略 | 中文标签 | 实现入口 | 状态 |
|---|---|---|---|---|---|
| JP03-START | start | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| JP03-A | condition | JP_HAND_GE_3 | 手牌≥3？ | js/server/erasmus_state.js:esm_jp_eval_late | implemented-specialized |
| JP03-BC | condition | TOKYO_8_PORTS_AND_TOKYO_5_AIRFIELDS_GARRISONED | 东京8格港口和5格机场均有驻军？ | js/server/erasmus_state.js:esm_jp_eval_late | implemented-specialized |
| JP03-D | condition | JP_CAN_PASS | 可以PASS？ | js/server/erasmus_state.js:esm_jp_eval_late | implemented-specialized |
| JP03-E | condition | ALLIED_GROUND_ON_HONSHU | 盟军地面单位在本州？ | js/server/erasmus_state.js:esm_jp_eval_late | implemented-specialized |
| JP03-S-EVENT | action | — | 事件 | js/server/erasmus_state.js:esm_jp_eval_late | implemented-specialized |
| JP03-S-FINAL-PERIMETER | action | — | 最终国防圈 | js/server/erasmus_state.js:esm_jp_eval_late | implemented-specialized |
| JP03-S-PASS | action | — | PASS | js/server/erasmus_state.js:esm_jp_eval_late | implemented-specialized |
| JP03-S-FINAL-DEFENSE | action | — | 最终防御 | js/server/erasmus_state.js:esm_jp_eval_late | implemented-specialized |
| JP03-FALLBACK | fallback | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| JP03-END | terminal | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |

## 第 4 页 · ERASMUS-JP-04

| 节点 | 类型 | 谓词/策略 | 中文标签 | 实现入口 | 状态 |
|---|---|---|---|---|---|
| JP04-START | start | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| JP04-A | condition | JP_CARD_ALREADY_PLAYED | 攻势阶段有打出过牌？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-CLASSIFY | process | — | 卡牌分类 | js/server/erasmus_state.js:classifyCards | implemented-specialized |
| JP04-B | condition | JP_HAND_GT_2 | 当前手牌大于2张？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-C | condition | JP_FIRST_GAME_CARD | 本场第一张牌？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-D | condition | JP_HAS_FIRST_STRIKE_EVENT | 有先发打击牌？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-E | condition | JP_HAS_UNRESTRICTED_MILITARY_EVENT | 有可执行的不受限军事事件？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-F | condition | JP_HAS_RESTRICTED_MILITARY_EVENT | 有可执行的受限军事事件？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-G | condition | JP_ALL_MILITARY_EVENTS_RESTRICTED | 所有有效军事事件均因限制不能达成目标？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-H | condition | JP_FO_SELECTED | 本回合已选择未来攻势？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-I | condition | JP_EARLY_DEI_TARGET_OCCUPIED | 早期东印度目标都占领？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-J | condition | JP_LAST_CARD | 只剩1张牌？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-K | condition | JP_LAST_PLAYABLE_IS_REACTION | 剩下可用事件牌是反应牌？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-S-FIRST | action | — | 先发打击EC | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-S-UNRESTRICTED-EC | action | — | 无限制军事事件EC | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-S-RESTRICTED-EC | action | — | 受限军事事件EC | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-S-RESTRICTED-OC | action | — | 受限军事事件OC | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-S-NONMIL-OC | action | — | 无军事事件OC | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-S-FO | action | — | 未来攻势 | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-S-EVENT | action | — | 事件战略 | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| JP04-FALLBACK | fallback | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| JP04-END | terminal | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |

## 第 5 页 · ERASMUS-JP-05

| 节点 | 类型 | 谓词/策略 | 中文标签 | 实现入口 | 状态 |
|---|---|---|---|---|---|
| JP05-START | start | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| JP05-A | condition | IS_AIR_STRIKE | 对目标的海空攻击？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| JP05-B | condition | TARGET_IS_SEACOAST_OR_ISLAND | 目标沿岸或岛屿？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| JP05-C | condition | CAN_GROUND_ADVANCE | 能否地面推进占领？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| JP05-DOR-EF | condition | TARGET_EMPTY_OR_NAVAL_AND_GROUND_CAN_EXIT | D或(E+F)？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| JP05-D1 | condition | TARGET_EMPTY | 目标为空？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| JP05-D2 | condition | TARGET_EMPTY | 目标为空？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| JP05-G | condition | TARGET_IS_SR | 潜在SR格？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| JP05-H | condition | ENEMY_AIR_OR_CARRIER_CAN_REACT | 敌空军或航母可反应？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| JP05-S-AIR | process | — | 航空打击 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| JP05-S-AIR-GROUND | process | — | 带航空支援地面攻击 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| JP05-S-AIRSEA-GROUND | process | — | 带航空/海上支援地面攻击 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| JP05-S-SEA-LANDING | process | — | 带海上支援登陆 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| JP05-S-AIRSEA-LANDING | process | — | 带航空/海上支援登陆 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| JP05-S-UNSUPPORTED-LANDING | process | — | 无支援登陆 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| JP05-S-TARGET | action | — | — | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| JP05-ACTIVATE | action | — | — | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| JP05-I | condition | FORCE_MEETS_BATTLE_SUPPORT_STANDARD | 激活点满足战斗支援标准？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| JP05-J | condition | TARGET_DAMAGE_LEVEL_MET | 目标伤害等级达到？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| JP05-D10 | dice | — | 掷D10 | js/server/bots/erasmus.js:evaluateChart | implemented-generic |
| JP05-S-WEAKEST | action | — | 攻击最弱堆叠 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| JP05-S-MOVE | action | — | — | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| JP05-KL | condition | ENEMY_CAN_REACT_AND_IS_EC | K+L？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| JP05-M | condition | IS_LAST_TARGET | 最后目标？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| JP05-S-SUPPRESS | action | — | 考虑压制攻击 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| JP05-S-EXTRA | action | — | 用额外激活点激活更多单位 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| JP05-S-NEXT | action | — | 为下一目标编成新任务部队 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| JP05-FALLBACK | fallback | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| JP05-END | terminal | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |

## 第 6 页 · ERASMUS-JP-06

| 节点 | 类型 | 谓词/策略 | 中文标签 | 实现入口 | 状态 |
|---|---|---|---|---|---|
| JP06-START | start | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| JP06-A | condition | WEATHER_CARD_AVAILABLE | 天气牌可用？ | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| JP06-B | condition | WEATHER_STANDARD_MET | 满足天气牌标准？ | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| JP06-S-WEATHER | action | — | 天气反应 | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| JP06-C | condition | IS_STRATEGIC_REDEPLOYMENT | 有SR？ | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| JP06-S-SR | action | — | 为每处SR掷骰 | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| JP06-D | condition | HAS_BATTLE | 有战斗格？ | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| JP06-EFG | condition | BATTLE_IN_HQ_RANGE_AND_REACTION_CARD | E+(F或G)？ | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| JP06-D10 | dice | — | 情报判定 | js/server/bots/erasmus.js:evaluateChart | implemented-generic |
| JP06-S-INTEL-CARD | action | — | 打出情报反应牌 | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| JP06-S-INTEL-ROLL | action | — | — | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| JP06-H | condition | REACTION_FORCE_STANDARD_MET | 满足反应部队标准？ | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| JP06-RF-D10 | dice | — | 日本反应兵力D10（图示1-4/5-9；0按低段） | js/server/bots/erasmus.js:evaluateChart | implemented-generic |
| JP06-S-REACTION | action | — | 反应战略 | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| JP06-IJ | condition | EARLY_DEFENSE_DONE_AND_KAMIKAZE_STANDARD | I+J？ | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| JP06-S-KAMIKAZE | action | — | 神风特攻 | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| JP06-KL | condition | HAS_SUBMARINE_CARD_AND_TARGET | K+L？ | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| JP06-S-SUB | action | — | 潜艇攻击 | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| JP06-S-PBM | process | — | 如果可以的话执行PBM | js/server/erasmus_ops.js:planPostBattleMovement + js/server/offensive.js:erasmus_pbm_target_score | implemented-specialized |
| JP06-PBM-A | condition | PBM_AIR_REQUIRED | 空中单位需要PBM？ | js/server/erasmus_ops.js:planPostBattleMovement + js/server/offensive.js:erasmus_pbm_target_score | implemented-specialized |
| JP06-PBM-B | condition | PBM_SEA_REQUIRED | 海上单位需要PBM？ | js/server/erasmus_ops.js:planPostBattleMovement + js/server/offensive.js:erasmus_pbm_target_score | implemented-specialized |
| JP06-PBM-C | condition | PBM_AA_FAILED | 失败两栖单位需要PBM？ | js/server/erasmus_ops.js:planPostBattleMovement + js/server/offensive.js:erasmus_pbm_target_score | implemented-specialized |
| JP06-S-PBM-AIR | action | — | 航空PBM | js/server/erasmus_ops.js:planPostBattleMovement + js/server/offensive.js:erasmus_pbm_target_score | implemented-specialized |
| JP06-S-PBM-SEA | action | — | 海上PBM | js/server/erasmus_ops.js:planPostBattleMovement + js/server/offensive.js:erasmus_pbm_target_score | implemented-specialized |
| JP06-S-PBM-AA | action | — | AA失败PBM | js/server/erasmus_ops.js:planPostBattleMovement + js/server/offensive.js:erasmus_pbm_target_score | implemented-specialized |
| JP06-FALLBACK | fallback | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| JP06-END | terminal | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |

## 第 7 页 · ERASMUS-AP-07

| 节点 | 类型 | 谓词/策略 | 中文标签 | 实现入口 | 状态 |
|---|---|---|---|---|---|
| AP07-START | start | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| AP07-A | condition | AP_HAND_GE_3 | 手牌≥3？ | js/server/erasmus_state.js:esm_al_eval_early | implemented-specialized |
| AP07-B | condition | SUPPLIED_HQ_IN_PHILIPPINES | 菲律宾有补给HQ？ | js/server/erasmus_state.js:esm_al_eval_early | implemented-specialized |
| AP07-C | condition | SUPPLIED_HQ_IN_MALAYA | 马来亚有补给HQ？ | js/server/erasmus_state.js:esm_al_eval_early | implemented-specialized |
| AP07-D | condition | ARCADIA_PLAYED | Arcadia已打出？ | js/server/erasmus_state.js:esm_al_eval_early | implemented-specialized |
| AP07-E | condition | CBI_DEFENSE_COMPLETE | CBI防御完成？ | js/server/erasmus_state.js:esm_al_eval_early | implemented-specialized |
| AP07-FG | condition | HAS_PASS_AND_ONE_CARD_LEFT | 有PASS且只剩一张牌？ | js/server/erasmus_state.js:esm_al_eval_early | implemented-specialized |
| AP07-JKLMN | condition | ORANGE_PLAN_CRITERIA | 橙色计划条件全部满足？ | js/server/erasmus_state.js:esm_al_eval_early | implemented-specialized |
| AP07-OP | condition | DEI_NOT_SURRENDERED_AND_ABDA_SUPPLIED | DEI未投降且ABDA有补给？ | js/server/erasmus_state.js:esm_al_eval_early | implemented-specialized |
| AP07-S-EVENT | action | — | 事件 | js/server/erasmus_state.js:esm_al_eval_early | implemented-specialized |
| AP07-S-EVAC-PHILIPPINES | action | — | 撤离菲律宾 | js/server/erasmus_state.js:esm_al_eval_early | implemented-specialized |
| AP07-S-EVAC-MALAYA | action | — | 撤离马来亚 | js/server/erasmus_state.js:esm_al_eval_early | implemented-specialized |
| AP07-S-ABDA | action | — | 建立ABDA | js/server/erasmus_state.js:esm_al_eval_early | implemented-specialized |
| AP07-S-CBI | action | — | 增强CBI防御 | js/server/erasmus_state.js:esm_al_eval_early | implemented-specialized |
| AP07-S-PASS | action | — | PASS | js/server/erasmus_state.js:esm_al_eval_early | implemented-specialized |
| AP07-S-ORANGE | action | — | 橙色计划 | js/server/erasmus_state.js:esm_al_eval_early | implemented-specialized |
| AP07-S-DEI | action | — | DEI防御 | js/server/erasmus_state.js:esm_al_eval_early | implemented-specialized |
| AP07-S-OFFENSIVE | action | — | 攻势进攻 | js/server/erasmus_state.js:esm_al_eval_early | implemented-specialized |
| AP07-FALLBACK | fallback | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| AP07-END | terminal | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |

## 第 8 页 · ERASMUS-AP-08

| 节点 | 类型 | 谓词/策略 | 中文标签 | 实现入口 | 状态 |
|---|---|---|---|---|---|
| AP08-START | start | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| AP08-A | condition | AP_CAN_PASS | 可以PASS？ | js/server/erasmus_state.js:esm_al_eval_mid | implemented-specialized |
| AP08-B | condition | AP_NEEDS_PROGRESS_OF_WAR | 需要满足战争进程？ | js/server/erasmus_state.js:esm_al_eval_mid | implemented-specialized |
| AP08-C | condition | AP_HAND_GE_3 | 手牌≥3？ | js/server/erasmus_state.js:esm_al_eval_mid | implemented-specialized |
| AP08-D | condition | JP_CONTROLS_COUNTERATTACK_TARGET | 日本控制反攻目标？ | js/server/erasmus_state.js:esm_al_eval_mid | implemented-specialized |
| AP08-D10 | dice | — | 掷D10；不可执行则重掷 | js/server/bots/erasmus.js:evaluateChart | implemented-generic |
| AP08-S-PASS | action | — | PASS | js/server/erasmus_state.js:esm_al_eval_mid | implemented-specialized |
| AP08-S-EVENT | action | — | 事件 | js/server/erasmus_state.js:esm_al_eval_mid | implemented-specialized |
| AP08-S-COUNTEROFFENSIVE | action | — | 反攻 | js/server/erasmus_state.js:esm_al_eval_mid | implemented-specialized |
| AP08-S-SOUTH-PACIFIC | action | — | 南太平洋 | js/server/erasmus_state.js:esm_al_eval_mid | implemented-specialized |
| AP08-S-CENTRAL-PACIFIC | action | — | 中太平洋 | js/server/erasmus_state.js:esm_al_eval_mid | implemented-specialized |
| AP08-S-DEI | action | — | DEI | js/server/erasmus_state.js:esm_al_eval_mid | implemented-specialized |
| AP08-S-CBI | action | — | CBI | js/server/erasmus_state.js:esm_al_eval_mid | implemented-specialized |
| AP08-FALLBACK | fallback | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| AP08-END | terminal | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |

## 第 9 页 · ERASMUS-AP-09

| 节点 | 类型 | 谓词/策略 | 中文标签 | 实现入口 | 状态 |
|---|---|---|---|---|---|
| AP09-START | start | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| AP09-A | condition | AP_CAN_PASS | 可以PASS？ | js/server/erasmus_state.js:esm_al_eval_late | implemented-specialized |
| AP09-B | condition | TURN_12 | 第12回合？ | js/server/erasmus_state.js:esm_al_eval_late | implemented-specialized |
| AP09-C | condition | AP_HAND_GE_3 | 手牌≥3？ | js/server/erasmus_state.js:esm_al_eval_late | implemented-specialized |
| AP09-D | condition | AP_HAS_STRATEGIC_BOMBING_BASE | 拥有战略轰炸基地？ | js/server/erasmus_state.js:esm_al_eval_late | implemented-specialized |
| AP09-E | condition | ALL_MAP_B29_ON_BASE | 地图上所有B-29均在基地？ | js/server/erasmus_state.js:esm_al_eval_late | implemented-specialized |
| AP09-F | condition | AP_CONTROLS_HEX_WITHIN_TOKYO_8 | 控制东京8格内格？ | js/server/erasmus_state.js:esm_al_eval_late | implemented-specialized |
| AP09-D10 | dice | — | 掷D10 | js/server/bots/erasmus.js:evaluateChart | implemented-generic |
| AP09-G | condition | AP_MEETS_ATOMIC_BOMB_STRATEGY_CRITERIA | 满足原子弹战略标准？ | js/server/erasmus_state.js:esm_al_eval_late | implemented-specialized |
| AP09-S-PASS | action | — | PASS | js/server/erasmus_state.js:esm_al_eval_late | implemented-specialized |
| AP09-S-EVENT | action | — | 事件 | js/server/erasmus_state.js:esm_al_eval_late | implemented-specialized |
| AP09-S-CAPTURE-BOMBING-BASE | action | — | 占领轰炸基地 | js/server/erasmus_state.js:esm_al_eval_late | implemented-specialized |
| AP09-S-PUSH-B29 | action | — | 推进B-29 | js/server/erasmus_state.js:esm_al_eval_late | implemented-specialized |
| AP09-S-RETURN-PHILIPPINES | action | — | 重返菲律宾 | js/server/erasmus_state.js:esm_al_eval_late | implemented-specialized |
| AP09-S-ISLAND-HOPPING | action | — | 跳岛 | js/server/erasmus_state.js:esm_al_eval_late | implemented-specialized |
| AP09-S-ALTERNATE | action | — | 轮流 | js/server/erasmus_state.js:esm_al_eval_late | implemented-specialized |
| AP09-S-ATOMIC | action | — | 原子弹胜利 | js/server/erasmus_state.js:esm_al_eval_late | implemented-specialized |
| AP09-S-INVADE-JAPAN | action | — | 登陆日本 | js/server/erasmus_state.js:esm_al_eval_late | implemented-specialized |
| AP09-FALLBACK | fallback | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| AP09-END | terminal | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |

## 第 10 页 · ERASMUS-AP-10

| 节点 | 类型 | 谓词/策略 | 中文标签 | 实现入口 | 状态 |
|---|---|---|---|---|---|
| AP10-START | start | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| AP10-A | condition | AP_CARD_ALREADY_PLAYED | 攻势阶段有打出过牌？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-CLASSIFY | process | — | 卡牌分类 | js/server/erasmus_state.js:classifyCards | implemented-specialized |
| AP10-LM | condition | AP_CHINA_WITHIN_2_AND_EVENT_AVAILABLE | 中国距崩溃≤2且有可用中国事件？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-S-CHINA | action | — | 打出中国事件牌 | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-B | condition | AP_HAND_GT_2 | 当前手牌大于2张？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-C | condition | AP_FIRST_GAME_CARD | 本场第一张牌？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-D | condition | AP_HAS_FLINTLOCK_OR_SHOESTRING | 有先发打击牌？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-E | condition | AP_HAS_UNRESTRICTED_MILITARY_EVENT | 有可执行的不受限军事事件？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-F | condition | AP_HAS_RESTRICTED_MILITARY_EVENT | 有可执行的受限军事事件？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-G | condition | AP_ALL_MILITARY_EVENTS_RESTRICTED | 所有有效军事事件均因限制不能达成目标？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-H | condition | AP_FO_SELECTED | 本回合已选择未来攻势？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-I | condition | CBI_DEFENSE_COMPLETE | 早期CBI防御完成？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-J | condition | AP_LAST_CARD | 只剩1张牌？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-K | condition | AP_LAST_PLAYABLE_IS_REACTION | 剩下可用事件牌是反应牌？ | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-S-FIRST | action | — | 先发打击EC | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-S-UNRESTRICTED-EC | action | — | 无限制军事事件EC | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-S-RESTRICTED-EC | action | — | 受限军事事件EC | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-S-RESTRICTED-OC | action | — | 受限军事事件OC | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-S-NONMIL-OC | action | — | 无军事事件OC | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-S-FO | action | — | 未来攻势 | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-S-EVENT | action | — | 事件战略 | js/server/erasmus_state.js:esm_card_selection_tree | implemented-specialized |
| AP10-FALLBACK | fallback | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| AP10-END | terminal | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |

## 第 11 页 · ERASMUS-AP-11

| 节点 | 类型 | 谓词/策略 | 中文标签 | 实现入口 | 状态 |
|---|---|---|---|---|---|
| AP11-START | start | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| AP11-A | condition | IS_AIR_STRIKE | 对目标的海空攻击？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| AP11-B | condition | TARGET_IS_SEACOAST_OR_ISLAND | 目标沿岸或岛屿？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| AP11-C | condition | CAN_GROUND_ADVANCE | 能否地面推进占领？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| AP11-DOR-EF | condition | TARGET_EMPTY_OR_NAVAL_AND_GROUND_CAN_EXIT | D或(E+F)？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| AP11-D1 | condition | TARGET_EMPTY | 目标为空？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| AP11-D2 | condition | TARGET_EMPTY | 目标为空？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| AP11-G | condition | TARGET_IS_SR | 潜在SR格？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| AP11-H | condition | ENEMY_AIR_OR_CARRIER_CAN_REACT | 敌空军或航母可反应？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| AP11-S-AIR | process | — | 航空打击 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| AP11-S-AIR-GROUND | process | — | 带航空支援地面攻击 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| AP11-S-AIRSEA-GROUND | process | — | 带航空/海上支援地面攻击 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| AP11-S-SEA-LANDING | process | — | 带海上支援登陆 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| AP11-S-AIRSEA-LANDING | process | — | 带航空/海上支援登陆 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| AP11-S-UNSUPPORTED-LANDING | process | — | 无支援登陆 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| AP11-S-TARGET | action | — | — | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| AP11-ACTIVATE | action | — | — | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| AP11-I | condition | FORCE_MEETS_BATTLE_SUPPORT_STANDARD | 激活点满足战斗支援标准？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| AP11-J | condition | TARGET_DAMAGE_LEVEL_MET | 目标伤害等级达到？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| AP11-D10 | dice | — | 掷D10 | js/server/bots/erasmus.js:evaluateChart | implemented-generic |
| AP11-S-WEAKEST | action | — | 攻击最弱堆叠 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| AP11-S-MOVE | action | — | — | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| AP11-KL | condition | ENEMY_CAN_REACT_AND_IS_EC | K+L？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| AP11-M | condition | IS_LAST_TARGET | 最后目标？ | js/server/game.js:view.ai.predicates + js/server/erasmus_ops.js:evaluateTargetFeasibility | implemented-specialized |
| AP11-S-SUPPRESS | action | — | 考虑压制攻击 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| AP11-S-EXTRA | action | — | 用额外激活点激活更多单位 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| AP11-S-NEXT | action | — | 为下一目标编成新任务部队 | js/server/erasmus_ops.js:composeTaskForce | implemented-specialized |
| AP11-FALLBACK | fallback | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| AP11-END | terminal | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |

## 第 12 页 · ERASMUS-AP-12

| 节点 | 类型 | 谓词/策略 | 中文标签 | 实现入口 | 状态 |
|---|---|---|---|---|---|
| AP12-START | start | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| AP12-A | condition | IS_STRATEGIC_REDEPLOYMENT | 有SR？ | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| AP12-S-SR | action | — | 为每处SR掷骰 | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| AP12-B | condition | HAS_BATTLE | 有战斗格？ | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| AP12-C | condition | BATTLE_IN_SUPPLIED_HQ_RANGE | 补给HQ范围内有战斗格？ | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| AP12-DEF | condition | HAS_INTEL_COUNTER_OR_AMBUSH | D或E或F？ | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| AP12-D10 | dice | — | 情报判定 | js/server/bots/erasmus.js:evaluateChart | implemented-generic |
| AP12-S-INTEL-CARD | action | — | 打出情报反应牌 | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| AP12-S-INTEL-ROLL | action | — | — | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| AP12-G | condition | REACTION_FORCE_STANDARD_MET | 满足反应部队标准？ | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| AP12-RF-D10 | dice | — | 盟军反应兵力D10 | js/server/bots/erasmus.js:evaluateChart | implemented-generic |
| AP12-S-REACTION | action | — | 反应战略 | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| AP12-HI | condition | HAS_SUBMARINE_CARD_AND_TARGET | H+I？ | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| AP12-S-SUB | action | — | 潜艇攻击 | js/server/erasmus_ops.js:planReaction | implemented-specialized |
| AP12-S-PBM | process | — | 如果可以的话执行PBM | js/server/erasmus_ops.js:planPostBattleMovement + js/server/offensive.js:erasmus_pbm_target_score | implemented-specialized |
| AP12-PBM-A | condition | PBM_AIR_REQUIRED | 空中单位需要PBM？ | js/server/erasmus_ops.js:planPostBattleMovement + js/server/offensive.js:erasmus_pbm_target_score | implemented-specialized |
| AP12-PBM-B | condition | PBM_SEA_REQUIRED | 海上单位需要PBM？ | js/server/erasmus_ops.js:planPostBattleMovement + js/server/offensive.js:erasmus_pbm_target_score | implemented-specialized |
| AP12-PBM-C | condition | PBM_AA_FAILED | 失败两栖单位需要PBM？ | js/server/erasmus_ops.js:planPostBattleMovement + js/server/offensive.js:erasmus_pbm_target_score | implemented-specialized |
| AP12-S-PBM-AIR | action | — | 航空PBM | js/server/erasmus_ops.js:planPostBattleMovement + js/server/offensive.js:erasmus_pbm_target_score | implemented-specialized |
| AP12-S-PBM-SEA | action | — | 海上PBM | js/server/erasmus_ops.js:planPostBattleMovement + js/server/offensive.js:erasmus_pbm_target_score | implemented-specialized |
| AP12-S-PBM-AA | action | — | AA失败PBM | js/server/erasmus_ops.js:planPostBattleMovement + js/server/offensive.js:erasmus_pbm_target_score | implemented-specialized |
| AP12-FALLBACK | fallback | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |
| AP12-END | terminal | — | — | js/server/bots/erasmus.js:evaluateChart | implemented-by-family |

## 状态含义

- `implemented-specialized`：该图表族有专用谓词、策略或动作规划器。
- `implemented-generic`：由通用确定性骰表/图遍历代码执行。
- `implemented-by-family`：开始、终点和保护出口由图表族公共解释逻辑执行。

此映射只证明调用路径存在，不单独证明语义与纸面图表完全相同。语义正确性仍由逐节点黄金测试、来源脚注和实战轨迹共同验收。
