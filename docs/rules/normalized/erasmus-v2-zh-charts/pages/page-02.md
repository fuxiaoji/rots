# ERASMUS-JP-02

- 来源：伊拉斯谟v2.0_图表汉化 (1).pdf，第 2 页
- SHA-256：5c362b4af6306b03baf959f80273942a80418bf985dac2faee61eb953a1dab2f
- 状态：逐页视觉确认（2026-09-04）

| 节点 | 类型/谓词 | 出边 |
|---|---|---|
| JP02-START | start | always→JP02-A |
| JP02-A | condition / JP_HAND_GE_3 | true→JP02-C；false→JP02-B |
| JP02-B | condition / JP_CAN_PASS | true→JP02-S-PASS；false→JP02-S-EVENT |
| JP02-C | condition / JP_RESOURCE_COUNT_LT_13 | true→JP02-S-RESOURCE；false→JP02-D |
| JP02-D | condition / JP_LOGISTICS_GTE_20 | true→JP02-E；false→JP02-G |
| JP02-E | condition / US_POLITICAL_WILL_LT_4 | true→JP02-S-CENTRAL-PACIFIC；false→JP02-F |
| JP02-G | condition / JP_LOGISTICS_GTE_15 | true→JP02-F；false→JP02-S-PERIMETER |
| JP02-F | condition / BURMA_SURRENDERED | true→JP02-HIJ；false→JP02-S-CBI |
| JP02-HIJ | condition / GANDHI_OR_MORE_LARGE_STEPS_AND_LOGISTICS_GTE_18 | true→JP02-S-INDIA；false→JP02-S-PERIMETER |
| JP02-S-PASS | action | always→JP02-END |
| JP02-S-EVENT | action | always→JP02-END |
| JP02-S-RESOURCE | action | always→JP02-END |
| JP02-S-CENTRAL-PACIFIC | action | always→JP02-END |
| JP02-S-CBI | action | always→JP02-END |
| JP02-S-INDIA | action | always→JP02-END |
| JP02-S-PERIMETER | action | always→JP02-END |
| JP02-FALLBACK | fallback | - |
| JP02-END | terminal | - |
