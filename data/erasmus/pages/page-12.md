# ERASMUS-AP-12（第 12 页）

- 阵营：Allies
- 阶段：all
- 类型：reaction
- 来源：伊拉斯谟v2.0_图表汉化.pdf，第 12 页
- 机器文档：data/erasmus/pages/page-12.json

## 节点与边

| 节点 | 类型/谓词 | 置信度 | 出边 |
| --- | --- | --- | --- |
| ERASMUS-AP-12-START | start | confirmed | always -> ERASMUS-AP-12-C01 |
| ERASMUS-AP-12-C01 | condition predicate=ISR_REACTION | inferred | true -> ERASMUS-AP-12-S01; false -> ERASMUS-AP-12-C02 |
| ERASMUS-AP-12-C02 | condition predicate=HAS_BATTLE | inferred | true -> ERASMUS-AP-12-S02; false -> ERASMUS-AP-12-C03 |
| ERASMUS-AP-12-C03 | condition predicate=HQ_IN_RANGE | inferred | true -> ERASMUS-AP-12-S03; false -> ERASMUS-AP-12-C04 |
| ERASMUS-AP-12-C04 | condition predicate=ATTACK_REACTION_AVAILABLE | inferred | true -> ERASMUS-AP-12-S04; false -> ERASMUS-AP-12-C05 |
| ERASMUS-AP-12-C05 | condition predicate=DEI_COMPLETE | inferred | true -> ERASMUS-AP-12-S05; false -> ERASMUS-AP-12-C06 |
| ERASMUS-AP-12-C06 | condition predicate=NUKE_TARGET | inferred | true -> ERASMUS-AP-12-S01; false -> ERASMUS-AP-12-C07 |
| ERASMUS-AP-12-C07 | condition predicate=PBM_AIR_REQUIRED | inferred | true -> ERASMUS-AP-12-S02; false -> ERASMUS-AP-12-C08 |
| ERASMUS-AP-12-C08 | condition predicate=PBM_SEA_REQUIRED | inferred | true -> ERASMUS-AP-12-S03; false -> ERASMUS-AP-12-C09 |
| ERASMUS-AP-12-C09 | condition predicate=PBM_AA_FAILED | inferred | true -> ERASMUS-AP-12-S04; false -> ERASMUS-AP-12-SELECT |
| ERASMUS-AP-12-S01 | action | inferred | always -> ERASMUS-AP-12-END |
| ERASMUS-AP-12-S02 | action | inferred | always -> ERASMUS-AP-12-END |
| ERASMUS-AP-12-S03 | action | inferred | always -> ERASMUS-AP-12-END |
| ERASMUS-AP-12-S04 | action | inferred | always -> ERASMUS-AP-12-END |
| ERASMUS-AP-12-S05 | action | inferred | always -> ERASMUS-AP-12-END |
| ERASMUS-AP-12-SELECT | priority | inferred | candidate_found -> ERASMUS-AP-12-END; no_candidate -> ERASMUS-AP-12-FALLBACK |
| ERASMUS-AP-12-DICE-01 | dice | inferred | - |
| ERASMUS-AP-12-FALLBACK | fallback | inferred | - |
| ERASMUS-AP-12-END | terminal | confirmed | - |

## 策略出口

1. **AP_INTEL_REACTION**
2. **AP_COUNTERATTACK_REACTION**
3. **AP_PBM_AIR**
4. **AP_PBM_SEA**
5. **AP_PBM_AA**

## 审校

本页节点中的 inferred 表示依据 PDF 视觉内容与规则语义推断，必须在黄金路径测试中复核。
