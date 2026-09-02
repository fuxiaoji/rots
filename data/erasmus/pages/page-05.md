# ERASMUS-JP-05（第 5 页）

- 阵营：Japan
- 阶段：all
- 类型：task-force
- 来源：伊拉斯谟v2.0_图表汉化.pdf，第 5 页
- 机器文档：data/erasmus/pages/page-05.json

## 节点与边

| 节点 | 类型/谓词 | 置信度 | 出边 |
| --- | --- | --- | --- |
| ERASMUS-JP-05-START | start | confirmed | always -> ERASMUS-JP-05-C01 |
| ERASMUS-JP-05-C01 | condition predicate=TARGET_IS_SEACOAST_OR_ISLAND | inferred | true -> ERASMUS-JP-05-S01; false -> ERASMUS-JP-05-C02 |
| ERASMUS-JP-05-C02 | condition predicate=CAN_GROUND_ADVANCE | inferred | true -> ERASMUS-JP-05-S02; false -> ERASMUS-JP-05-C03 |
| ERASMUS-JP-05-C03 | condition predicate=TARGET_EMPTY | inferred | true -> ERASMUS-JP-05-S03; false -> ERASMUS-JP-05-C04 |
| ERASMUS-JP-05-C04 | condition predicate=TARGET_ONLY_ENEMY_NAVAL | inferred | true -> ERASMUS-JP-05-S04; false -> ERASMUS-JP-05-C05 |
| ERASMUS-JP-05-C05 | condition predicate=GROUND_CAN_ENTER_EXIT | inferred | true -> ERASMUS-JP-05-S05; false -> ERASMUS-JP-05-C06 |
| ERASMUS-JP-05-C06 | condition predicate=TARGET_IS_SR | inferred | true -> ERASMUS-JP-05-S06; false -> ERASMUS-JP-05-C07 |
| ERASMUS-JP-05-C07 | condition predicate=ENEMY_AIR_CAN_REACT | inferred | true -> ERASMUS-JP-05-S07; false -> ERASMUS-JP-05-C08 |
| ERASMUS-JP-05-C08 | condition predicate=HAS_SUPPORT_POINTS | inferred | true -> ERASMUS-JP-05-S01; false -> ERASMUS-JP-05-C09 |
| ERASMUS-JP-05-C09 | condition predicate=DAMAGE_LEVEL_MET | inferred | true -> ERASMUS-JP-05-S02; false -> ERASMUS-JP-05-C10 |
| ERASMUS-JP-05-C10 | condition predicate=ENEMY_NAVAL_GROUND_CAN_REACT | inferred | true -> ERASMUS-JP-05-S03; false -> ERASMUS-JP-05-C11 |
| ERASMUS-JP-05-C11 | condition predicate=IS_EC_OFFENSIVE | inferred | true -> ERASMUS-JP-05-S04; false -> ERASMUS-JP-05-C12 |
| ERASMUS-JP-05-C12 | condition predicate=IS_LAST_TARGET | inferred | true -> ERASMUS-JP-05-S05; false -> ERASMUS-JP-05-SELECT |
| ERASMUS-JP-05-S01 | action | inferred | always -> ERASMUS-JP-05-END |
| ERASMUS-JP-05-S02 | action | inferred | always -> ERASMUS-JP-05-END |
| ERASMUS-JP-05-S03 | action | inferred | always -> ERASMUS-JP-05-END |
| ERASMUS-JP-05-S04 | action | inferred | always -> ERASMUS-JP-05-END |
| ERASMUS-JP-05-S05 | action | inferred | always -> ERASMUS-JP-05-END |
| ERASMUS-JP-05-S06 | action | inferred | always -> ERASMUS-JP-05-END |
| ERASMUS-JP-05-S07 | action | inferred | always -> ERASMUS-JP-05-END |
| ERASMUS-JP-05-SELECT | priority | inferred | candidate_found -> ERASMUS-JP-05-END; no_candidate -> ERASMUS-JP-05-FALLBACK |
| ERASMUS-JP-05-FALLBACK | fallback | inferred | - |
| ERASMUS-JP-05-END | terminal | confirmed | - |

## 策略出口

1. **JP_AIR_STRIKE**
2. **JP_AIR_SUPPORT_GROUND**
3. **JP_AIR_SEA_GROUND**
4. **JP_SEA_SUPPORT_LANDING**
5. **JP_AIR_SEA_LANDING**
6. **JP_GROUND_ADVANCE**
7. **JP_UNSUPPORTED_LANDING**

## 审校

本页节点中的 inferred 表示依据 PDF 视觉内容与规则语义推断，必须在黄金路径测试中复核。
