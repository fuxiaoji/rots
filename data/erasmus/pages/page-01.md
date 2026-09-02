# ERASMUS-JP-01（第 1 页）

- 阵营：Japan
- 阶段：early
- 类型：decision-axis
- 来源：伊拉斯谟v2.0_图表汉化.pdf，第 1 页
- 机器文档：data/erasmus/pages/page-01.json

## 节点与边

| 节点 | 类型/谓词 | 置信度 | 出边 |
| --- | --- | --- | --- |
| ERASMUS-JP-01-START | start | confirmed | always -> ERASMUS-JP-01-C01 |
| ERASMUS-JP-01-C01 | condition predicate=JP_PHI_RESOURCES | inferred | true -> ERASMUS-JP-01-S01; false -> ERASMUS-JP-01-C02 |
| ERASMUS-JP-01-C02 | condition predicate=JP_RESOURCES_LTE_13 | inferred | true -> ERASMUS-JP-01-S02; false -> ERASMUS-JP-01-C03 |
| ERASMUS-JP-01-C03 | condition predicate=JP_LOGISTICS_GTE_20 | inferred | true -> ERASMUS-JP-01-S03; false -> ERASMUS-JP-01-C04 |
| ERASMUS-JP-01-C04 | condition predicate=TURN_GE_3 | inferred | true -> ERASMUS-JP-01-S04; false -> ERASMUS-JP-01-C05 |
| ERASMUS-JP-01-C05 | condition predicate=JP_AZOI_COMPLETE | inferred | true -> ERASMUS-JP-01-S05; false -> ERASMUS-JP-01-C06 |
| ERASMUS-JP-01-C06 | condition predicate=JP_RABAUL_CONTROLLED | inferred | true -> ERASMUS-JP-01-S06; false -> ERASMUS-JP-01-C07 |
| ERASMUS-JP-01-C07 | condition predicate=JP_TARGET_LIST_FALLBACK | inferred | true -> ERASMUS-JP-01-S07; false -> ERASMUS-JP-01-SELECT |
| ERASMUS-JP-01-S01 | action | inferred | always -> ERASMUS-JP-01-END |
| ERASMUS-JP-01-S02 | action | inferred | always -> ERASMUS-JP-01-END |
| ERASMUS-JP-01-S03 | action | inferred | always -> ERASMUS-JP-01-END |
| ERASMUS-JP-01-S04 | action | inferred | always -> ERASMUS-JP-01-END |
| ERASMUS-JP-01-S05 | action | inferred | always -> ERASMUS-JP-01-END |
| ERASMUS-JP-01-S06 | action | inferred | always -> ERASMUS-JP-01-END |
| ERASMUS-JP-01-S07 | action | inferred | always -> ERASMUS-JP-01-END |
| ERASMUS-JP-01-S08 | action | inferred | always -> ERASMUS-JP-01-END |
| ERASMUS-JP-01-SELECT | priority | inferred | candidate_found -> ERASMUS-JP-01-END; no_candidate -> ERASMUS-JP-01-FALLBACK |
| ERASMUS-JP-01-FALLBACK | fallback | inferred | - |
| ERASMUS-JP-01-END | terminal | confirmed | - |

## 策略出口

1. **JP_SOUTHWEST_RESOURCE**
2. **JP_EVENT**
3. **JP_PRESSURE_INDIA**
4. **JP_PRESSURE_HQ**
5. **JP_CENTRAL_PACIFIC**
6. **JP_CHINA**
7. **JP_NEW_GUINEA**
8. **JP_PHILIPPINES**

## 审校

本页节点中的 inferred 表示依据 PDF 视觉内容与规则语义推断，必须在黄金路径测试中复核。
