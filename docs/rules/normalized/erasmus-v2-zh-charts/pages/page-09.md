# ERASMUS-AP-09

- 来源：伊拉斯谟v2.0_图表汉化 (1).pdf，第 9 页
- SHA-256：5c362b4af6306b03baf959f80273942a80418bf985dac2faee61eb953a1dab2f
- 状态：逐页视觉确认（2026-09-04）

| 节点 | 类型/谓词 | 出边 |
|---|---|---|
| AP09-START | start | always→AP09-A |
| AP09-A | condition / AP_CAN_PASS | true→AP09-S-PASS；false→AP09-B |
| AP09-B | condition / TURN_12 | true→AP09-F；false→AP09-C |
| AP09-C | condition / AP_HAND_GE_3 | true→AP09-D；false→AP09-S-EVENT |
| AP09-D | condition / AP_HAS_STRATEGIC_BOMBING_BASE | true→AP09-E；false→AP09-S-CAPTURE-BOMBING-BASE |
| AP09-E | condition / ALL_MAP_B29_ON_BASE | true→AP09-F；false→AP09-S-PUSH-B29 |
| AP09-F | condition / AP_CONTROLS_HEX_WITHIN_TOKYO_8 | true→AP09-G；false→AP09-D10 |
| AP09-D10 | dice | 0-2→AP09-S-RETURN-PHILIPPINES；3-5→AP09-S-ISLAND-HOPPING；6-9→AP09-S-ALTERNATE |
| AP09-G | condition / AP_MEETS_ATOMIC_BOMB_STRATEGY_CRITERIA | true→AP09-S-ATOMIC；false→AP09-S-INVADE-JAPAN |
| AP09-S-PASS | action | always→AP09-END |
| AP09-S-EVENT | action | always→AP09-END |
| AP09-S-CAPTURE-BOMBING-BASE | action | always→AP09-END |
| AP09-S-PUSH-B29 | action | always→AP09-END |
| AP09-S-RETURN-PHILIPPINES | action | always→AP09-END |
| AP09-S-ISLAND-HOPPING | action | always→AP09-END |
| AP09-S-ALTERNATE | action | always→AP09-END |
| AP09-S-ATOMIC | action | always→AP09-END |
| AP09-S-INVADE-JAPAN | action | always→AP09-END |
| AP09-FALLBACK | fallback | - |
| AP09-END | terminal | - |
