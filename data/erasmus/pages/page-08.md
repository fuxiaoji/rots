# ERASMUS-AP-08（第 8 页）

- 阵营：Allies
- 阶段：middle
- 类型：decision-axis
- 来源：伊拉斯谟v2.0_图表汉化.pdf，第 8 页
- 机器文档：data/erasmus/pages/page-08.json

## 节点与边

| 节点 | 类型/谓词 | 置信度 | 出边 |
| --- | --- | --- | --- |
| ERASMUS-AP-08-START | start | confirmed | always -> ERASMUS-AP-08-C01 |
| ERASMUS-AP-08-C01 | condition predicate=AP_HAS_PASS | inferred | true -> ERASMUS-AP-08-S01; false -> ERASMUS-AP-08-C02 |
| ERASMUS-AP-08-C02 | condition predicate=AP_NEEDS_PROGRESS | inferred | true -> ERASMUS-AP-08-S02; false -> ERASMUS-AP-08-C03 |
| ERASMUS-AP-08-C03 | condition predicate=AP_HAS_3_CARDS | inferred | true -> ERASMUS-AP-08-S03; false -> ERASMUS-AP-08-C04 |
| ERASMUS-AP-08-C04 | condition predicate=JP_TARGET_CONTROLLED | inferred | true -> ERASMUS-AP-08-S04; false -> ERASMUS-AP-08-C05 |
| ERASMUS-AP-08-C05 | condition predicate=AP_PORT_TARGET | inferred | true -> ERASMUS-AP-08-S05; false -> ERASMUS-AP-08-C06 |
| ERASMUS-AP-08-C06 | condition predicate=AP_AIRFIELD_TARGET | inferred | true -> ERASMUS-AP-08-S06; false -> ERASMUS-AP-08-C07 |
| ERASMUS-AP-08-C07 | condition predicate=AP_HAS_ASP | inferred | true -> ERASMUS-AP-08-S01; false -> ERASMUS-AP-08-C08 |
| ERASMUS-AP-08-C08 | condition predicate=AP_CAN_ATTACK | inferred | true -> ERASMUS-AP-08-S02; false -> ERASMUS-AP-08-C09 |
| ERASMUS-AP-08-C09 | condition predicate=AP_CARD_GROUP_ROLL | inferred | true -> ERASMUS-AP-08-S03; false -> ERASMUS-AP-08-SELECT |
| ERASMUS-AP-08-S01 | action | inferred | always -> ERASMUS-AP-08-END |
| ERASMUS-AP-08-S02 | action | inferred | always -> ERASMUS-AP-08-END |
| ERASMUS-AP-08-S03 | action | inferred | always -> ERASMUS-AP-08-END |
| ERASMUS-AP-08-S04 | action | inferred | always -> ERASMUS-AP-08-END |
| ERASMUS-AP-08-S05 | action | inferred | always -> ERASMUS-AP-08-END |
| ERASMUS-AP-08-S06 | action | inferred | always -> ERASMUS-AP-08-END |
| ERASMUS-AP-08-SELECT | priority | inferred | candidate_found -> ERASMUS-AP-08-END; no_candidate -> ERASMUS-AP-08-FALLBACK |
| ERASMUS-AP-08-FALLBACK | fallback | inferred | - |
| ERASMUS-AP-08-END | terminal | confirmed | - |

## 策略出口

1. **AP_PASS**
2. **AP_COUNTEROFFENSIVE**
3. **AP_SOUTH_PACIFIC**
4. **AP_CBI**
5. **AP_DEI**
6. **AP_EVENT**

## 审校

本页节点中的 inferred 表示依据 PDF 视觉内容与规则语义推断，必须在黄金路径测试中复核。
