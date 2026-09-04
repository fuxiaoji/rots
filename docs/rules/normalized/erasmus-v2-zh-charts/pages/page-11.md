# ERASMUS-AP-11

- 来源：伊拉斯谟v2.0_图表汉化 (1).pdf，第 11 页
- SHA-256：5c362b4af6306b03baf959f80273942a80418bf985dac2faee61eb953a1dab2f
- 状态：逐页视觉确认（2026-09-04）

| 节点 | 类型/谓词 | 出边 |
|---|---|---|
| AP11-START | start | always→AP11-A |
| AP11-A | condition / IS_AIR_STRIKE | true→AP11-S-AIR；false→AP11-B |
| AP11-B | condition / TARGET_IS_SEACOAST_OR_ISLAND | true→AP11-C；false→AP11-D1 |
| AP11-C | condition / CAN_GROUND_ADVANCE | true→AP11-DOR-EF；false→AP11-D2 |
| AP11-DOR-EF | condition / TARGET_EMPTY_OR_NAVAL_AND_GROUND_CAN_EXIT | true→AP11-S-TARGET；false→AP11-S-AIRSEA-GROUND |
| AP11-D1 | condition / TARGET_EMPTY | true→AP11-G；false→AP11-S-AIR-GROUND |
| AP11-D2 | condition / TARGET_EMPTY | true→AP11-G；false→AP11-H |
| AP11-G | condition / TARGET_IS_SR | true→AP11-H；false→AP11-S-UNSUPPORTED-LANDING |
| AP11-H | condition / ENEMY_AIR_OR_CARRIER_CAN_REACT | true→AP11-S-AIRSEA-LANDING；false→AP11-S-SEA-LANDING |
| AP11-S-AIR | process | always→AP11-S-TARGET |
| AP11-S-AIR-GROUND | process | always→AP11-S-TARGET |
| AP11-S-AIRSEA-GROUND | process | always→AP11-S-TARGET |
| AP11-S-SEA-LANDING | process | always→AP11-S-TARGET |
| AP11-S-AIRSEA-LANDING | process | always→AP11-S-TARGET |
| AP11-S-UNSUPPORTED-LANDING | process | always→AP11-S-TARGET |
| AP11-S-TARGET | action | always→AP11-ACTIVATE |
| AP11-ACTIVATE | action | always→AP11-I |
| AP11-I | condition / FORCE_MEETS_BATTLE_SUPPORT_STANDARD | true→AP11-J；false→AP11-S-WEAKEST |
| AP11-J | condition / TARGET_DAMAGE_LEVEL_MET | true→AP11-S-MOVE；false→AP11-D10 |
| AP11-D10 | dice | 0-3→AP11-S-MOVE；4-9→AP11-S-WEAKEST |
| AP11-S-WEAKEST | action | always→AP11-END |
| AP11-S-MOVE | action | always→AP11-KL |
| AP11-KL | condition / ENEMY_CAN_REACT_AND_IS_EC | true→AP11-S-SUPPRESS；false→AP11-M |
| AP11-M | condition / IS_LAST_TARGET | true→AP11-S-EXTRA；false→AP11-S-NEXT |
| AP11-S-SUPPRESS | action | always→AP11-END |
| AP11-S-EXTRA | action | always→AP11-END |
| AP11-S-NEXT | action | always→AP11-END |
| AP11-FALLBACK | fallback | - |
| AP11-END | terminal | - |
