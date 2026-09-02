# ERASMUS-JP-06（第 6 页）

- 阵营：Japan
- 阶段：all
- 类型：reaction
- 来源：伊拉斯谟v2.0_图表汉化.pdf，第 6 页
- 机器文档：data/erasmus/pages/page-06.json

## 节点与边

| 节点 | 类型/谓词 | 置信度 | 出边 |
| --- | --- | --- | --- |
| ERASMUS-JP-06-START | start | confirmed | always -> ERASMUS-JP-06-C01 |
| ERASMUS-JP-06-C01 | condition predicate=WEATHER_CARD_AVAILABLE | inferred | true -> ERASMUS-JP-06-S01; false -> ERASMUS-JP-06-C02 |
| ERASMUS-JP-06-C02 | condition predicate=WEATHER_STANDARD_MET | inferred | true -> ERASMUS-JP-06-S02; false -> ERASMUS-JP-06-C03 |
| ERASMUS-JP-06-C03 | condition predicate=ISR_REACTION | inferred | true -> ERASMUS-JP-06-S03; false -> ERASMUS-JP-06-C04 |
| ERASMUS-JP-06-C04 | condition predicate=HAS_BATTLE | inferred | true -> ERASMUS-JP-06-S04; false -> ERASMUS-JP-06-C05 |
| ERASMUS-JP-06-C05 | condition predicate=HQ_IN_RANGE | inferred | true -> ERASMUS-JP-06-S05; false -> ERASMUS-JP-06-C06 |
| ERASMUS-JP-06-C06 | condition predicate=HAS_JN25 | inferred | true -> ERASMUS-JP-06-S06; false -> ERASMUS-JP-06-C07 |
| ERASMUS-JP-06-C07 | condition predicate=ATTACK_REACTION_AVAILABLE | inferred | true -> ERASMUS-JP-06-S07; false -> ERASMUS-JP-06-C08 |
| ERASMUS-JP-06-C08 | condition predicate=DEI_COMPLETE | inferred | true -> ERASMUS-JP-06-S01; false -> ERASMUS-JP-06-C09 |
| ERASMUS-JP-06-C09 | condition predicate=FOREIGN_DEFENSE_TARGET | inferred | true -> ERASMUS-JP-06-S02; false -> ERASMUS-JP-06-C10 |
| ERASMUS-JP-06-C10 | condition predicate=NUKE_TARGET | inferred | true -> ERASMUS-JP-06-S03; false -> ERASMUS-JP-06-C11 |
| ERASMUS-JP-06-C11 | condition predicate=PBM_AIR_REQUIRED | inferred | true -> ERASMUS-JP-06-S04; false -> ERASMUS-JP-06-C12 |
| ERASMUS-JP-06-C12 | condition predicate=PBM_SEA_REQUIRED | inferred | true -> ERASMUS-JP-06-S05; false -> ERASMUS-JP-06-C13 |
| ERASMUS-JP-06-C13 | condition predicate=PBM_AA_FAILED | inferred | true -> ERASMUS-JP-06-S06; false -> ERASMUS-JP-06-SELECT |
| ERASMUS-JP-06-S01 | action | inferred | always -> ERASMUS-JP-06-END |
| ERASMUS-JP-06-S02 | action | inferred | always -> ERASMUS-JP-06-END |
| ERASMUS-JP-06-S03 | action | inferred | always -> ERASMUS-JP-06-END |
| ERASMUS-JP-06-S04 | action | inferred | always -> ERASMUS-JP-06-END |
| ERASMUS-JP-06-S05 | action | inferred | always -> ERASMUS-JP-06-END |
| ERASMUS-JP-06-S06 | action | inferred | always -> ERASMUS-JP-06-END |
| ERASMUS-JP-06-S07 | action | inferred | always -> ERASMUS-JP-06-END |
| ERASMUS-JP-06-SELECT | priority | inferred | candidate_found -> ERASMUS-JP-06-END; no_candidate -> ERASMUS-JP-06-FALLBACK |
| ERASMUS-JP-06-DICE-01 | dice | inferred | - |
| ERASMUS-JP-06-FALLBACK | fallback | inferred | - |
| ERASMUS-JP-06-END | terminal | confirmed | - |

## 策略出口

1. **JP_WEATHER_REACTION**
2. **JP_NUKE_REACTION**
3. **JP_INTEL_REACTION**
4. **JP_COUNTERATTACK_REACTION**
5. **JP_PBM_AIR**
6. **JP_PBM_SEA**
7. **JP_PBM_AA**

## 审校

本页节点中的 inferred 表示依据 PDF 视觉内容与规则语义推断，必须在黄金路径测试中复核。
