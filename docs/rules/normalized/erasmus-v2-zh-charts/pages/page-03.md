# ERASMUS-JP-03

- 来源：伊拉斯谟v2.0_图表汉化 (1).pdf，第 3 页
- SHA-256：5c362b4af6306b03baf959f80273942a80418bf985dac2faee61eb953a1dab2f
- 状态：逐页视觉确认（2026-09-04）

| 节点 | 类型/谓词 | 出边 |
|---|---|---|
| JP03-START | start | always→JP03-A |
| JP03-A | condition / JP_HAND_GE_3 | true→JP03-BC；false→JP03-S-EVENT |
| JP03-BC | condition / TOKYO_8_PORTS_AND_TOKYO_5_AIRFIELDS_GARRISONED | true→JP03-D；false→JP03-S-FINAL-PERIMETER |
| JP03-D | condition / JP_CAN_PASS | true→JP03-S-PASS；false→JP03-E |
| JP03-E | condition / ALLIED_GROUND_ON_HONSHU | true→JP03-S-FINAL-DEFENSE；false→JP03-S-EVENT |
| JP03-S-EVENT | action | always→JP03-END |
| JP03-S-FINAL-PERIMETER | action | always→JP03-END |
| JP03-S-PASS | action | always→JP03-END |
| JP03-S-FINAL-DEFENSE | action | always→JP03-END |
| JP03-FALLBACK | fallback | - |
| JP03-END | terminal | - |
