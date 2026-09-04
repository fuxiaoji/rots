# ERASMUS-AP-12

- 来源：伊拉斯谟v2.0_图表汉化 (1).pdf，第 12 页
- SHA-256：5c362b4af6306b03baf959f80273942a80418bf985dac2faee61eb953a1dab2f
- 状态：逐页视觉确认（2026-09-04）

| 节点 | 类型/谓词 | 出边 |
|---|---|---|
| AP12-START | start | always→AP12-A |
| AP12-A | condition / IS_STRATEGIC_REDEPLOYMENT | true→AP12-S-SR；false→AP12-B |
| AP12-S-SR | action | always→AP12-END |
| AP12-B | condition / HAS_BATTLE | true→AP12-C；false→AP12-HI |
| AP12-C | condition / BATTLE_IN_SUPPLIED_HQ_RANGE | true→AP12-DEF；false→AP12-S-INTEL-ROLL |
| AP12-DEF | condition / HAS_INTEL_COUNTER_OR_AMBUSH | true→AP12-D10；false→AP12-S-INTEL-ROLL |
| AP12-D10 | dice | 0→AP12-S-INTEL-CARD；1-9→AP12-S-INTEL-ROLL |
| AP12-S-INTEL-CARD | action | always→AP12-END |
| AP12-S-INTEL-ROLL | action | pass→AP12-G；fail→AP12-HI |
| AP12-G | condition / REACTION_FORCE_STANDARD_MET | true→AP12-RF-D10；false→AP12-HI |
| AP12-RF-D10 | dice | 0-4→AP12-S-REACTION；5-9→AP12-S-REACTION |
| AP12-S-REACTION | action | always→AP12-END |
| AP12-HI | condition / HAS_SUBMARINE_CARD_AND_TARGET | true→AP12-S-SUB；false→AP12-S-PBM |
| AP12-S-SUB | action | always→AP12-END |
| AP12-S-PBM | action | always→AP12-PBM-A |
| AP12-PBM-A | condition / PBM_AIR_REQUIRED | true→AP12-S-PBM-AIR；false→AP12-PBM-B |
| AP12-PBM-B | condition / PBM_SEA_REQUIRED | true→AP12-S-PBM-SEA；false→AP12-PBM-C |
| AP12-PBM-C | condition / PBM_AA_FAILED | true→AP12-S-PBM-AA；false→AP12-END |
| AP12-S-PBM-AIR | action | always→AP12-END |
| AP12-S-PBM-SEA | action | always→AP12-END |
| AP12-S-PBM-AA | action | always→AP12-END |
| AP12-FALLBACK | fallback | - |
| AP12-END | terminal | - |
