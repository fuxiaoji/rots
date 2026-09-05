# ERASMUS-AP-08

- 来源：伊拉斯谟v2.0_图表汉化 (1).pdf，第 8 页
- SHA-256：5c362b4af6306b03baf959f80273942a80418bf985dac2faee61eb953a1dab2f
- 状态：逐页视觉确认（2026-09-04）

| 节点 | 类型/谓词 | 出边 |
|---|---|---|
| AP08-START | start | always→AP08-A |
| AP08-A | condition / AP_CAN_PASS | true→AP08-S-PASS；false→AP08-B |
| AP08-B | condition / AP_NEEDS_PROGRESS_OF_WAR | true→AP08-D；false→AP08-C |
| AP08-D | condition / AP_HAND_GE_3_AND_JP_CONTROLS_COUNTERATTACK_TARGET | true→AP08-S-COUNTEROFFENSIVE；false→AP08-CARD-GROUP |
| AP08-CARD-GROUP | process | always→AP08-D10 |
| AP08-C | condition / AP_HAND_GE_3 | true→AP08-D10；false→AP08-S-EVENT |
| AP08-D10 | dice | 0-4→AP08-S-SOUTH-PACIFIC；5-7→AP08-S-CENTRAL-PACIFIC；8→AP08-S-DEI；9→AP08-S-CBI |
| AP08-S-PASS | action | always→AP08-END |
| AP08-S-EVENT | action | always→AP08-END |
| AP08-S-COUNTEROFFENSIVE | action | always→AP08-END |
| AP08-S-SOUTH-PACIFIC | action | always→AP08-END |
| AP08-S-CENTRAL-PACIFIC | action | always→AP08-END |
| AP08-S-DEI | action | always→AP08-END |
| AP08-S-CBI | action | always→AP08-END |
| AP08-FALLBACK | fallback | - |
| AP08-END | terminal | - |
