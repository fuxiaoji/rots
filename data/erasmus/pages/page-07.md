# ERASMUS-AP-07（第 7 页）

- 阵营：Allies
- 阶段：early
- 类型：decision-axis
- 来源：伊拉斯谟v2.0_图表汉化.pdf，第 7 页
- 机器文档：data/erasmus/pages/page-07.json

## 节点与边

| 节点 | 类型/谓词 | 置信度 | 出边 |
| --- | --- | --- | --- |
| ERASMUS-AP-07-START | start | confirmed | always -> ERASMUS-AP-07-C01 |
| ERASMUS-AP-07-C01 | condition predicate=AP_HAS_3_CARDS | inferred | true -> ERASMUS-AP-07-S01; false -> ERASMUS-AP-07-C02 |
| ERASMUS-AP-07-C02 | condition predicate=AP_HQ_SUPPLY_AVAILABLE | inferred | true -> ERASMUS-AP-07-S02; false -> ERASMUS-AP-07-C03 |
| ERASMUS-AP-07-C03 | condition predicate=AP_RABAUL_CONTROLLED | inferred | true -> ERASMUS-AP-07-S03; false -> ERASMUS-AP-07-C04 |
| ERASMUS-AP-07-C04 | condition predicate=AP_CBI_BUILT | inferred | true -> ERASMUS-AP-07-S04; false -> ERASMUS-AP-07-C05 |
| ERASMUS-AP-07-C05 | condition predicate=AP_HAS_PASS | inferred | true -> ERASMUS-AP-07-S05; false -> ERASMUS-AP-07-C06 |
| ERASMUS-AP-07-C06 | condition predicate=AP_LAST_CARD | inferred | true -> ERASMUS-AP-07-S06; false -> ERASMUS-AP-07-C07 |
| ERASMUS-AP-07-C07 | condition predicate=AP_THIRD_TURN | inferred | true -> ERASMUS-AP-07-S07; false -> ERASMUS-AP-07-C08 |
| ERASMUS-AP-07-C08 | condition predicate=AP_PHILIPPINES_NOT_SURRENDERED | inferred | true -> ERASMUS-AP-07-S08; false -> ERASMUS-AP-07-C09 |
| ERASMUS-AP-07-C09 | condition predicate=AP_ABDA_HQ_READY | inferred | true -> ERASMUS-AP-07-S01; false -> ERASMUS-AP-07-SELECT |
| ERASMUS-AP-07-S01 | action | inferred | always -> ERASMUS-AP-07-END |
| ERASMUS-AP-07-S02 | action | inferred | always -> ERASMUS-AP-07-END |
| ERASMUS-AP-07-S03 | action | inferred | always -> ERASMUS-AP-07-END |
| ERASMUS-AP-07-S04 | action | inferred | always -> ERASMUS-AP-07-END |
| ERASMUS-AP-07-S05 | action | inferred | always -> ERASMUS-AP-07-END |
| ERASMUS-AP-07-S06 | action | inferred | always -> ERASMUS-AP-07-END |
| ERASMUS-AP-07-S07 | action | inferred | always -> ERASMUS-AP-07-END |
| ERASMUS-AP-07-S08 | action | inferred | always -> ERASMUS-AP-07-END |
| ERASMUS-AP-07-SELECT | priority | inferred | candidate_found -> ERASMUS-AP-07-END; no_candidate -> ERASMUS-AP-07-FALLBACK |
| ERASMUS-AP-07-FALLBACK | fallback | inferred | - |
| ERASMUS-AP-07-END | terminal | confirmed | - |

## 策略出口

1. **AP_PHILIPPINES**
2. **AP_MALAYA**
3. **AP_ABDA**
4. **AP_CBI**
5. **AP_ORANGE_PLAN**
6. **AP_EVENT**
7. **AP_PASS**
8. **AP_DEI_DEFENSE**

## 审校

本页节点中的 inferred 表示依据 PDF 视觉内容与规则语义推断，必须在黄金路径测试中复核。
