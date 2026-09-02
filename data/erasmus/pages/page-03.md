# ERASMUS-JP-03（第 3 页）

- 阵营：Japan
- 阶段：end
- 类型：decision-axis
- 来源：伊拉斯谟v2.0_图表汉化.pdf，第 3 页
- 机器文档：data/erasmus/pages/page-03.json

## 节点与边

| 节点 | 类型/谓词 | 置信度 | 出边 |
| --- | --- | --- | --- |
| ERASMUS-JP-03-START | start | confirmed | always -> ERASMUS-JP-03-C01 |
| ERASMUS-JP-03-C01 | condition predicate=JP_HAND_GE_3 | inferred | true -> ERASMUS-JP-03-S01; false -> ERASMUS-JP-03-C02 |
| ERASMUS-JP-03-C02 | condition predicate=JP_PORT_WITHIN_TOKYO_8 | inferred | true -> ERASMUS-JP-03-S02; false -> ERASMUS-JP-03-C03 |
| ERASMUS-JP-03-C03 | condition predicate=JP_AIRFIELD_WITHIN_TOKYO_5 | inferred | true -> ERASMUS-JP-03-S03; false -> ERASMUS-JP-03-C04 |
| ERASMUS-JP-03-C04 | condition predicate=JP_HAS_PASS | inferred | true -> ERASMUS-JP-03-S04; false -> ERASMUS-JP-03-C05 |
| ERASMUS-JP-03-C05 | condition predicate=JP_MAINLAND_FORT | inferred | true -> ERASMUS-JP-03-S01; false -> ERASMUS-JP-03-SELECT |
| ERASMUS-JP-03-S01 | action | inferred | always -> ERASMUS-JP-03-END |
| ERASMUS-JP-03-S02 | action | inferred | always -> ERASMUS-JP-03-END |
| ERASMUS-JP-03-S03 | action | inferred | always -> ERASMUS-JP-03-END |
| ERASMUS-JP-03-S04 | action | inferred | always -> ERASMUS-JP-03-END |
| ERASMUS-JP-03-SELECT | priority | inferred | candidate_found -> ERASMUS-JP-03-END; no_candidate -> ERASMUS-JP-03-FALLBACK |
| ERASMUS-JP-03-FALLBACK | fallback | inferred | - |
| ERASMUS-JP-03-END | terminal | confirmed | - |

## 策略出口

1. **JP_EVENT**
2. **JP_FINAL_EMPIRE**
3. **JP_FINAL_DEFENSE**
4. **JP_PASS**

## 审校

本页节点中的 inferred 表示依据 PDF 视觉内容与规则语义推断，必须在黄金路径测试中复核。
