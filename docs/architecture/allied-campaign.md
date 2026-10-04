# AI-WIN-01：盟军战役机器人

`erasmus-campaign` 是独立的盟军机器人，支持 1942、1943 完整剧本。创建对局时选择这个机器人；原有 Erasmus 和 AI5 入口保留，默认选择不变。增强策略允许超出 Erasmus 图表，基础游戏规则不变。

## 决策与存档

`js/server/bots/erasmus_campaign.js` 只读取己方视图、公开棋子和规则查询。选牌、HQ 和编队共用候选任务：先验证激活、ISR、补给、ASP 和实际移动路径，再评估地面战力、护航与格外支援。占领任务必须有地面部队。普通陆路移动优先于需要运输预算的两栖方式。

计划存入 `G.ai_plan[role]`，版本为 `1`。其中包含目标、任务、指定单位、HQ、移动方式、预算、阻塞原因、PoW 缺口、胜利条件和后勤落点。运输、激活、移动、会战和战后移动共用任务分配；己方视图只投影本方计划。损失或路径失效时撤销对应任务并记录原因。

机器人动作使用兼容封装：`{ __ai: { version: 1, role, profile, plan, runtime, logs }, action: originalArgument }`。引擎仍执行原合法动作；旧数值、数组和对象参数继续有效。配置、计划和策略缓存随动作保存，决策本身不修改棋局日志。恢复后可仅执行已记录动作，无须重新调用新机器人决策器。

`G.ai_profile[role]` 与 `G.ai_runtime[role]` 隔离双方和多局状态。后者保存原 Erasmus 的必要策略缓存；全局临时缓存在加载状态时清除并恢复，避免依赖某进程之前运行过的游戏。

## 配置与运行

使用 `rules.bot_config(botName, role)` 读取实际生效配置。环境配置支持 `EOTS_OPT_PROFILE`、`EOTS_OPT_PARAMS` 及带 `_ALLIES` / `_JAPAN` 后缀的阵营覆盖；数值覆盖真正传递到动作执行期。评测记录最终配置，不能只记录环境变量或机器人显示名。

修改源码后运行 `node tools/inline.js`。相关检查：

```sh
node tests/campaign-runtime.test.js
node tests/campaign-planner.test.js
node tests/campaign-garrison.test.js
node tests/campaign-card-preview.test.js
node tests/campaign-blockade.test.js
node tests/campaign-homeland.test.js
node --test tests/campaign-combat.test.js
node tests/erasmus-move-continuation.test.js
node --test tests/campaign-rules.test.js tests/atomic-bomb-strategy.test.js tests/campaign-metrics.test.js tests/campaign-replay.test.js tests/campaign-save.test.js
```

固定旧版 AI5 对照和日本对手，原始生成引擎保存为 `tmp/ai-win-01/baseline-rules.js`（可从 `git show fec3435d:rules.js` 恢复）。评测的不可变 bundle、运行配置和逐局文件保存在输出目录中：

```sh
EOTS_RECORD_REPLAYS=all EOTS_EVAL_JOBS=4 node tests/campaign-evaluate.js develop tmp/ai-win-01/development 32
node tests/campaign-evaluate.js freeze tmp/ai-win-01/development tmp/ai-win-01/freeze.json
node tests/campaign-evaluate.js holdout tmp/ai-win-01/freeze.json tmp/ai-win-01/holdout
node tests/campaign-evaluate.js verify-replay path/to/game.replay.json
```

输出目录有版本锁；修改代码后使用新目录。并发数可为 1–4。每局独立落盘，错误、动作上限和回退不得当作胜局或从胜率分母删除。两剧本各完成 32 个开发种子且都有可验证胜局后才能冻结；冻结验证种子禁止用于调参。

所有自然合法胜局逐一完整回放，独立 `verification.json` 证据绑定逐局结果和录像哈希。未核验及核验失败的胜局不计入胜率。版本锁包含实际行为环境变量和执行上限。公开视图剔除撤销快照及临时抽牌内容；实际服务器撤销状态保留。

## 证据边界

新引擎的回放仅执行记录动作并比较完整状态摘要。冻结的旧引擎具有不可序列化策略缓存，旧侧回放明确标记 `frozen-policy-assisted`：重新执行固定策略、逐项核对动作和新增日志，再应用动作。它不能被称为新引擎的纯动作恢复证明。

历史第 73、76、78 局用于复盘及公开场景回归。保留当时的引擎与规则版本，不把历史胜局直接当作当前规则可重放胜局。新的两栖指标只统计真实两栖移动及最终占领；PoW 按规则结算日志统计；地面失败计入战斗分母。

旧原子弹胜局的隔离清单是 `research/ai-win-01/historical-rule-audit.json`，原文件留在 `replays/`，清单记录原文件哈希。原导出没有精确引擎提交时明确记为未知。第 78 局可借鉴后勤连续性，但不能逐动作照抄：旧引擎曾放行美陆军单独登陆敌控空的一格岛，增强规划器依规则 8.45D 排除此行为。

`firstExecutedLandingFormation` 是双方均可记录的实际登陆护航编队时间；`firstLandingFormation` 仅为新规划器的激活就绪诊断，两者不混用。若所有配对都没有胜负差异，bootstrap 差值区间会退化，不能据此宣称两策略等效。

胜路评估区分本州七格、连续三次封锁、T12 原子弹条件和日本 HQ 全部离图。对未知未来手牌不作保证；满洲资源的间接事件依赖与 B29 位置、轰炸开始时间分别记录。所有规划在本地确定性执行，运行时模型请求为 0。
