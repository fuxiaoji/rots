# ERASMUS-AP-10（第 10 页）

- 阵营：Allies
- 阶段：all
- 类型：card-selection
- 来源：伊拉斯谟v2.0_图表汉化.pdf，第 10 页
- 机器文档：data/erasmus/pages/page-10.json

## 节点与边

| 节点 | 类型/谓词 | 置信度 | 出边 |
| --- | --- | --- | --- |
| ERASMUS-AP-10-START | start | confirmed | always -> ERASMUS-AP-10-C01 |
| ERASMUS-AP-10-C01 | condition predicate=AP_FO_ACTIVE | inferred | true -> ERASMUS-AP-10-S01; false -> ERASMUS-AP-10-C02 |
| ERASMUS-AP-10-C02 | condition predicate=AP_HAND_GT_2 | inferred | true -> ERASMUS-AP-10-S02; false -> ERASMUS-AP-10-C03 |
| ERASMUS-AP-10-C03 | condition predicate=AP_FIRST_CARD | inferred | true -> ERASMUS-AP-10-S03; false -> ERASMUS-AP-10-C04 |
| ERASMUS-AP-10-C04 | condition predicate=AP_HAS_FISSION | inferred | true -> ERASMUS-AP-10-S04; false -> ERASMUS-AP-10-C05 |
| ERASMUS-AP-10-C05 | condition predicate=AP_HAS_EVENT_CARD | inferred | true -> ERASMUS-AP-10-S05; false -> ERASMUS-AP-10-C06 |
| ERASMUS-AP-10-C06 | condition predicate=AP_HAS_LIMITED_EVENT | inferred | true -> ERASMUS-AP-10-S06; false -> ERASMUS-AP-10-C07 |
| ERASMUS-AP-10-C07 | condition predicate=AP_ALL_EVENTS_LIMITED | inferred | true -> ERASMUS-AP-10-S07; false -> ERASMUS-AP-10-C08 |
| ERASMUS-AP-10-C08 | condition predicate=AP_CBI_COMPLETE | inferred | true -> ERASMUS-AP-10-S08; false -> ERASMUS-AP-10-C09 |
| ERASMUS-AP-10-C09 | condition predicate=AP_CHINA_EVENT_AVAILABLE | inferred | true -> ERASMUS-AP-10-S01; false -> ERASMUS-AP-10-SELECT |
| ERASMUS-AP-10-S01 | action | inferred | always -> ERASMUS-AP-10-END |
| ERASMUS-AP-10-S02 | action | inferred | always -> ERASMUS-AP-10-END |
| ERASMUS-AP-10-S03 | action | inferred | always -> ERASMUS-AP-10-END |
| ERASMUS-AP-10-S04 | action | inferred | always -> ERASMUS-AP-10-END |
| ERASMUS-AP-10-S05 | action | inferred | always -> ERASMUS-AP-10-END |
| ERASMUS-AP-10-S06 | action | inferred | always -> ERASMUS-AP-10-END |
| ERASMUS-AP-10-S07 | action | inferred | always -> ERASMUS-AP-10-END |
| ERASMUS-AP-10-S08 | action | inferred | always -> ERASMUS-AP-10-END |
| ERASMUS-AP-10-SELECT | priority | inferred | candidate_found -> ERASMUS-AP-10-END; no_candidate -> ERASMUS-AP-10-FALLBACK |
| ERASMUS-AP-10-FALLBACK | fallback | inferred | - |
| ERASMUS-AP-10-END | terminal | confirmed | - |

## 策略出口

1. **AP_FUTURE_OFFENSIVE_CARD**
2. **AP_LIMITED_EVENT_CARD**
3. **AP_UNLIMITED_EVENT_CARD**
4. **AP_LIMITED_OPS_CARD**
5. **AP_UNLIMITED_OPS_CARD**
6. **AP_CHINA_EVENT_CARD**
7. **AP_EVENT_CARD**
8. **AP_PASS**

## 审校

本页节点中的 inferred 表示依据 PDF 视觉内容与规则语义推断，必须在黄金路径测试中复核。
