# ERASMUS-AP-07

- 来源：伊拉斯谟v2.0_图表汉化 (1).pdf，第 7 页
- SHA-256：5c362b4af6306b03baf959f80273942a80418bf985dac2faee61eb953a1dab2f
- 状态：逐页视觉确认（2026-09-04）

| 节点 | 类型/谓词 | 出边 |
|---|---|---|
| AP07-START | start | always→AP07-A |
| AP07-A | condition / AP_HAND_GE_3 | true→AP07-B；false→AP07-S-EVENT |
| AP07-B | condition / SUPPLIED_HQ_IN_PHILIPPINES | true→AP07-S-EVAC-PHILIPPINES；false→AP07-C |
| AP07-C | condition / SUPPLIED_HQ_IN_MALAYA | true→AP07-S-EVAC-MALAYA；false→AP07-D |
| AP07-D | condition / ARCADIA_PLAYED | true→AP07-E；false→AP07-S-ABDA |
| AP07-E | condition / CBI_DEFENSE_COMPLETE | true→AP07-FG；false→AP07-S-CBI |
| AP07-FG | condition / HAS_PASS_AND_ONE_CARD_LEFT | true→AP07-S-PASS；false→AP07-JKLMN |
| AP07-JKLMN | condition / ORANGE_PLAN_CRITERIA | true→AP07-S-ORANGE；false→AP07-OP |
| AP07-OP | condition / DEI_NOT_SURRENDERED_AND_ABDA_SUPPLIED | true→AP07-S-DEI；false→AP07-S-OFFENSIVE |
| AP07-S-EVENT | action | always→AP07-END |
| AP07-S-EVAC-PHILIPPINES | action | always→AP07-END |
| AP07-S-EVAC-MALAYA | action | always→AP07-END |
| AP07-S-ABDA | action | always→AP07-END |
| AP07-S-CBI | action | always→AP07-END |
| AP07-S-PASS | action | always→AP07-END |
| AP07-S-ORANGE | action | always→AP07-END |
| AP07-S-DEI | action | always→AP07-END |
| AP07-S-OFFENSIVE | action | always→AP07-END |
| AP07-FALLBACK | fallback | - |
| AP07-END | terminal | - |
