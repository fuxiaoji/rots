# ERASMUS-JP-02（第 2 页）

- 阵营：Japan
- 阶段：middle
- 类型：decision-axis
- 来源：伊拉斯谟v2.0_图表汉化.pdf，第 2 页
- 机器文档：data/erasmus/pages/page-02.json

## 节点与边

| 节点 | 类型/谓词 | 置信度 | 出边 |
| --- | --- | --- | --- |
| ERASMUS-JP-02-START | start | confirmed | always -> ERASMUS-JP-02-C01 |
| ERASMUS-JP-02-C01 | condition predicate=JP_HAS_PASS | inferred | true -> ERASMUS-JP-02-S01; false -> ERASMUS-JP-02-C02 |
| ERASMUS-JP-02-C02 | condition predicate=JP_HAND_GE_3 | inferred | true -> ERASMUS-JP-02-S02; false -> ERASMUS-JP-02-C03 |
| ERASMUS-JP-02-C03 | condition predicate=JP_RESOURCES_GE_13 | inferred | true -> ERASMUS-JP-02-S03; false -> ERASMUS-JP-02-C04 |
| ERASMUS-JP-02-C04 | condition predicate=JP_LOGISTICS_GTE_20 | inferred | true -> ERASMUS-JP-02-S04; false -> ERASMUS-JP-02-C05 |
| ERASMUS-JP-02-C05 | condition predicate=AP_WAR_ENTHUSIASM_LE_4 | inferred | true -> ERASMUS-JP-02-S05; false -> ERASMUS-JP-02-C06 |
| ERASMUS-JP-02-C06 | condition predicate=AP_CBI_HAS_FORT | inferred | true -> ERASMUS-JP-02-S06; false -> ERASMUS-JP-02-C07 |
| ERASMUS-JP-02-C07 | condition predicate=TURN_GE_5 | inferred | true -> ERASMUS-JP-02-S07; false -> ERASMUS-JP-02-SELECT |
| ERASMUS-JP-02-S01 | action | inferred | always -> ERASMUS-JP-02-END |
| ERASMUS-JP-02-S02 | action | inferred | always -> ERASMUS-JP-02-END |
| ERASMUS-JP-02-S03 | action | inferred | always -> ERASMUS-JP-02-END |
| ERASMUS-JP-02-S04 | action | inferred | always -> ERASMUS-JP-02-END |
| ERASMUS-JP-02-S05 | action | inferred | always -> ERASMUS-JP-02-END |
| ERASMUS-JP-02-S06 | action | inferred | always -> ERASMUS-JP-02-END |
| ERASMUS-JP-02-S07 | action | inferred | always -> ERASMUS-JP-02-END |
| ERASMUS-JP-02-S08 | action | inferred | always -> ERASMUS-JP-02-END |
| ERASMUS-JP-02-SELECT | priority | inferred | candidate_found -> ERASMUS-JP-02-END; no_candidate -> ERASMUS-JP-02-FALLBACK |
| ERASMUS-JP-02-FALLBACK | fallback | inferred | - |
| ERASMUS-JP-02-END | terminal | confirmed | - |

## 策略出口

1. **JP_CENTRAL_PACIFIC**
2. **JP_RESOURCE**
3. **JP_INDIA**
4. **JP_NEW_GUINEA**
5. **JP_CHINA**
6. **JP_FOREIGN_DEFENSE**
7. **JP_EVENT**
8. **JP_PASS**

## 审校

本页节点中的 inferred 表示依据 PDF 视觉内容与规则语义推断，必须在黄金路径测试中复核。
