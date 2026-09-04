# ERASMUS-JP-04

- 来源：伊拉斯谟v2.0_图表汉化 (1).pdf，第 4 页
- SHA-256：5c362b4af6306b03baf959f80273942a80418bf985dac2faee61eb953a1dab2f
- 状态：逐页视觉确认（2026-09-04）

| 节点 | 类型/谓词 | 出边 |
|---|---|---|
| JP04-START | start | always→JP04-A |
| JP04-A | condition / JP_CARD_ALREADY_PLAYED | true→JP04-B；false→JP04-CLASSIFY |
| JP04-CLASSIFY | process | always→JP04-B |
| JP04-B | condition / JP_HAND_GT_2 | true→JP04-C；false→JP04-H |
| JP04-C | condition / JP_FIRST_GAME_CARD | true→JP04-D；false→JP04-E |
| JP04-D | condition / JP_HAS_FIRST_STRIKE_EVENT | true→JP04-S-FIRST；false→JP04-E |
| JP04-E | condition / JP_HAS_UNRESTRICTED_MILITARY_EVENT | true→JP04-S-UNRESTRICTED-EC；false→JP04-F |
| JP04-F | condition / JP_HAS_RESTRICTED_MILITARY_EVENT | true→JP04-G；false→JP04-S-NONMIL-OC |
| JP04-G | condition / JP_ALL_MILITARY_EVENTS_RESTRICTED | true→JP04-S-RESTRICTED-OC；false→JP04-S-RESTRICTED-EC |
| JP04-H | condition / JP_FO_SELECTED | true→JP04-S-NONMIL-OC；false→JP04-I |
| JP04-I | condition / JP_EARLY_DEI_TARGET_OCCUPIED | true→JP04-J；false→JP04-S-NONMIL-OC |
| JP04-J | condition / JP_LAST_CARD | true→JP04-S-FO；false→JP04-K |
| JP04-K | condition / JP_LAST_PLAYABLE_IS_REACTION | true→JP04-S-NONMIL-OC；false→JP04-S-EVENT |
| JP04-S-FIRST | action | always→JP04-END |
| JP04-S-UNRESTRICTED-EC | action | always→JP04-END |
| JP04-S-RESTRICTED-EC | action | always→JP04-END |
| JP04-S-RESTRICTED-OC | action | always→JP04-END |
| JP04-S-NONMIL-OC | action | always→JP04-END |
| JP04-S-FO | action | always→JP04-END |
| JP04-S-EVENT | action | always→JP04-END |
| JP04-FALLBACK | fallback | - |
| JP04-END | terminal | - |
