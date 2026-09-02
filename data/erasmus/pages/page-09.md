# ERASMUS-AP-09（第 9 页）

- 阵营：Allies
- 阶段：end
- 类型：decision-axis
- 来源：伊拉斯谟v2.0_图表汉化.pdf，第 9 页
- 机器文档：data/erasmus/pages/page-09.json

## 节点与边

| 节点 | 类型/谓词 | 置信度 | 出边 |
| --- | --- | --- | --- |
| ERASMUS-AP-09-START | start | confirmed | always -> ERASMUS-AP-09-C01 |
| ERASMUS-AP-09-C01 | condition predicate=AP_HAS_PASS | inferred | true -> ERASMUS-AP-09-S01; false -> ERASMUS-AP-09-C02 |
| ERASMUS-AP-09-C02 | condition predicate=IS_FINAL_TURN | inferred | true -> ERASMUS-AP-09-S02; false -> ERASMUS-AP-09-C03 |
| ERASMUS-AP-09-C03 | condition predicate=AP_HAS_3_CARDS | inferred | true -> ERASMUS-AP-09-S03; false -> ERASMUS-AP-09-C04 |
| ERASMUS-AP-09-C04 | condition predicate=AP_STRATEGIC_BASE | inferred | true -> ERASMUS-AP-09-S04; false -> ERASMUS-AP-09-C05 |
| ERASMUS-AP-09-C05 | condition predicate=AP_B29_TARGET | inferred | true -> ERASMUS-AP-09-S05; false -> ERASMUS-AP-09-C06 |
| ERASMUS-AP-09-C06 | condition predicate=AP_CAN_ATOMIC_VICTORY | inferred | true -> ERASMUS-AP-09-S06; false -> ERASMUS-AP-09-SELECT |
| ERASMUS-AP-09-S01 | action | inferred | always -> ERASMUS-AP-09-END |
| ERASMUS-AP-09-S02 | action | inferred | always -> ERASMUS-AP-09-END |
| ERASMUS-AP-09-S03 | action | inferred | always -> ERASMUS-AP-09-END |
| ERASMUS-AP-09-S04 | action | inferred | always -> ERASMUS-AP-09-END |
| ERASMUS-AP-09-S05 | action | inferred | always -> ERASMUS-AP-09-END |
| ERASMUS-AP-09-S06 | action | inferred | always -> ERASMUS-AP-09-END |
| ERASMUS-AP-09-S07 | action | inferred | always -> ERASMUS-AP-09-END |
| ERASMUS-AP-09-SELECT | priority | inferred | candidate_found -> ERASMUS-AP-09-END; no_candidate -> ERASMUS-AP-09-FALLBACK |
| ERASMUS-AP-09-FALLBACK | fallback | inferred | - |
| ERASMUS-AP-09-END | terminal | confirmed | - |

## 策略出口

1. **AP_PASS**
2. **AP_EVENT**
3. **AP_CAPTURE_STRATEGIC_BASE**
4. **AP_PUSH_B29**
5. **AP_REDEPLOY**
6. **AP_INVade_JAPAN**
7. **AP_ATOMIC_VICTORY**

## 审校

本页节点中的 inferred 表示依据 PDF 视觉内容与规则语义推断，必须在黄金路径测试中复核。
