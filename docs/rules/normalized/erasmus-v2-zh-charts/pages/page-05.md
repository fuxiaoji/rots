# ERASMUS-JP-05

- 来源：伊拉斯谟v2.0_图表汉化 (1).pdf，第 5 页
- SHA-256：5c362b4af6306b03baf959f80273942a80418bf985dac2faee61eb953a1dab2f
- 状态：逐页视觉确认（2026-09-04）

| 节点 | 类型/谓词 | 出边 |
|---|---|---|
| JP05-START | start | always→JP05-A |
| JP05-A | condition / IS_AIR_STRIKE | true→JP05-S-AIR；false→JP05-B |
| JP05-B | condition / TARGET_IS_SEACOAST_OR_ISLAND | true→JP05-C；false→JP05-D1 |
| JP05-C | condition / CAN_GROUND_ADVANCE | true→JP05-DOR-EF；false→JP05-D2 |
| JP05-DOR-EF | condition / TARGET_EMPTY_OR_NAVAL_AND_GROUND_CAN_EXIT | true→JP05-S-TARGET；false→JP05-S-AIRSEA-GROUND |
| JP05-D1 | condition / TARGET_EMPTY | true→JP05-G；false→JP05-S-AIR-GROUND |
| JP05-D2 | condition / TARGET_EMPTY | true→JP05-G；false→JP05-H |
| JP05-G | condition / TARGET_IS_SR | true→JP05-H；false→JP05-S-UNSUPPORTED-LANDING |
| JP05-H | condition / ENEMY_AIR_OR_CARRIER_CAN_REACT | true→JP05-S-AIRSEA-LANDING；false→JP05-S-SEA-LANDING |
| JP05-S-AIR | action | always→JP05-END |
| JP05-S-AIR-GROUND | action | always→JP05-END |
| JP05-S-AIRSEA-GROUND | action | always→JP05-END |
| JP05-S-SEA-LANDING | action | always→JP05-END |
| JP05-S-AIRSEA-LANDING | action | always→JP05-END |
| JP05-S-UNSUPPORTED-LANDING | action | always→JP05-END |
| JP05-S-TARGET | action | always→JP05-ACTIVATE |
| JP05-ACTIVATE | action | always→JP05-I |
| JP05-I | condition / FORCE_MEETS_BATTLE_SUPPORT_STANDARD | true→JP05-J；false→JP05-S-WEAKEST |
| JP05-J | condition / TARGET_DAMAGE_LEVEL_MET | true→JP05-S-MOVE；false→JP05-D10 |
| JP05-D10 | dice | 0-3→JP05-S-MOVE；4-9→JP05-S-WEAKEST |
| JP05-S-WEAKEST | action | always→JP05-END |
| JP05-S-MOVE | action | always→JP05-KL |
| JP05-KL | condition / ENEMY_CAN_REACT_AND_IS_EC | true→JP05-S-SUPPRESS；false→JP05-M |
| JP05-M | condition / IS_LAST_TARGET | true→JP05-S-EXTRA；false→JP05-S-NEXT |
| JP05-S-SUPPRESS | action | always→JP05-END |
| JP05-S-EXTRA | action | always→JP05-END |
| JP05-S-NEXT | action | always→JP05-END |
| JP05-FALLBACK | fallback | - |
| JP05-END | terminal | - |
