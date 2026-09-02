# ERASMUS-AP-11（第 11 页）

- 阵营：Allies
- 阶段：all
- 类型：task-force
- 来源：伊拉斯谟v2.0_图表汉化.pdf，第 11 页
- 机器文档：data/erasmus/pages/page-11.json

## 节点与边

| 节点 | 类型/谓词 | 置信度 | 出边 |
| --- | --- | --- | --- |
| ERASMUS-AP-11-START | start | confirmed | always -> ERASMUS-AP-11-C01 |
| ERASMUS-AP-11-C01 | condition predicate=TARGET_IS_SEACOAST_OR_ISLAND | inferred | true -> ERASMUS-AP-11-S01; false -> ERASMUS-AP-11-C02 |
| ERASMUS-AP-11-C02 | condition predicate=CAN_GROUND_ADVANCE | inferred | true -> ERASMUS-AP-11-S02; false -> ERASMUS-AP-11-C03 |
| ERASMUS-AP-11-C03 | condition predicate=TARGET_EMPTY | inferred | true -> ERASMUS-AP-11-S03; false -> ERASMUS-AP-11-C04 |
| ERASMUS-AP-11-C04 | condition predicate=TARGET_ONLY_ENEMY_NAVAL | inferred | true -> ERASMUS-AP-11-S04; false -> ERASMUS-AP-11-C05 |
| ERASMUS-AP-11-C05 | condition predicate=GROUND_CAN_ENTER_EXIT | inferred | true -> ERASMUS-AP-11-S05; false -> ERASMUS-AP-11-C06 |
| ERASMUS-AP-11-C06 | condition predicate=TARGET_IS_SR | inferred | true -> ERASMUS-AP-11-S06; false -> ERASMUS-AP-11-C07 |
| ERASMUS-AP-11-C07 | condition predicate=ENEMY_AIR_CAN_REACT | inferred | true -> ERASMUS-AP-11-S07; false -> ERASMUS-AP-11-C08 |
| ERASMUS-AP-11-C08 | condition predicate=HAS_SUPPORT_POINTS | inferred | true -> ERASMUS-AP-11-S01; false -> ERASMUS-AP-11-C09 |
| ERASMUS-AP-11-C09 | condition predicate=DAMAGE_LEVEL_MET | inferred | true -> ERASMUS-AP-11-S02; false -> ERASMUS-AP-11-C10 |
| ERASMUS-AP-11-C10 | condition predicate=ENEMY_NAVAL_GROUND_CAN_REACT | inferred | true -> ERASMUS-AP-11-S03; false -> ERASMUS-AP-11-C11 |
| ERASMUS-AP-11-C11 | condition predicate=IS_EC_OFFENSIVE | inferred | true -> ERASMUS-AP-11-S04; false -> ERASMUS-AP-11-C12 |
| ERASMUS-AP-11-C12 | condition predicate=IS_LAST_TARGET | inferred | true -> ERASMUS-AP-11-S05; false -> ERASMUS-AP-11-SELECT |
| ERASMUS-AP-11-S01 | action | inferred | always -> ERASMUS-AP-11-END |
| ERASMUS-AP-11-S02 | action | inferred | always -> ERASMUS-AP-11-END |
| ERASMUS-AP-11-S03 | action | inferred | always -> ERASMUS-AP-11-END |
| ERASMUS-AP-11-S04 | action | inferred | always -> ERASMUS-AP-11-END |
| ERASMUS-AP-11-S05 | action | inferred | always -> ERASMUS-AP-11-END |
| ERASMUS-AP-11-S06 | action | inferred | always -> ERASMUS-AP-11-END |
| ERASMUS-AP-11-S07 | action | inferred | always -> ERASMUS-AP-11-END |
| ERASMUS-AP-11-SELECT | priority | inferred | candidate_found -> ERASMUS-AP-11-END; no_candidate -> ERASMUS-AP-11-FALLBACK |
| ERASMUS-AP-11-FALLBACK | fallback | inferred | - |
| ERASMUS-AP-11-END | terminal | confirmed | - |

## 策略出口

1. **AP_AIR_STRIKE**
2. **AP_AIR_SUPPORT_GROUND**
3. **AP_AIR_SEA_GROUND**
4. **AP_SEA_SUPPORT_LANDING**
5. **AP_AIR_SEA_LANDING**
6. **AP_GROUND_ADVANCE**
7. **AP_UNSUPPORTED_LANDING**

## 审校

本页节点中的 inferred 表示依据 PDF 视觉内容与规则语义推断，必须在黄金路径测试中复核。
