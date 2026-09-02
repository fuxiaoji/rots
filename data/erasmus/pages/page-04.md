# ERASMUS-JP-04（第 4 页）

- 阵营：Japan
- 阶段：all
- 类型：card-selection
- 来源：伊拉斯谟v2.0_图表汉化.pdf，第 4 页
- 机器文档：data/erasmus/pages/page-04.json

## 节点与边

| 节点 | 类型/谓词 | 置信度 | 出边 |
| --- | --- | --- | --- |
| ERASMUS-JP-04-START | start | confirmed | always -> ERASMUS-JP-04-C01 |
| ERASMUS-JP-04-C01 | condition predicate=JP_FO_ACTIVE | inferred | true -> ERASMUS-JP-04-S01; false -> ERASMUS-JP-04-C02 |
| ERASMUS-JP-04-C02 | condition predicate=JP_HAND_GT_2 | inferred | true -> ERASMUS-JP-04-S02; false -> ERASMUS-JP-04-C03 |
| ERASMUS-JP-04-C03 | condition predicate=JP_FIRST_CARD | inferred | true -> ERASMUS-JP-04-S03; false -> ERASMUS-JP-04-C04 |
| ERASMUS-JP-04-C04 | condition predicate=JP_HAS_IMPERIAL_INTERVENTION | inferred | true -> ERASMUS-JP-04-S04; false -> ERASMUS-JP-04-C05 |
| ERASMUS-JP-04-C05 | condition predicate=JP_HAS_EVENT_CARD | inferred | true -> ERASMUS-JP-04-S05; false -> ERASMUS-JP-04-C06 |
| ERASMUS-JP-04-C06 | condition predicate=JP_HAS_LIMITED_EVENT | inferred | true -> ERASMUS-JP-04-S06; false -> ERASMUS-JP-04-C07 |
| ERASMUS-JP-04-C07 | condition predicate=JP_ALL_EVENTS_LIMITED | inferred | true -> ERASMUS-JP-04-S07; false -> ERASMUS-JP-04-C08 |
| ERASMUS-JP-04-C08 | condition predicate=JP_ISR_TARGET | inferred | true -> ERASMUS-JP-04-S01; false -> ERASMUS-JP-04-C09 |
| ERASMUS-JP-04-C09 | condition predicate=JP_FUTURE_OFFENSIVE | inferred | true -> ERASMUS-JP-04-S02; false -> ERASMUS-JP-04-SELECT |
| ERASMUS-JP-04-S01 | action | inferred | always -> ERASMUS-JP-04-END |
| ERASMUS-JP-04-S02 | action | inferred | always -> ERASMUS-JP-04-END |
| ERASMUS-JP-04-S03 | action | inferred | always -> ERASMUS-JP-04-END |
| ERASMUS-JP-04-S04 | action | inferred | always -> ERASMUS-JP-04-END |
| ERASMUS-JP-04-S05 | action | inferred | always -> ERASMUS-JP-04-END |
| ERASMUS-JP-04-S06 | action | inferred | always -> ERASMUS-JP-04-END |
| ERASMUS-JP-04-S07 | action | inferred | always -> ERASMUS-JP-04-END |
| ERASMUS-JP-04-SELECT | priority | inferred | candidate_found -> ERASMUS-JP-04-END; no_candidate -> ERASMUS-JP-04-FALLBACK |
| ERASMUS-JP-04-FALLBACK | fallback | inferred | - |
| ERASMUS-JP-04-END | terminal | confirmed | - |

## 策略出口

1. **JP_FUTURE_OFFENSIVE_CARD**
2. **JP_LIMITED_EVENT_CARD**
3. **JP_UNLIMITED_EVENT_CARD**
4. **JP_LIMITED_OPS_CARD**
5. **JP_UNLIMITED_OPS_CARD**
6. **JP_EVENT_CARD**
7. **JP_PASS**

## 审校

本页节点中的 inferred 表示依据 PDF 视觉内容与规则语义推断，必须在黄金路径测试中复核。
