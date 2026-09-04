# ERASMUS-AP-10

- 来源：伊拉斯谟v2.0_图表汉化 (1).pdf，第 10 页
- SHA-256：5c362b4af6306b03baf959f80273942a80418bf985dac2faee61eb953a1dab2f
- 状态：逐页视觉确认（2026-09-04）

| 节点 | 类型/谓词 | 出边 |
|---|---|---|
| AP10-START | start | always→AP10-A |
| AP10-A | condition / AP_CARD_ALREADY_PLAYED | true→AP10-LM；false→AP10-CLASSIFY |
| AP10-CLASSIFY | process | always→AP10-LM |
| AP10-LM | condition / AP_CHINA_WITHIN_2_AND_EVENT_AVAILABLE | true→AP10-S-CHINA；false→AP10-B |
| AP10-S-CHINA | action | always→AP10-END |
| AP10-B | condition / AP_HAND_GT_2 | true→AP10-C；false→AP10-H |
| AP10-C | condition / AP_FIRST_GAME_CARD | true→AP10-D；false→AP10-E |
| AP10-D | condition / AP_HAS_FLINTLOCK_OR_SHOESTRING | true→AP10-S-FIRST；false→AP10-E |
| AP10-E | condition / AP_HAS_UNRESTRICTED_MILITARY_EVENT | true→AP10-S-UNRESTRICTED-EC；false→AP10-F |
| AP10-F | condition / AP_HAS_RESTRICTED_MILITARY_EVENT | true→AP10-G；false→AP10-S-NONMIL-OC |
| AP10-G | condition / AP_ALL_MILITARY_EVENTS_RESTRICTED | true→AP10-S-RESTRICTED-OC；false→AP10-S-RESTRICTED-EC |
| AP10-H | condition / AP_FO_SELECTED | true→AP10-S-NONMIL-OC；false→AP10-I |
| AP10-I | condition / CBI_DEFENSE_COMPLETE | true→AP10-J；false→AP10-S-NONMIL-OC |
| AP10-J | condition / AP_LAST_CARD | true→AP10-S-FO；false→AP10-K |
| AP10-K | condition / AP_LAST_PLAYABLE_IS_REACTION | true→AP10-S-NONMIL-OC；false→AP10-S-EVENT |
| AP10-S-FIRST | action | always→AP10-END |
| AP10-S-UNRESTRICTED-EC | action | always→AP10-END |
| AP10-S-RESTRICTED-EC | action | always→AP10-END |
| AP10-S-RESTRICTED-OC | action | always→AP10-END |
| AP10-S-NONMIL-OC | action | always→AP10-END |
| AP10-S-FO | action | always→AP10-END |
| AP10-S-EVENT | action | always→AP10-END |
| AP10-FALLBACK | fallback | - |
| AP10-END | terminal | - |
