# 本地对局存档（RTT 导出）

来源：`rots-runtime-pve/db`（本地 Rally-the-Troops 服务器），由 `tools/export-rtt-game.js` 导出。

## 内容

- `game-<id>.json` — 牌谱：`.setup` 参数（seed/剧本/options）+ 完整动作序列 + 双方座位（人/AI）+ 结果
- `game-<id>.state.json.gz` — 终局完整状态（gzip；含日志，可复核每一步）
- `index.json` — 全部对局索引

## 格式与重放

动作序列兼容引擎：`seed + scenario + options + replayActions` 可在 `rules.js` 下确定性重放整局
（参考 `tools/convert-replay-to-dump.js` 的重放循环）。AI 每一步的公开决策轨迹存于本地库
`game_ai_trace` 表，需要时可再用 `tools/audit-rtt-game.js` 导出。

## 对局一览（要点）

| 类别 | 局 |
|---|---|
| **PvE（人 vs AI）** | #8、#15、#32、#46、#59、**#78（盟军胜——人类玩家击败 erasmus-v2-opt-v5）**、#17、#18（另一账号） |
| AI vs AI 复盘局 | #43–#77（含 6 局盟军原子弹胜局 #51/53/54 与 16.2 引擎后的对局） |

导出过滤：`moves >= 10`（空开局不导）。更新存档：

```bash
node tools/export-rtt-game.js <runtimeDir> replays --min-moves 10 --gz-state
```
