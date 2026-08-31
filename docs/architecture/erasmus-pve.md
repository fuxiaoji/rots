# 伊拉斯谟 PvE 数据契约

## 模块边界

- 规则模块继续以英文 ID 和英文角色名保存状态。
- `rules.view(state, role)` 是 AI 唯一观察入口；AI 不接收完整状态。
- `rules.bots["erasmus-v2"].decide(view, context)` 返回一个合法动作及公开/私有决策轨迹。
- 平台逐动作调用 `rules.action`，因此 AI 行为与人类行为使用同一回放、快照和广播路径。

## 决策接口

`context` 包含 `role`、开局 `seed` 和下一动作序号 `actionOrdinal`。策略使用三者与图表节点 ID 派生确定性随机数，不读取系统时间。

返回值：

- `action`、`argument`：必须存在于当前 `view.actions`。
- `publicTrace`：当前对局可展示，不泄露未打出的卡牌候选。
- `privateTrace`：包含合法动作和候选，活动对局仅管理员可见；结束后可用于科研复核。

## 服务器持久化

- `players.bot_id` 标识机器人席位；`user_id=0` 仅复用系统占位账号。
- `game_ai_trace` 以 `(game_id, replay_id)` 连接每个 AI 动作。
- AI 不接收通知、不计入 Elo，也不能建立玩家 WebSocket。
- 单局锁保证只有一个 AI 执行器；每次调度最多 256 个微动作，异常时暂停并向客户端报告。

## 当前可玩范围

两方策略接口均已启用，但服务器只允许南太平洋 PvE 建局。12 页图表的来源文本、条件节点、页码和规则引用位于 `data/erasmus/charts.json`；流程图拓扑仍须用原始版面进行持续黄金样例校对。

