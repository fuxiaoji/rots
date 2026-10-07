# LLM-SEMI-01 半自动 LLM 模式评测结果

日期：2026-10-06 至 2026-10-07。规则版本：`rules.js` sha256 见逐局 JSONL `rulesSha256`；接口版本 `eots-llm-semi-v1.0`。
运行器：`tools/semi-eval.js`；逐局原始记录：`tests/results/semi-eval-{jp,ap}42-*.jsonl`。

## 模式定义

- 半自动 LLM（`llmsemi:<profile>`）：战役状态机 `erasmus-v2-opt-v5` 执行全部合法动作；模型只在己方每张牌的选牌窗回答一次「战略名（阶段目录内逐字）+ 有序目标地点（印刷mapId）」，程序验证后经 `esm_pin_strategy` 覆盖图表掷轴成为该牌的执行焦点链。格式无效两次→该牌回退程序默认战略并计数；接口/预算失败→对局暂停（不静默换机器人）。
- 模型信息面（`js/server/llm/semi.js buildPacket`）：己方手牌+启动预览预算、双方全部公开单位（含减编/航程/ASP成本/补给）、全部命名地点与控制方、四国要求格与投降状态、PW/PoW、资源/ASP 轨、当前阶段战略目录（含默认目标链与语义注释）、目标守军（taskFacts.defenders）、规则简述两篇（SHA-256 记录）。不读敌方手牌、牌库顺序或未来随机数。
- 模型不提交任何动作；与规则引擎的接触面只有战略名+目标链，合法性由引擎保证。

## 冻结配置

- 剧本：`1942-1945 (The Shortened Campaign)`；种子 `20262701`–`20262710`（开发种子，两侧共用，配对比较）。
- 日军侧：日本=被测玩家 vs 盟军 `erasmus-campaign`。盟军侧：盟军=被测玩家 vs 日本 `erasmus-japan-campaign`。
- 基线臂（纯程序）：日军侧 日本=`erasmus-v2-opt-v5`；盟军侧 盟军=`erasmus-campaign`。
- 每局 maxRequests=400、maxTotalTokens=8,000,000、maxActions=30000、`headless_moves:true`；全部自然终局均通过 `verifyReplay` 完整回放。
- 模型端点：DeepSeek `deepseek-flash`（官方 api.deepseek.com，thinking off，温度0.2）；MiniMax `MiniMax-M3`（api.minimaxi.com）；GLM `glm-5.3`（api.z.ai **coding-plan 端点** `/api/coding/paas/v4`，thinking on/effort low，用户计划订阅）。GLM 密钥仅计划端点可用（通用端点 1113 余额错误），MiniMax 密钥仅国内域名可用。

## 结果：日军侧（日本半自动 LLM vs 盟军战役AI）

| 指标 | 基线 v5 | DeepSeek | MiniMax | GLM |
|---|---|---|---|---|
| 完成局 | 10/10 | 10/10 | 10/10 | 10/10 |
| 日本胜（自然终局+回放验证） | **8/10** | **9/10** | 8/10 | 7/10 |
| 四国正式投降均值 | **0.8 国/局** | 0.5 | 0.7 | 0.5 |
| 菲律宾投降局数 | 5 | 1 | 2 | 0 |
| 马来亚投降局数 | 3 | 4 | 5 | 5 |
| 东印度/缅甸 | 0/0 | 0/0 | 0/0 | 0/0 |
| 终局政治意志均值（全部局） | 6.8 | **8.2** | 6.8 | 6.7 |
| 终局日本资源格均值 | 3.0 | 2.8 | 2.9 | 3.0 |
| 战略决策次数/局（全部有效） | 0 | 51–56 | 47–56 | 47+ |
| 格式无效回退次数 | – | 0 | 16 | 3 |
| 接口失败（恢复后完成） | – | 0 | 16 | 14 |
| tokens 合计 | 0 | ~8.2M | ~8.6M | ~8.4M |

配对胜负（同种子对基线的变化）：DeepSeek 2709 由盟胜转日胜（+1）；GLM 2701/2702/2708 由日胜转盟胜（−3）。

关键观察：

- 半自动 LLM 的**防守/资源保持**与 PW 余量普遍优于或持平基线（DeepSeek PW 均值 8.2 vs 6.8；10 局里 6 局终局日本资源 ≤3，即已进入 1943+ 盟军原子弹门槛附近仍守住）。
- **征服变慢**：基线图表轴在 5 局完成菲律宾投降（4 局 T2），三模型都很少做到（DeepSeek 1、MiniMax 2、GLM 0）。模型高频选择「资源战略/保守的南方资源战略/最终国防圈战略」（DeepSeek 直方图：国防圈 306 次、保守南方 85、资源 84、激进南方 55），把激活量转向守资源与守本土，牺牲了早期征服节奏。
- 单局亮点：DeepSeek 种子 20262701 完成菲律宾 T4+马来亚 T3 双投降且 PW=10（基线该种子 0 菲）。

## 结果：盟军侧（盟军半自动 LLM vs 日军战役AI）

| 指标 | 基线 erasmus-campaign | DeepSeek | MiniMax | GLM |
|---|---|---|---|---|
| 完成局 | 10/10 | 10/10 | 10/10 | 4/10（限流） |
| 盟军胜 | **4/10** | **0/10** | **0/10** | **0/4** |
| 条约败（PW=0）局数 | 2 | 10 | 8 | 3 |
| 支撑到 T12 局数 | 5 | 0 | 2 | 1 |
| 终局日本资源格均值 | 9.6 | 10.5 | 9.9 | 8.5 |
| tokens 合计 | 0 | ~8.0M | ~8.5M | ~3.4M |

关键观察：

- 日军战役AI（japan_campaign_planner）在 1942 剧本对半自动盟军呈碾压：三模型合计 24 完成局盟军 0 胜，21 局政治意志归零条约败（多数 T7–T10）；基线盟军战役AI 对同一对手 4/10 胜。
- 结构性原因：半自动接口只让模型每张牌钉一次目标链，而盟军的胜路需要跨回合的登陆编队攒兵、B29 基地前推、封锁/原子弹资源组合——这些在程序侧由 `ec_plan` 的多任务规划（transport/assembly/convergence）承担，模型只调目标顺序不足以重建；且模型偏好「南太平洋战略/跳岛作战」类链，正好撞上日军战役AI 的南方征服速度（其投降均值 2.7 国/局）。
- 结论：半自动模式的收益方向是**给强执行框架换脑子**（如日军侧守住资源/PW），而不是替代已经强程序化的盟军规划器；盟军侧要提升需要把 ec_plan 的任务结构也暴露给模型（后续工作）。

## 有效性边界

- 全部计入胜局的 36 局（日军侧 32 胜 + 盟军侧 4 胜）均为自然终局（ treaty 败/原子弹/撑满 12 回合判负均为规则文本输出）且 `verifyReplay` 逐步哈希一致；未完成/技术失败局单列，不计入胜负分母（日军侧 GLM 20262705 有 1 次恢复、20262707 有 3 次恢复后完成）。
- 样本 10 局/臂，差异不具统计显著性（8/10 vs 9/10、4/10 vs 0/10 均在二项噪声范围内）；本批为开发种子，非冻结留出验证，结论仅作方向参考。
- MiniMax 出现 25 次格式无效回退（该牌按程序默认战略执行并在 strategyLog 标记 `program-default`）；GLM AP 臂 6 局因提供商 429 限流未完成（原始记录 `semi-eval-ap42-glm-paused.json`），不计入汇总。
- 模型请求账本（逐次 promptHash/输出哈希/用量/延迟）在会话 replay 内；逐局摘要含 `llm.strategyCounts` 直方图。

## 复现命令

```bash
node tools/semi-eval.js --side japan --arm baseline --games 10 --base-seed 20262701 --workers 4 --out tests/results/semi-eval-jp42-baseline.jsonl
EOTS_LLM_TIMEOUT_MS=120000 node tools/semi-eval.js --side japan --arm semi --profile deepseek --games 10 --base-seed 20262701 --workers 3 --out tests/results/semi-eval-jp42-deepseek.jsonl
node tests/llm-semi.test.js   # 7 项 mock 单测（合法性/回退/预算/存档回放）
```
