# 行为取证（20260911 夜, HEAD=63679ef）

## Behavior: 日本开局马来亚投降链
- Last known good: 无（8 seed 普查马来亚投降 0/8 触发）
- Evidence: 25军(cf18) T2-T7 六回合原地驻 331(Songkhla 半岛), 零移动;
  KL(304)已日占; 新加坡(305)守军仅 8澳师cf6+RAF cf6+马来HQ——完全可打;
  马来亚 keys=[2014,2015], 2015 永缺 → check_nation_surrender 永不触发。
- Suspected mechanism: 25军 激活/移动链断裂（Z1 无 HQ 覆盖 或 M2 激活-移动目标分裂）。
  南方 HQ 位置待查; 激活窗 "No units activated" 高频与此吻合。

## Behavior: DEI 投降链
- keys 8 格全集同时日占才触发; 实测终局缺 7/8（仅 2220 西贡方向达成）。
- 群岛本体（Balikpapan 2517/Makassar 2616/Batavia 2019 等）日本开局后从未系统进攻。
- Suspected: 决策轴 DEI 目标优先级低于保守空优; 且无"多 keys 并集推进"规划。

## Behavior: 0 激活/不可达
- 8 seed 普查: 每局 "No units activated" 76-88 次, "no active unit can reach" 68-87 次。
- 分类待 Batch B reason-code 插桩; 初步: 菲律宾方向攻势每次含 ≥1 次 0 激活窗。

## 用户观察复现状态
- "马尼拉上有完整陆军却两栖" → 本 8 seed 马尼拉经陆路攻陷 T2-3(Philippines surrender ✓);
  反例存在于其它 seed/时段, 待逐局分类。
- "拉包尔久攻不下" → 1943 剧本待查(下一批)。
