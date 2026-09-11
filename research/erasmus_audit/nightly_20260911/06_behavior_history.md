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

## 修复记录: japan_opening_conquest(erasmus_plus 门控)
- 根因: JP01 图表判定 A(盟军HQ断补给)永假 → 空优战略不登陆 → 新加坡(2015)永不攻取
- 修复: T2-3 且菲已全控 → 强制「激进的南方资源战略」; T1 保留空优(马尼拉陆路 T2 陷)
- 8局前后: 菲律宾 8/8 T2-3 恢复; 马来亚首降 T4(seed 20260910); 0激活 76-88 → 4-37
- 待解: 新加坡反复进攻机制(1/8 → 目标 8/8); DEI 8keys 全集推进

## 追加发现: 新加坡双条目压制锁
- 激进南方资源链中新加坡出现两次: 链首「压制新加坡(0.5x)」(SUPPRESS 空袭) + 马来亚投降条目(CONQUEST 占领)
- AI 永远先空袭(22航空队被选中=压制类 classRank air-first) → 占领条目被锁
- 已实装移除压制条目(japan_opening_conquest 门控) — 马来亚仍 1/8, 说明 25军激活-移动链另有断点(候选18含25军但编组/移动未消费) → 下夜首项: 漏斗插桩定位
