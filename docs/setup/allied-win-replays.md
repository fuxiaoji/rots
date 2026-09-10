# 盟军胜局复盤包（RTT 导入指南）

## 已录制的盟军胜局（ERASMUS_PLUS，全部原子弹路线）

| 文件 | seed | 结束 | 日资源 | PW | 动作数 |
|---|---|---|---|---|---|
| `tests/results/replay-win-20261206.json` | 20261206 | **T9 原子弹投降** | 3 | 3 | 2074 |
| `tests/results/replay-win-20261267.json` | 20261267 | T12 原子弹投降 | 3 | 3 | 2718 |
| `tests/results/replay-win-20261428.json` | 20261428 | **T8 原子弹投降** | — | — | 1728 |

三局均为「日本 surrenders by atomic bomb strategy」。录制格式 = RTT `game_replay` 表同构
（`{seq, role, action, arguments}` 序列），另含 scenario/seed/bots/profile/winner 等元数据。

## 导入到本地 RTT 服务器

前置：RTT 平台运行目录（含 `node_modules/better-sqlite3` 与 `db` 数据库）。
Mac 上尚无该运行时（原 Windows 目录 `D:\desktop\rots-runtime-pve`，需拷贝或凭据克隆）。

```bash
node tools/import-replay-to-rtt.js <rtt运行目录> <rtt运行目录/db> \
    tests/results/replay-win-20261206.json "复盘1: T9速胜原子弹"
```

导入后在 `http://localhost:8080/` 打开对局即可逐步复盤。

## 复盘要点（三次独立对局的共同胜因）

1. **B29 T9 部署中国箱**，T9 起每回合 assign+roll，campaign 事件值保持=9 不断线；
2. **资源格压制**：南方资源格（马来亚/米里/爪哇方向）两栖夺占使日资源 ≤5（T8 胜局 ≤3）；
3. **苏联牌保留**：#79 不作 OC 消耗，TOJO 激活后作事件打出；
4. **PW 生存**：PoW 命名格配额每回合达标 + 航母保有，避免条约判定先死。

## 注意

- RTT 以**当前模块代码**从头重放动作序列；请勿在模块升级后直接导入旧录像，
  或在服务器上检出录制时的工作区版本（文件内 `codeNote` 有版本说明）。
- 这些胜局录制自 ERASMUS_PLUS 配置
  （`erasmus_plus,island_sweep,taskforce_math,allies_cv_preserve,allies_pow_quota,allies_resource_raid,allies_blockade_v2,loss_optimal`）。
