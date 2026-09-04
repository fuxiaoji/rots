# ERASMUS-JP-06

- 来源：伊拉斯谟v2.0_图表汉化 (1).pdf，第 6 页
- SHA-256：5c362b4af6306b03baf959f80273942a80418bf985dac2faee61eb953a1dab2f
- 状态：逐页视觉确认（2026-09-04）

| 节点 | 类型/谓词 | 出边 |
|---|---|---|
| JP06-START | start | always→JP06-A |
| JP06-A | condition / WEATHER_CARD_AVAILABLE | true→JP06-B；false→JP06-C |
| JP06-B | condition / WEATHER_STANDARD_MET | true→JP06-S-WEATHER；false→JP06-C |
| JP06-S-WEATHER | action | always→JP06-END |
| JP06-C | condition / IS_STRATEGIC_REDEPLOYMENT | true→JP06-S-SR；false→JP06-D |
| JP06-S-SR | action | always→JP06-END |
| JP06-D | condition / HAS_BATTLE | true→JP06-EFG；false→JP06-KL |
| JP06-EFG | condition / BATTLE_IN_HQ_RANGE_AND_REACTION_CARD | true→JP06-D10；false→JP06-S-INTEL-ROLL |
| JP06-D10 | dice | 0→JP06-S-INTEL-CARD；1-9→JP06-S-INTEL-ROLL |
| JP06-S-INTEL-CARD | action | always→JP06-END |
| JP06-S-INTEL-ROLL | action | pass→JP06-H；fail→JP06-IJ |
| JP06-H | condition / REACTION_FORCE_STANDARD_MET | true→JP06-RF-D10；false→JP06-IJ |
| JP06-RF-D10 | dice | 0-4→JP06-S-REACTION；5-9→JP06-S-REACTION |
| JP06-S-REACTION | action | always→JP06-END |
| JP06-IJ | condition / EARLY_DEFENSE_DONE_AND_KAMIKAZE_STANDARD | true→JP06-S-KAMIKAZE；false→JP06-KL |
| JP06-S-KAMIKAZE | action | always→JP06-END |
| JP06-KL | condition / HAS_SUBMARINE_CARD_AND_TARGET | true→JP06-S-SUB；false→JP06-S-PBM |
| JP06-S-SUB | action | always→JP06-END |
| JP06-S-PBM | action | always→JP06-PBM-A |
| JP06-PBM-A | condition / PBM_AIR_REQUIRED | true→JP06-S-PBM-AIR；false→JP06-PBM-B |
| JP06-PBM-B | condition / PBM_SEA_REQUIRED | true→JP06-S-PBM-SEA；false→JP06-PBM-C |
| JP06-PBM-C | condition / PBM_AA_FAILED | true→JP06-S-PBM-AA；false→JP06-END |
| JP06-S-PBM-AIR | action | always→JP06-END |
| JP06-S-PBM-SEA | action | always→JP06-END |
| JP06-S-PBM-AA | action | always→JP06-END |
| JP06-FALLBACK | fallback | - |
| JP06-END | terminal | - |
