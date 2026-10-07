# 已完成工作记录

## 2026-10-07：LLM-SEMI-01 半自动 LLM 战略模式（实现 + 首轮 74 局评测）

- **模式**：`llmsemi:<profile>` 玩家。战役状态机（erasmus-v2-opt-v5）执行全部合法动作；模型只在己方每张牌的选牌窗回答一次 `{strategy, targets[], reason}`——战略必须是当前阶段目录内逐字名，目标地点为印刷 mapId 有序表（可为默认链子集/重排，至多 16 项，未知 ID 丢弃并记录）。程序验证后经 `context.strategyOverride` 进入 `esm_pin_strategy`：跳过图表掷轴/完成分配重掷/同轴延续，按模型链（同格复用默认条目语义；新格按控制状态合成 CONQUEST/GARRISON）覆盖 eop 焦点链。RTT 日志标注「LLM半自动·模型链/默认链」。
- **信息面**（`js/server/llm/semi.js`）：己方手牌+cardPreviews 启动预算、双方全部公开单位（cf/rcf/lf/br/ebr/asp/补给）、全部命名地点+控制方、四国要求格与正式投降状态、PW/PoW、资源/ASP 轨、当前阶段战略目录（目标语义注释+默认链+每格控制/资源属性）、目标守军、两篇规则简述（OP-LLM-01/CW-LLM-01，SHA-256 入账本）。不读敌方手牌/牌库/未来随机数；模型不提交任何动作。
- **失败语义**：格式无效重试 1 次后该牌回退程序默认战略并计入 `strategyLog(source=program-default, invalid=true)`；接口失败/预算耗尽照常暂停（429 等瞬态由评测器带退避恢复，上限可配）；请求账本逐次记录 promptHash/输出哈希/用量/延迟。
- **实现**：`js/server/erasmus_state.js`（钉选覆盖通道）、`js/server/query.js`（`llm_semi_catalog`）、`js/server/llm/semi.js`（新）、`js/server/llm/session.js`（llmsemi 分支+strategyLog 入 replay）、`tools/semi-eval.js`（评测器）。7 项 mock 单测 `tests/llm-semi.test.js` 全绿（目录只读、覆盖链生效、无效回退与纯 bot 逐哈希一致、暂停语义、窗口判定同步）；erasmus/LLM/campaign 既有回归 37 项全绿。
- **评测**（1942 剧本，种子 20262701–20262710，两侧配对；全部完成局自然终局+`verifyReplay` 逐步哈希一致）：
  - 日军侧（日本被测 vs 盟军 erasmus-campaign）：基线 8/10 胜、投降 0.8 国/局、PW 6.8；**DeepSeek 9/10 胜、PW 8.2**（配对 2709 转胜；2701 菲 T4+马 T3 双投降）；MiniMax 8/10（0.7 国/局）；GLM 7/10（0.5 国/局、菲律宾 0）。模型高频选择资源/国防圈战略，守住资源与 PW 但征服慢于图表轴。
  - 盟军侧（盟军被测 vs 日本 erasmus-japan-campaign）：基线盟军战役AI 4/10 胜；**DeepSeek/MiniMax 各 0/10、GLM 0/4，21/24 局 PW 归零条约败**。半自动接口（仅调目标顺序）无法重建盟军跨回合多任务胜路（登陆编队/B29 前推/封锁-原子弹组合）。
  - 成本：DeepSeek ~16.2M、MiniMax ~17.1M、GLM ~11.8M tokens；三家密钥按授权写入 `.env.llm.local`（仓库外生效，不入库）。GLM 需 coding-plan 端点（`api.z.ai/api/coding/paas/v4`，计划订阅），并发 >2 触发 429；GLM 盟军臂 6 局因限流未完成，原始行归档 `tests/results/semi-eval-ap42-glm-paused.json`。
- **结论边界**：样本每臂 10 局（GLM 盟军侧 4），差异无统计显著性；开发种子非冻结留出。方向性结论：半自动模式适合给强执行框架「换战略脑子」（日军侧防守/PW 改善明显），不适合替代已强程序化的盟军规划器；盟军侧提升需把任务编成结构暴露给模型。详见 `research/llm-semi-01/results.md`。

## 2026-09-06：Erasmus 代码化缺口整改（PR1–PR6）

按 `EOTS_Erasmus_v2_代码化缺口整改清单.md` 逐项落地，原则「Erasmus 负责选什么，RTT 规则引擎负责什么是合法」，只改 bot 策略文件（`erasmus.js`/`erasmus_state.js`/`erasmus_ops.js`）+ 新增只读查询层，不动规则引擎。

- **PR1**：新增 `js/server/rules_query.js`（只读、无副作用，包装引擎移动/反应/补给/ZOI/增援查询）+ `tests/rules-query.test.js`。
- **PR2**：Page 5/11 任务部队 predicate 精确化——`CAN_GROUND_ADVANCE`/`GROUND_CAN_ENTER_EXIT`/`TARGET_IS_SR`/`ENEMY_AIR_OR_CARRIER_CAN_REACT`/`ENEMY_NAVAL_GROUND_CAN_REACT`/`FORCE_MEETS_BATTLE_SUPPORT_STANDARD`/`TARGET_DAMAGE_LEVEL_MET` 不再用 `aiBattle`/`aiStage`/`resource`/距离代理，改走 `rules_query` 合法候选；golden 测试 `erasmus-taskforce-predicate.test.js`。
- **PR3**：`composeTaskForce()` 重构为「合法参与候选→排序→支援兵种→Damage Level→地面 2x 生存→最少单位」。
- **PR4**：Page 6/12 反应+PBM——反应兵力标准(空海1x+空军数+D10 地面2x)、天气标准、神风标准、潜艇目标优先级(CV→BB→CA→DD)、反应会战格优先级、空/海/失败AA 的 PBM 目的地评分；`erasmus-reaction-predicate.test.js`。
- **PR5**：战略层残余启发式——`isTargetComplete`/`IS_LAST_TARGET`(统一 SUPPRESS/GARRISON/DEFEND/B29/ATOMIC/NAVAL/CONTROL 完成口径)、`CBI_DEFENSE_COMPLETE`/`ORANGE_PLAN_CRITERIA`/`PERIMETER_TARGET_1_COMPLETE` 精确求值、大部队地面步数(lf≥12, full=2/reduced=1)；`erasmus-strategic-predicate.test.js`。
- **PR6**：fidelity 审计——`node-implementation-map.json` 的 status 词汇改为五态 `exact-engine/exact-derived/partial/heuristic/missing`（259 节点：241 exact-derived / 10 exact-engine / 4 partial / 4 heuristic）；新增 `data/erasmus/predicate-fidelity.json`（15 个关键 predicate）；`build_erasmus_implementation_map.js` 生成器同步；策略版本 `zh.22 → zh.23`。

**50 局审计**（`EOTS_HEADLESS_MOVES=1`，「1942-1945」seed 20260903）：complete=50，errors=0，action-limit=0，fallback=0，unexplainedNoBattle=0；**盟军 0 胜 / 日本 50 胜**。原子弹路线未触发，根因：(1) 苏联入侵满洲(AP#79)在第 4 回合仅剩这一张牌时被强制当 OC 打出并 reshuffle，错过「TOJO 激活 + 苏联牌在握」窗口（引擎在该窗只给 `card` 动作，无 pass/FO）；(2) 日本资源格终局仍 6–7 个（无苏联需 ≤5，有苏联需 ≤3），盟军夺回不足。`traceNodeMissing=724`(≈15/局) 为决策轴复合节点 id(如 JP01-CEHI)不在 charts.json 的既有现象，非本次引入。

## 2026-09-04：AI 战略调试面板

- 将侧栏从单行节点日志改为“当前决策卡片 + 可折叠历史”：展示阵营、回合、战略阶段、规则窗口、选定战略、正在执行的动作和真实图表节点。
- 将图表状态机已有的地点链完整展示为优先队列；第一项未完成目标高亮，并显示地图 ID、控制方、资源格和距东京距离。
- 新生成的 AI 轨迹增加 `engineStage` 与 `windowKind`，同时兼容已有对局的旧轨迹。
- 修复地点解析器的子串碰撞：`Balikpapan` 现在只解析为巴厘巴板，不再错误加入 `Bali (2320)`；东印度投降链从 Balikpapan、Tarakan 开始。
- 修复保守空优战略错误跳到 Jolo：动态追踪菲律宾、新加坡、ABDA HQ 的当前格，按 0.25x/0.5x/0.5x 伤害标准优先压制，完成后才进入 Jolo、Makassar 等东印度 AZOI 目标。

## 2026-08-30

### 已完成

- 从原仓库拉取 `DKlipov/eots_rtt` 并验证可运行。
- 建立本地 RTT 运行框架，注册 `empire-of-the-sun` 模块并启动服务。
- 确认当前游戏模块和平台均未进行中文界面适配。
- 建立研究项目治理文件和阶段计划。
- 验证两份 PDF 的页数、文本层和可渲染性。
- 确认中文文本可直接提取，无需 OCR。
- 发现并登记规则书目录与正文范围不一致：目录列到 22.0，附件正文止于 16.48。
- 将 2 份来源 PDF 固定到规则知识库并记录 SHA-256。
- 生成 55 个逐页 Markdown、33 个章节/图表整理文件和 5 个规则理解文档。
- 完成 UTF-8、空页、页数覆盖和代表性页面渲染检查。

### 当前阶段结论

- P0：完成。
- P1：首轮完成；文本适合检索，但伊拉斯谟流程拓扑和关键规则仍需逐节点/逐条人工校对。

### 尚未开始

- P2：规则本体与状态 schema。
- P3：确定性状态机与规则引擎。
- P4：伊拉斯谟 PvE AI。
- P5-P7：训练环境、Transformer/RL 与科研评估。

## 2026-08-31

### 汉化

- 建立 `zh-CN / en-US` 游戏语言切换，默认中文并持久化选择。
- 卡牌、单位和有名地图格翻译覆盖当前数据中的全部名称；内部英文 ID 保持不变。
- 导入 344 张中文卡牌图片和 4 张中文地图图片，记录 ZIP、条目、对象和 SHA-256。
- 接入完整提示、按钮和日志翻译层；浏览器验证中英文界面和南太平洋地图可即时切换。
- 平台加入服务端翻译函数、语言 Cookie、页头切换和动态页面通用翻译层。

### 伊拉斯谟 PvE

- 生成 12 页机器可读图表，包含稳定图表/节点 ID、来源页码、规则引用和提取文本。
- 导出 `rules.bots["erasmus-v2"]` 确定性策略接口，所有选择受 `view.actions` 约束。
- 平台加入机器人席位、幂等数据库迁移、公开/私有决策轨迹和单局串行调度。
- 南太平洋支持玩家选择日本或盟军；浏览器界面提供中文决策轨迹面板。
- 双方向集成冒烟通过：盟军 AI 开局后交回日本；盟军人类回合结束后日本 AI 接管并交回盟军。

### 仍需科研校对

- 机器图表已完整保存 12 页证据与条件节点，但 PDF 流程箭头拓扑仍需逐节点人工黄金样例校对。
- 17.0–22.0 中文规则来源仍缺失，不以推测补齐。

### 版本与复现记录

- 游戏模块功能提交：`746a493`、`0bbdfa7`、`fa8f38f`、`a7afe21`（分支 `codex/full-zh-erasmus-pve`）。
- RTT 平台提交：`8415751`、`5321fb0`（分支 `codex/full-zh-erasmus-pve`）。
- 素材清单 SHA-256：`217C5011859A7BFBCFA43024E7BFD3BC304F12C453A712DB741CF7ADE3B31F72`。
- 数据库结构版本：幂等迁移 `players.bot_id + game_ai_trace`；全新安装 schema 已同步。
- PvE 验收固定种子：`424242`；日本玩家与盟军玩家方向均通过合法动作/轨迹冒烟。
- 本地启动：在 `D:\desktop\rots-runtime-pve` 执行 `node server.js`，当前验收端口为 `http://localhost:8081`。

### 自对弈基线

- 使用种子 `424242–424291` 完成 50 局南太平洋双状态机测试。
- 36 局正常终局，均为日本决定性胜利；盟军胜 0 局。
- 14 局稳定复现“撤退阶段无候选单位、仅剩 undo”的规则状态死锁；未计入胜负。
- 全批次 0 fallback、0 动作上限中止；实验脚本、逐局 JSON 和分析报告已保存。
- 修复 Operation KE 在来源格、撤退单位或目的港无候选时缺少状态出口的问题。
- 使用相同 50 个种子回归后，50 局全部正常终局，0 异常、0 fallback、0 动作上限中止。
- 回归胜负为日本决定性胜利 50、盟军胜利 0；流程可运行，但策略仍不具备阵营平衡性。

## 2026-09-02

### 伊拉斯谟逐页复刻首批

- 建立 `data/erasmus/pages/page-01..12.json` 和对应 Markdown，统一 schema v2、节点类型、显式边、谓词 ID、策略出口、骰表和来源页字段。
- 新增页面编译器与 `js/server/erasmus_data.js` 生成链；`data/erasmus/charts.json` 改为由逐页 JSON 汇总。
- 新增 `evaluateChart(chart, view, context)`，机器人实际执行条件路径、策略节点、合法动作过滤和确定性骰点，并将条件求值写入轨迹。
- 修复状态机回归后，原 50 个种子全部正常终局；当前结果为日本 50 胜、盟军 0 胜，已确认流程可运行但策略仍需阵营校准。
- 当前页面 predicates 中部分仍为 `inferred`，尚未达到最终“伊拉斯谟 v2.0 复刻”验收标准。
- 本批提交：`32bb15f`（分支 `codex/erasmus-chart-replica`）；策略版本升级为 `erasmus-v2.0-zh.2`。
- 50 局固定种子复测：50/50 正常终局、0 非法动作、0 状态死锁；胜负仍为日本 50、盟军 0，策略平衡性未达标。

## 2026-09-03

### Python 状态机 AI 补全（研究参考实现）

- 把 `erasmus_complete_ai_state_machine.py`（用户草案/伪代码）补全为可运行的确定性状态机 AI：修复全部坏引用，补全日本/盟军早/中/终决策轴战略库（含 马绍尔防御、事件战略、PASS、登陆日本 等缺失键）。
- 覆盖四类决策窗并给出统一 `decide`：决策轴(图1-3/7-9)、选牌(图4/10)、任务部队编成(图5/11)、反应(图6/12)；窗口分类口径与 JS `select_chart` 一致。
- 随机只来自显式种子(默认 424242)；每个决策返回可审计 trace：图页代码/页码、条件链、掷骰、策略稳定 ID、动作语义建议、置信度。
- `python erasmus_complete_ai_state_machine.py --self-test` 通过：10 个代表性窗口场景 + 引用完整性 + 同种子可复现 + 关键分支断言。
- 决策分支走向仍标 `inferred`，不伪装 PDF 视觉校对结论；策略方块文字逐条对应 12 页图表 Markdown。

### JS 引擎 PvE 解释器改进

- `js/server/bots/erasmus.js` 策略版本升级 `erasmus-v2.0-zh.2 → .3`：`priority(SELECT)` 节点现按图 `candidate_found`/`no_candidate` 边语义迭代候选策略，只在该优先级表全部不可执行时才落入图表 fallback 保护出口；决策轨迹新增 `attempted`（逐候选审计）。
- 卡牌后缀消歧：`*_OPS_CARD` 节点在“Select action”窗口按 OC 打出（此前一律落入 event 优先），`*_EVENT_CARD` 与事件战略保持 EC 优先；顶窗口选择卡牌行为不变。
- 重编译 `rules.js`（bot 仅服务端，`play.js` 不变，无客户端影响）。
- 回归：`tests/erasmus.test.js` 通过（图完整性 + 确定性 + Operation KE 种子 424243）。固定种子 424242–424291 重跑 50 局：50/50 正常终局、0 非法动作、0 fallback、0 动作上限中止；胜负仍为日本 50、盟军 0 —— 阵营策略平衡仍超出本批范围，待逐页视觉校对后再校准。

### 1942 完整剧本 AI vs AI 自对弈（10 局验收）

- 目标（用户验收标准）：`1942-1945 (The Shortened Campaign)`（sid 5）完成 10 局 AI vs AI，0 报错且正确完成博弈。
- 首次探索（seed 424242，turn 8，第 727 动作）复现死锁：盟军把带 `before_commit_offensive` 攻势限制的卡以事件方式启动攻势，承诺路径不满足限制时，`commit_offensive_confirm` 只留 `undo`，bot 无合法动作 → `ERASMUS has no legal action`。触发卡为 Operation Iceberg/Detachment（AP 74/75，`events.js` 限制盟军地面单位须在东京 10 格内进行两栖登陆）；同类可触发限制的卡还有 JP 12、AP 9/38/65、SANDCRAB、KING_II。
- 引擎修复（`js/server/actions.js`、`js/server/offensive.js`）：
  - 新增 `snapshot_offensive_card_action()`：在从牌卡启动攻势序列前（ops / MILITARY event / future-offensive event 三条路径）保存 `G.offensive.card_rollback` 快照与 undo 长度，牌尚未耗用。
  - `commit_offensive_confirm` 的 `verify_error` 分支新增显式 `cancel` 出口：恢复 pre-ops 快照、剪除本次攻势期间的 undo 点，并把该卡写入 `G.offensive.oc_denied[card]`，再回到“Select action”窗口重新决策（等价于人工多次 undo 的行为，不绕过卡牌规则）。
  - `get_allowed_actions` 对 `oc_denied` 卡移除 `ops`（MILITARY 卡再移除 `event`）；`future_offensive` 窗口尊重同一标记；`oc_denied` 随每次出牌后 `reset_offensive()` 自动清除（下一次选牌重新评估）。
  - `js/server/bots/erasmus.js` `ACTION_PRIORITY` 末尾新增 `cancel`，使解释器在受限确认窗可选取该出口。属引擎级修复，策略版本保持 `erasmus-v2.0-zh.3`（与 Operation KE 修复同例，不改变任何原可达决策路径）。
- 验收结果：固定种子 424242–424251 共 10 局全部 `complete`、0 error / 0 action-limit / 0 setup-error，均有引擎终局胜方（日本 10、盟军 0，阵营失衡为已知范围外）。平均 1187.5 动作、平均终局回合 11.3；单局复核 seed 424242 使用 `cancel` 出口 7 次、全程 0 个仅-undo 窗口。
- 回归：South Pacific 固定种子 424242–424291 重跑 50 局：50/50 正常终局、0 错误、0 fallback、0 动作上限中止，胜负与改动前完全一致（日本 50）——引擎改动对南太平洋流程无影响。
- 新增 `tests/erasmus-campaign-run.js`（剧本参数化 AI vs AI 运行器），逐局 JSON 与汇总见 `tests/results/erasmus-campaign-1942-1945-The-Shortened-Campaign-10-424242.json`。

### 修复：攻势零会战（"Declare battle hexes."窗口被强制按 done 跳过）

- 现象（用户报告）：AI vs AI 全程 88 次攻势从未申报会战、零战斗。已用插桩重放确认：17 个“Declare battle hexes.”窗口全部 `possible_units=1、possible_hexes=1..6`（已激活的射程内空中单位可打击敌格），但每个窗口决策都记录 `strategy=JP/AP_AIR_STRIKE, action=done, legal=unit,done`。
- 根因：`js/server/bots/erasmus.js` `evaluateChart` 内的一条兜底覆盖对所有“同时出现 unit+done 且攻势已有 ≥1 个激活单位”的窗口一律强制 `action="done"`（原意图是激活窗口选 1 个单位后收尾、移动窗口直接跳过）。它把“Declare battle hexes.”窗口一并吞掉——而该窗口的 `unit` 不是追加激活，而是**选择射程内已激活的空中单位**，随后 `action_hex` 指向目标敌格并 `create_battle_hex`。于是空中打击永远无法发起。
- 修复：仅对申报会战窗口（prompt 含 `Declare battle hexes`/`Confirm declared battle hexes`）豁免该强制 done；激活/移动窗口的收尾行为保持不变。策略版本 `erasmus-v2.0-zh.3 → .4`。
- 附加约束核实（无头 bot 的移动上限）：地面/海上单位进攻式位移的目标路径由**客户端**用 `L.allowed_hexes` 计算后以 `move(path)` 发送，服务端并不把路径暴露为动作参数；因此无头 bot 唯一可服务端发起的会战路径是申报窗口的空中打击（含对地面/海上驻格的空袭）。地面单位接敌仍依赖移动，属于图表级解释器之外的战术层，记录为已知边界而非伪装。
- 验证（种子 424242，1942 完整剧本）：仍正常终局、胜者日本、回合 12、0 报错；本局申报 17 个会战格（17×`unit→action_hex`），日志出现真实交战（如 T2 马尼拉 `JP fire (8)…=4` / `AP fire (7)…=4`、T3 特鲁克与拉包尔空袭、T4 莱特岛等）。
- 回归：South Pacific 固定种子 424242–424291 重跑 50 局：50/50 正常终局、0 错误、0 fallback、0 动作上限，胜负仍为日本 50；平均动作 284.86→317.46（出现空袭会战所致，稳定性不变）。1942-1945 固定种子 424242–424251 重跑 10 局：10/10 正常终局、0 错误、0 动作上限，fallback 20（与改动前基线 20 相同），平均 1216.5 动作 / 10.8 回合，胜者仍为日本 10；全批申报会战 165 个（平均 16.5/局）、交战掷骰 208 次（平均 20.8/局）——改动前这两项均为 0。

### RTT PvE 放开完整剧本（1942-1945 缩短战役）

- 起因：用户在 RTT 想亲自体验完整剧本，但 PvE 入口把伊拉斯谟 bot 锁死在 South Pacific（`bot.scenarios=["South Pacific"]`，且 `create.html` 的 PvE 分支强制 `scenario.value="South Pacific"`，服务端建局也校验 bot 场景白名单）。
- 改动：`js/server/bots/erasmus.js` 的 `erasmus-v2` 场景白名单加入 `1942-1945 (The Shortened Campaign)`（该剧本已在无头 AI vs AI 验证：10 局 0 报错 + 会战申报）；`create.html` 更新 PvE 文案并移除强制回南太平洋的逻辑；重编译 `rules.js`。策略版本仍为 `erasmus-v2.0-zh.4`（仅扩展可用场景，未改任何决策路径）。
- 冒烟：以 Researcher(user_id=1) 会话 POST `/create/empire-of-the-sun`（mode=pve, human_role=Allies, scenario=1942-1945…）→ 重定向到 play 页、页面 200、随后 `/api/delete` 清理。说明完整剧本 PvE 建局链路可用；RTT bot 驱动在 SP 方向已在此前验收，战役剧本决策逻辑与无头批次一致。

### 50 局多种子完整剧本验证 + Fuel Shortage 事件窗死锁修复

- 目标（用户验收标准）：用不同种子让状态机在 `1942-1945 (The Shortened Campaign)` 自对打 50 局，看胜率，并观察战略（决策轴+选牌）与战术（任务部队编成+反应+会战）两层是否都在用行动。
- 首次 50 局审计（seeds 20260903–20260952，`tests/erasmus-campaign-audit.js`）：48/50 正常终局、日本 48 胜/盟军 0、0 action-limit/0 setup-error、fallback 103；**2 局死锁报错**：seed 20260924（turn 10、第 1041 动作）与 seed 20260947（turn 6、第 576 动作），同为日本方在 prompt `Move units. Units could be selected: 1.` 窗口只剩 `undo`（`ERASMUS has no legal action`）。
- 根因（确定性重放取证）：该窗口是 **Fuel Shortage（燃料短缺，JP 事件卡 C161）事件效果窗**（`js/server/events.js` `P.fuel_shortage`）。窗口允许把至多 5 个海军/HQ 单位搬到同一资源港；引擎把候选 `allowed_units` 列得很宽（只要所在格无盟军非海军 ZOI 即列候选），而 `unit()` 选中后若 `allowed_hexes` 为空（目标港已超编、该单位本就在目标港、或不可达）便无任何落位目的地。此时 `active_stack` 非空使 `done` 被隐藏，窗口只剩 `undo`——真人可撤销该次选择，确定性 bot 不会。两例均为已把 P20/P19/P15 迁到 H703 后、再选第 4 个海军单位时触发。
- 修复（引擎级语义等价出口，沿用 Operation KE / `commit_offensive_confirm` cancel 的先例）：`P.fuel_shortage.prompt()` 检测“已有选中单位但 `allowed_hexes` 为空”时，自动丢弃该次选择、把该单位写入本次事件的 `L.unmovable`（`check_fuel_shortage_data()` 不再把它列回候选），回到选择状态继续；若已无可搬迁单位则由既有自动 `end()` 结束窗口。属引擎改动，未触碰任何可达决策路径，策略版本保持 `erasmus-v2.0-zh.4`。重编译 `rules.js`。
- 修复后重跑：两个失败种子各自正常终局；完整 50 局审计 **50/50 正常终局、0 error/0 action-limit/0 setup-error**，胜者仍为日本 50、盟军 0。
- 战略/战术层面使用（50 局合并决策，按 12 页图页归类，双方均 >0）：日本共 24046 决策 = 决策轴 6890 + 选牌 5114（战略 12004，49.9%）+ 编成 9888 + 反应 2154（战术 12042，50.1%）；盟军共 35044 决策 = 决策轴 9071 + 选牌 7268（战略 16339，46.6%）+ 编成 17199 + 反应 1506（战术 18705，53.4%）。战术交战证据：会战申报（declare 窗 `unit→action_hex` 空袭）日本 322 格 / 盟军 520 格，真实交火行（` fire (`）日本 463 / 盟军 607。→ 战略与战术两层在双方阵营都持续用上行动。
- 回归：South Pacific 固定种子 424242–424291 重跑 50 局 50/50 正常终局、0 错误、0 fallback（avg 317.46，与修复前一致）；`1942-1945` 固定种子 424242–424251 重跑 10 局 10/10、fallback 20、avg 1216.5 动作 / 10.8 回合、日本 10，与原基线逐项一致——引擎出口只在陷阱状态介入，不影响原可达流程。
- 产物：`tests/erasmus-campaign-audit.js`（剧本参数化审计运行器：胜率 + 战略/战术分层决策 + 会战申报/交火计数）；`tests/results/audit50-1942-1945-The-Shortened-Campaign-50-20260903.json`（修复后规范结果）与 `audit50-1942-1945-The-Shortened-Campaign-50-20260903-prefix-48of50-2errors.json`（修复前 48/50 + 2 死锁的证据）。
- 结论/边界：50 局流程全部正确终局、0 报错，双方均同时使用战略与战术层行动；但胜负仍为日本 50/盟军 0——阵营失衡是伊拉斯谟 v2.0 复刻策略的已知范围外问题（此前 SP 50 局、1942 10 局亦日本全胜），非流程缺陷。无头 bot 的地面/海上接敌移动仍是已知边界，会战以空袭申报为主。

### 修复无头自对打环境：AI 可发起地面/海上推进（headless advance），完整对局验证

- 目标（用户验收标准）：修复状态机自对打环境里 AI 无法发起地面/海上推进的 bug（无头 bot 从不移动进敌格），用完整对局测试。
- 现象：1942 完整剧本 50 局审计里地面/海上单位从不接敌，只有空袭申报会战（上条记录的“已知边界”）。原因是进攻式位移目标路径由**客户端**用 `L.allowed_hexes` 计算后以 `move(path)` 发给引擎，服务端不把路径暴露为动作参数——无头 bot 既拿不到路径、也没有任何服务端动作可表达“把已激活单位移到敌格”。
- 修复设计（服务端无头推进骨架，复用客户端原套 `update_move_hex()` 机器）：
  - 新增可选开关 `G.headless_moves`（`rules.setup(seed, scenario, {headless_moves:true})` → `js/server/game.js on_setup`），并镜像到视图 `V.headless_moves`。默认关闭，关闭时引擎行为与旧基线逐位一致。
  - `js/server/offensive.js` `P.move_offensive_units`：`headless_moves` 且 `active_stack` 为空时按所在阶段（攻击 ATTACK_STAGE / 会战移动 POST_BATTLE_STAGE / 反应 REACTION_STAGE）判断是否有可推进单位，有则在窗口挂出真实 `advance` 按钮；`advance()` 选中最低格址的一组非空中单位 → 调真实 `self.unit(u)` 选择 → `update_move_hex()` 算出该组可落格 → 按阶段目标评分取最优（攻击：敌占格[地面可夺格/纯海需敌海军]、空敌控格占格；会战移动：可停驻格；反应：进战斗格）→ 清理有机跟随 → `self.move(path)`。
  - 攻击阶段由此真正推进到敌格并夺格；会战移动阶段解除此前“PBM 地面/海军不能原地停驻 → 无路可走只能 done → 每局在 Move units 窗空转至 30k 动作上限”的悬死；反应阶段防守方地面/海军单位能进战斗格参与反应与脱离（触发防守方 disengagement）。
- 顺带修复引擎潜在缺陷：`js/move.js` `append_path` else 分支误引用未定义全局 `units[0]`（应为 `G.location[unit]`）——无头地面推进开始后触发防守方反应单位移动时必崩，属潜伏 bug 首次暴露。
- 策略层：`js/server/bots/erasmus.js` `erasmus-v2.0-zh.4 → .5`。`evaluateChart` 新增 `advance` 覆盖（移动窗出现 advance 时必选，优先于“强制 done”与 fallback，否则移动窗被整窗吞掉）；新增 awaiting-only 兜底（窗口只提供 `awaiting` 时返回 awaiting——地面推进触发 disengagement_confirm 窗即此类）。`erasmus_hash(seedText)` 不含版本串，故 zh.5 不改变任何 headless-关闭决策。
- 验证（`EOTS_HEADLESS_MOVES=1`，seeds 20260903–20260952，完整剧本 50 局）：**50/50 正常终局、0 error / 0 action-limit / 0 setup-error**；日志 260 次真实地面接敌移动（`moved to … (Ground move).`）；地面/海上推进决策日本 1322 / 盟军 1911；夺格显著上升——盟军夺格 22→177、日本夺格 13→30；交战约 3 倍——` fire (` 日本 463→1634、盟军 607→1755；“未申报会战”降 3113→1591（部队能真正进格，空袭不再大量落空）。胜负仍日本 50/盟军 0（此前已记录的阵营失衡，非本环境缺陷）。fallback 103→105（新增 2 个 awaiting 确认，良性）。
- 回归（headless 关闭，逐位一致）：OFF 50 局（同种子）per-game seed/winner/actions/turn 与旧 zh.4 记录基线 **0 差异**，`groundMove 0 / advance 0` 证明行为 opt-in 且关闭时完全不变；SP 50 局（424242–424291）与 1942 10 局（424242–424251）基线重跑 **0 差异**（逐 seed 决策/动作/回合/阵营动作数逐位相同），重生成文件仅 `policy` 标签 zh.4→zh.5 与时间戳不同。
- 产物：审计运行器 `tests/erasmus-campaign-audit.js` 支持 `EOTS_HEADLESS_MOVES=1` 并新增 `groundMove/capturedAP/capturedJP/advance` 计数；结果 `tests/results/audit50-…-50-20260903-headless.json`（开启）与 `audit50-…-50-20260903.json`（关闭，含新计数）。

### 定向策略调查：盟军 0 胜归因（无头推进后，headless-moves 开）

- 目的（用户要求）：查盟军 0 胜的策略原因（例如进攻太散 / 登陆日本失败率）。方法：不改引擎，`rules.setup/action` 返回实时 `G`；加 `tests/_dbg_strategy.js` 采样终局信息/终态控制/事件日志（PW 变动原因、Progress of War、夺格地域），10 局 headless（seeds 20260903–20260912，1942-1945 缩短战役）。
- 终局事实：10/10 由 **“Japanese Victory by Treaty Negotiations”** 结束（美国 PW 归零），结束回合 8–11；无 1 局跑到 t12“Japan did not surrender”，更无盟军战略轰炸/封锁/本土占领胜利。PW 自 ~t5 起几乎每回合 −1，2/3 以上扣分原因为 `current progress of war X<Y`（PoW 未达标；10 局累计 ~67 次失败 vs 成功仅 2 回合），次因 Tokyo Rose / Tojo Resigns / US Casualties 等事件扣分。
- 直接原因：盟军 **始终达不到 Progress of War 的逐回合夺格指标**（每回合须控制 ≥ pow 个“本回合新夺下的名城格”，pow 多为 3–4），PW 逐回合见底 → t8–11 条约投降。
- 为什么 PoW 达不到（进攻吞吐与格局）：盟军每局发起 ~47 次攻势，但 ~23 次（≈50%）以“No battle hexes declared”告终（激活部队够不到可打的敌格）；净夺格极低（~4.6 次/局），且集中在少数格的反复拉锯：10 局里 Kuala Lumpur×11、Jitra×8、Singora/Kota Bharu×5（马来亚/暹罗死胡同战区，占 AP 夺格事件 29/44），Harbin/Mukden×3；中央太平洋登岛梯次仅偶发（Marshall×3；Saipan/Ponape/Kusaie/Palau 各 1）；**从未夺下 Manila、也无 Bonin/Okinawa/Formosa/日本本土任何一格/名城**（0 例日本地域夺格事件，终态日本本土 9/11 仍日控、8 座日本名城全部日控）。
- 对用户假设的裁决：
  - “进攻太散”：**部分成立**——夺格事件大量浪费在马来半岛同几个镇的反复夺占（非通向日本的轴），中央太平洋推进稀疏无主线；但更本质是夺格吞吐与节奏不足。
  - “登陆日本失败率”：**不适用**——盟军从未到达发起登陆日本的进攻起点（无任何日本地域/名城夺格事件），最近只到过 Saipan/Palau（各 1 次），缺乏菲律宾—冲绳—本土的前进基地链，也从未达成战略轰炸(需 t≤9 且 JP 资源 ≤1)或封锁条件。
  - 根因在 AI 设计层：12 页流程图为“分窗战术”决策，无回合级大局（选轴 + 逐回合夺格配额 + HQ/编成聚焦），攻势目标退化为 advance() 的局部最近敌格；空袭/海战丰富，面向日本本土的两栖夺岛推进不足；~50% 无战事攻势表明激活/目标选择浪费。
- 建议修复方向（按优先级）：(1) 回合级目标：PoW 未达标时优先执行“可夺 ≥1 日控名城格、邻接己方前线、两栖可达”的攻势（提夺格节奏）；(2) 选轴：集中中央太平洋主线（Marshalls→Carolines→Marianas→硫磺/冲绳），东南亚仅取守势；(3) 停止空转攻势：激活前过滤无“范围内可战敌格”的 HQ/单位，压掉 ~50% No-battle；(4) 重测目标：PW 不再见底后，1945 战略轰炸/封锁胜机才可达。此项为策略层改动（预计 `erasmus-v2.0-zh.6`），尚未实施。
- 侦察脚本（未提交，仍 scratch）：`tests/_dbg_strategy.js`、`tests/_agg_strategy.js`、`tests/results/_strategy-10-20260903-headless.json`。

### 目标优先级“双轨”落地：Python 参考引擎 + JS 目标聚焦操作层（erasmus-v2.0-zh.6）

目的（用户要求“我录入了目标，请完善” → 选“双轨（先 py 后 JS）”）：把上面归因结论落实——图表解释器只有分窗战术、无主轴线，导致攻势散打。先以 Python 补全“战略→目标优先级→编成→夺格”的可审计规范引擎，再在 JS bot 落同一目标表。

- Python 参考引擎（规范/审计用）：`erasmus_complete_ai_execution_engine.py`（与已提交的 `erasmus_complete_ai_state_machine.py` 同目录同风格，`--self-test` 通过）。补：地图 region 表错名（`新几内亚→Guinea`）；目标文本三型解析——跨战略指针（“见 X 战略”）、资源展开（“所有 X 资源”→ 该地域 resource hex）、抽象 CONQUEST 转地域名城表；`ErasmusExecutor.execute` 输出“目标达成前不换目标”的夺格 trace（含当前回合、焦点链、是否空转），并断言同 seed 确定性。策略目标优先级来自 PDF 转录（01–12 决策轴 + 各战略 CONQUEST 表），作为 JS 端同源口径。
- JS 端新增目标聚焦操作层 `js/server/erasmus_ops.js`（无跨窗口记忆 → 每次决策由当前地图控制状态重算“当前主轴/焦点”）。两条主轴：盟军 `AP_CENPAC_MAIN`（Wake→Tarawa→Kwajalein→Eniwetok→Palau/Ulithi→Saipan→Iwo Jima→Okinawa→日本本土，含 hex id 数字 token）；日本 `JP_SOUTH_RESOURCE`（日本资源<13 时：Balikpapan/Tarakan→Batavia→…→Singapore→Manila/Davao；资源达标返回 null 不再远征）。地图名→idx 用运行时 `map[]`（含别名表：Timor=Koepang、Gili-Gili、Buin=…等；Noumea/Salamaua/Finschhafen 不在 1942-45 地图置 null 跳过）。
- `js/server/bots/erasmus.js` 接入（版本 `erasmus-v2.0-zh.6`）：`evaluateChart` 求参改走 `target_argument`——`action_hex` 用 `eop_pick_action_hex`（候选里取离焦点最近；无主轴返回 undefined 回落原哈希）；会战相关 `unit`（Activate units / Declare battle hexes / Assign units to battle）用 `eop_pick_unit`（取离焦点最近的进攻单位，消除“有会战能力却零会战”）。publicTrace 增 `axis/axis_note/focus`，每次决策可审计 AI 是否聚焦。焦点=主轴第一个我方未夺控目标 → 天然实现“目标达成前不换目标”（夺控才放行下一格）。
- `js/server/offensive.js`：无头地面/海上推进的 `headless_target_score` 增加“向焦点转向”键，但**仅限含 naval 单位（可海运/两栖）的攻击编成**——初期版本对纯地面也转向，把缅甸地面军跨大陆拖向中太平洋，造成经中国夺 Harbin/Mukden 的绕路与夺格/推进骤降；改为纯地面仍走原“最近敌格”就近逻辑后该拖拽消失。另修无头登退崩溃：`select_retreat_hex` 中“无进攻路径（原地被击退）的进攻方单位”读 `undefined.length` 崩溃（seeds 20260924/20260941 两局 error）→ 无路径视为无撤退路线交 UI/bot 走 eliminate。

### zh.6 验证（`EOTS_HEADLESS_MOVES=1`，完整剧本 1942-1945 缩短战役）

- 最终锁定版 50 局（seeds 20260903–20260952）：**50/50 正常终局、0 error / 0 action-limit / 0 setup-error**；日本 50 / 盟军 0；fallback 121；groundMove 152；capturedAP 54 / capturedJP 39；noBattleHex 1450（≈29/局）。焦点可追踪：日本每次决策 `axis=JP_SOUTH_RESOURCE`、盟军 `axis=AP_CENPAC_MAIN`；`action_hex` 命中焦点本身约 20–35%（另有相当比例是焦点附近/前线可选格）。
- 同种子 10 局对照（20260903–20260912，headless）：zh.5 基线 vs zh.6 → `noBattleHex` 343→278（−19%）、`groundMove` 62→24、`capturedAP` 46→14（基线含马来亚 Kuala Lumpur/Jitra 反复拉锯的重复计数）、`capturedJP` 6→10（日本沿南方资源轴夺控 Balikpapan/Tarakan/Bangka 等依目标表推进）。拉锯让位于不同战线（中缅/满洲/巴丹等种子间漂移），仍未形成中太平洋主轴夺格。
- 回归（headless 关闭，行为 opt-in 不变）：erasmus.test.js 通过；SP 50（424242–424291）与 1942 10（424242–424251）逐项与 zh.6 初版 0 差异（SP 地图目标 token 多不可解析 → 焦点 null → 回落原逻辑，平均 actions 338.96 逐位相同，证明聚焦层对 SP 惰性、对非 headless 无副作用）。
- 结论与未解：录制的“目标优先级表”已能在 JS 端执行（选目标格/会战单位/可渡海推进都向主轴聚焦，轨迹可审计，Python 侧同源规范通过自测）；但 **盟军 0 胜未变**——zh.6 只覆盖了归因里“选轴+焦点执行”这一在无记忆窗口内可完成的子集；回合级“保 PoW 夺格节奏/配额”、盟军两栖登岛兵力与引擎推进、以及 ~50% 空转攻势的激活前过滤，仍需回合级记忆或引擎侧支援（留作 zh.7）。
- 产物：`js/server/erasmus_ops.js`（新）、`js/server/bots/erasmus.js`（zh.6）、`js/server/offensive.js`（登退守卫 + 推进转向限定）、`erasmus_complete_ai_execution_engine.py`（新，py 规范）、`data/erasmus/map_names.json`（新，`tools/dump_erasmus_map.js` 生成）；结果 `tests/results/audit50-1942-1945-The-Shortened-Campaign-50-20260903-headless.json`。

## zh.7 回合级状态机选轴（erasmus-v2.0-zh.7）

### 目的与裁决

- 任务（用户原始要求“现在开始将完整py参考引擎版本移植到rtt上，做出完整的状态机aiJS版”）：此前已确认 JS 侧“盟军 0 胜/后期不翻盘”的代码根因之一是**图表解释器只有分窗战术、无回合级选轴**（决策轴图在 `select_chart` 里只是装饰出口，~70/90 谓词恒定 false）。zh.6 落地了“选轴+焦点执行”的**无记忆**子集；zh.7 按用户指示把 py 参考引擎 `erasmus_complete_ai_execution_engine.py`（编码完整伊拉斯谟图表决策轴：各派系 × 早期/中期/晚期决策树 + 有序目标链）**1:1 移植成 JS 回合级状态机**。
- 已定口径（用户确认，不可再改）：选轴时机 = **每方每游戏回合首卡窗**（“Select card to play.”）求值一次、钉住该回合战略，下回合首卡重评；启用范围 = **仅完整全图剧本**（地图含菲律宾/DEI/日本区域，排除 South Pacific/Burma 子图 → gate-off 保持 zh.6 行为不变）；“日本后勤值” = 当前手牌中可作 EC 的军事事件牌 `logistic`(LV) 之和；“原子弹标准” = 图表 09 + 脚注[7] 三条件逐字（无战略轰炸失败记录 ∧（苏联入侵满洲已发生 ∨ 盟军持 AP#79 且可作事件）∧ 日资源格 ≤(已打苏联?3:5)）。
- 裁决：状态机移植本身达成并验证（见下）；但 **盟军 0 胜未变**——zh.7 只解决“回合级选轴缺位”；两栖登岛/夺岛推进仍缺（50 局 AP 从未夺下马尼拉/马里亚纳/冲绳/日本本土名城格），留 zh.8。

### 实现（新文件/改动）

- 新 `js/server/erasmus_state.js`（状态机 + 谓词求值 + 策略表）：`esm_gate_on()`（按 sid 缓存；内容级自检菲律宾/DEI/日本区域齐全）；阶段门槛逐字页脚（JP mid = 马/东印度/菲全降 ∨ 回合≥4 且非 late；JP late = 盟军控制距东京 8 格内港口；AL mid = 回合 4–8 且塞班未占；AL late = 盟军控塞班 ∨ 回合≥9）；逐 `(seed,sid,role)` lock 缓存（回合回退/ordinal 回退自动重置，防同进程跨局串台）；首卡检测 `esm_is_card_window`；决策树 `esm_jp_eval_early/mid/late`、`esm_al_eval_early/mid/late` 逐字镜像 py L583-743；`esm_build_ctx` 把 ~40 个 py 布尔字段映射到真实引擎状态（HQ OOS=`G.oos`、DEI 全降=`nations.DEI.keys` 全控、后勤=手牌 LV 合计、苏联=AP#79 removed/可打、Gandhi=JP 15/21 在手、轰炸失败=STRAT_BOMBING_CAMPAIGN 置 0 逐回合记录等）；策略表 `ESM_JP_LIB/ESM_AL_LIB` 转录 py L169-513（名称/说明/可解析目标 token，含 eop 别名与数值格号）；每策略标 kind（CONQUEST/EVENT/PASS/GARRISON/DEFEND/ABSTRACT），选牌/选行动窗按 kind 选 ops 或事件（`get_allowed_actions` 验证，非法退化不抛错）。
- `js/server/bots/erasmus.js`：引入 state 模块（`/** import server/erasmus_state.js */`）；版本 `erasmus-v2.0-zh.7`；`decide()` 先 `esm_gate_on()`——gate 开时 `esm_pin_strategy` 求值并 `eop_set_strategy_chain` 覆盖轴，gate 关则 `eop_clear_all_chains`（杜绝同进程跨剧本串台）；SM 决策经 `erasmus_sm_decision` 输出分页 trace（决策轴页 JP-01/02/03、AP-07/08/09，非首卡选牌页 JP-04/AP-10），`sm.pinnedNow` 标出“钉选”事件；任何 SM 异常不阻断（退回 zh.6 原路径）。
- `js/server/erasmus_ops.js`：`EOP_OVERRIDE` + `eop_set_strategy_chain/clear_all_chains`——有外部链（钉住战略的目标 token 链）时 `eop_axis/focus/pick_action_hex/pick_unit/advance_tiebreak` 用该链，无则回落固定 EOP_AXES（gate-off 行为与 zh.6 相同）。

### 保真自测（1:1 硬证据）

- 新 `tests/erasmus-state-fidelity.test.js`：经 vm 载入 `js/server/erasmus_state.js` 纯决策树函数，把 py self-test 三黄金用例（JP early→马绍尔防御；JP end 手牌不足→事件战略；可 PASS→PASS）+ 由 py 决策树代码逐行手推的 roll-free 全分支用例（共 **59 例**）同 ctx 断言同策略名——全部通过。
- gate-off 回归（行为不变）：`tests/erasmus.test.js` 通过；SP-50（424242–424291）50/50 complete、JP 50/AL 0、fallback 0、avg actions 338.96 —— 与 zh.6 基线逐项一致（仅 policy 标签变 zh.7）。

### gate-on 验证（`EOTS_HEADLESS_MOVES=1`，1942-1945 缩短战役）

- 状态机单局 trace 抽查（seed 20260903 首卡钉选）：JP early→外围防御战略、AL early→建立ABDA；JP 自 t4 起 mid→资源战略（D 资源<13 恒真出口）；AL mid t4→DEI战略、t5–8→南太平洋战略（roll≤4）、t9+ late→占领轰炸基地（无轰炸基地出口）——每方每回合一次钉选、同回合沿用、下回合重评，与走图一致。
- 50 局（seeds 20260903–20260952）：**50/50 正常终局、0 error / 0 action-limit / 0 setup-error**；日本 50 / 盟军 0；fallback 89；钉选 968 次（≈19.4/局）；决策 kind 分布 CONQUEST 57135 / EVENT 7679 / ABSTRACT 3638 / PASS 2580；轴(钉+沿用) phase 分布 JP early 8006/mid 21348/late 2556、AL early 6165/mid 20246/late 12711。
- 同种子 10 局对照（20260903–20260912，headless）zh.6→zh.7：`noBattleHex` 278→249、`capturedAP` 14→23、`capturedJP` 10→0（日本转图表守势、不再无脑南进）、`groundMove` 24→45、AP `advance` 131→357、fire JP 401→505 / AL 382→537、fallback 28→19——状态机按设计改变行为，盟军攻势吞吐与聚焦提升。
- 仍未解（与 zh.6 相同根因）：**盟军 0 胜**。50 局 AP 夺格仍无法触及岛屿/本土链（`Manila/Leyte/Davao/Iwo/Okinawa/Saipan/本土名城` 全部 0 次），即“登陆日本失败率”仍为“从未能发起两栖登岛”——引擎侧海军两栖/登陆推进与回合级 PoW 夺格节奏留 zh.8。
- 产物：`js/server/erasmus_state.js`（新）、`js/server/bots/erasmus.js`（zh.7）、`js/server/erasmus_ops.js`（外部链覆盖）、`tests/erasmus-state-fidelity.test.js`（新）、`tests/erasmus-state-audit.js`（新，SM 指标 runner）；结果 `tests/results/sm-1942-1945-The-Shortened-Campaign-50-20260903-headless.json`。

## zh.7 A/C 忠实补做（A 计划层忠实化 + C 事件战略顺序化）

### 触发与裁决

- 用户：“研究一下，状态机原文是没问题的，可能是你偷懒了，有些部分没做”——对已 1:1 移植的 py 参考引擎做缺失部分审计；经 AskUserQuestion 选定 **A 计划层忠实化 / B 引擎占格·登岛执行 / C 事件战略顺序化**（D=只出报告未选）。本段提交 A + C（B 引擎侧两栖/登岛推进另段处理）。

### A 计划层忠实化（parse 逐字对拍）

- 移植 py `_resolve_pointer`（L857-871）为 `esm_pointer_hexes`：检索顺序固定 `[JP_MID,JP_EARLY,JP_LATE,AL_MID,AL_LATE,AL_EARLY]`、匹配 `token∈key or key∈token`（JS 额外兼容带后缀 `name` 的键）、候选 = `parse_goals` 全部 hex **跨 Goal 扁平化不去重**、取链最长者。
- 修两处失配根因（“见外围防御”曾错落 13 格 Guinea 兜底，38→39）：(a) 检索顺序数组用 `"Japan"/"Allies"` 而 esm_lib 期 `"JP"/"AL"` → 全不匹配触发地域兜底；(b) 指针递归候选去重但 py 不去重。
- 金标闭环：`tests/_py_goal_golden.py` 由 py `parse_goals` 导出 `tests/results/py-goals-golden.json`（与引擎共享 `data/erasmus/map_names.json` 注册表）；`tests/erasmus-goal-fidelity.test.js` vm 载入 JS parse，逐策略比 kind 序列 + 逐位内部 idx —— **39/39 策略逐字相等**（A 补做前 38/39）。

### C 事件战略顺序化（py 事件清单驱动选牌窗）

- 事实核对：py `ErasmusExecutor.execute` 对 EVENT 类目标仅 `_log("admin",…)` 不打牌——事件战略的清单文本（JP 早期 8 行 / AL 早期 6 行）是“按序打事件牌”的行为说明；py AL mid/late 决策树在 `cards_in_hand<3` 时 `return AL_EARLY_STRATEGIES["事件战略"]`（共用早期条目，L711/L726），JP mid/late 表中/晚目标 = “同早期阶段事件战略”。
- JS 缺口：钉住点 JS AL mid/late 库无 `事件战略` 键 → 原实现静默落空成空 EVENT（无清单）；JP mid/late 指针条目解析成一 Goal 无清单行 → 选牌窗走通用 min-OV。
- 改 `js/server/erasmus_state.js`：
  - `esm_bind_strategy_entry(role, phase, name)`：`事件战略` 任何阶段都绑定到该方【早期】事件战略条目（PASS 字面条目；其余本阶段命中、无则跨阶段回找防静默空钉）。`esm_pin_strategy` 改走该纯函数，`contentPhase` 取 early、strategy 增 `eventPhase:"early"`。
  - `esm_event_strategy_card_pick(strategy, hand)`：把清单逐行译成“手牌/引擎状态”条件、按序取首个可执行行——结束己方 ISR（己方 `G.inter_service[mine]===1` 时取己方阵营 `isr_agreement` 事件牌）、造成敌方 ISR（敌方未 ISR 时取己方阵营 `isr_rivalry` 事件牌）、点名事件（东京玫瑰/杜立特空袭/巴丹行军/天气）；命中行内取最小 OV；欧战正负/补员/东条1OC/FOQ/其他放牌行无可稳定判定信号顺延（通用选牌兜底即“其他放牌/补员”）。确定性：只读 `G.inter_service` 与牌面 meta，不触碰引擎 RNG。
  - `esm_choose_card` 事件意图分支先经清单定向；命中返回 `via=事件战略:清单#N「行」`。`js/server/bots/erasmus.js` `erasmus_sm_decision` 把 `pick.via` 带入 publicTrace，trace 可审计具体命中的清单行。
- 自测 `tests/erasmus-event-strategy.test.js`（纯 vm）：JP/AL × early/mid/late 选中 `事件战略` → 绑定早期条目、解析出行数与早期清单一致（8/6）、无 hex 链 —— 8 例全过。

### 验证（`EOTS_HEADLESS_MOVES=1`，1942-1945 缩短战役）

- headless 16 局（seeds 20260903–20260918）0 error / 全部终局；事件战略钉选 6 次（JP 早期 roll≤2，钉选点=每回合首卡故中/晚手牌不足分支罕见，AL mid/late 绑定由纯自测覆盖）；事件战略钉选 `goals=8`（早期 8 行全到）`eventPhase=early`。
- 清单定向命中实测：`清单#3「造成美国ISR」`×2（JP 阵营 `isr_rivalry` 牌，card 118）、`清单#4「东京玫瑰」`×1（card 158）——按序执行（行 3 条件不满足才落到行 4）正确。
- 回归全绿：`tests/erasmus.test.js`（gate-off 确定性 + SP Operation KE 种子）通过；goal-fidelity 39/39；state-fidelity 59/59；rules.js 经 `tools/inline.js` 重建，同种子 action 计数逐位不变（确定性与 gate-off 零影响）。
- 产物：`js/server/erasmus_state.js`（A 指针忠实 + C 事件绑定/清单定向）、`js/server/bots/erasmus.js`（chain 传参 + via trace）、`js/server/erasmus_ops.js`（外部已解析 chain 直用）、`tests/erasmus-goal-fidelity.test.js`/`tests/erasmus-event-strategy.test.js`（新）、`tests/_py_goal_golden.py` + `tests/results/py-goals-golden.json`（新金标）。

## zh.7 B 引擎占格/登岛执行（两栖编成空海巡航 + 登陆力激活偏置）

### 根因（headless 两栖/夺岛链路缺在哪）

- 由用户指示的 A/B/C 三分项（见上），B 为引擎侧"进攻→占格/两栖登岛"执行。先修计数再修行为：早期夺格探针只扫 `role==="Allies"` 的 action 日志增量，而引擎常在**对方方**的 `done`/`next` 边界结算夺控（`capture_hex` 对占领方记 `AP/JP captured`），且会战窗内 `log()` 给行加 `&A`/`&J` 前缀（framework.js），故把 ~8 成 AP 夺格事件漏掉——曾误报"基线 0 夺岛"。
- 用全量逐格夺控行 `/^(?:&A)?AP captured H(\d+)/`（不限 role、同 action 同格去重）复测，zh.7 提交的基线引擎已能浅层触岛（见下 A/B 表基线列），此前 zh.7"Iwo/Saipan 等 0 次"应属该计数低估；终局在握口径仍为 0（两口径不矛盾：前者计夺控翻转事件、后者计终局控制）。
- 真根因三处（与早期定性一致）：(1) **攻势总挑离焦点最近的单位**——多为纯空/海军航母，只对敌岛做远距空袭，空袭不夺控、凑不出登陆兵力；(2) **两栖编成不渡空海**——headless 推进只在"本激活可达范围内有敌控格"时才动，海军陆战队距焦点岛超过一程就永远停在原地，跨洋远征拉不近；(3) 即使激活了两栖地面，后续目标/单位仍按最近空/海军打分。

### 修复（两个执行器改动，默认开，环境开关保 A/B 可复现）

- `js/server/erasmus_ops.js` `eop_pick_unit`（B_BIAS 门，默认开）：焦点是敌占（需夺占而非纯消耗）且候选里有距焦点不劣于最近单位太多（`≤max(8, 最近距+10)`）的两栖地面（`p.asp`/`p.strat_move`）时，优先激活海军陆战队成登陆力量，不再总挑最近航母。
- `js/server/offensive.js` headless 推进（B_CRUISE 门，默认开）：攻击阶段含地面+两栖移动能力、且本激活无任何可达敌控格（`best===null`，原逻辑直接放弃该组）时，改为朝 eop 焦点**最近的合法落点**巡航一格——逐激活/逐回合把远征军拉近待夺岛，闭合登岛链条。
- 只改这两处执行；py 决策树/回合级钉选（A/C 部分）不动。

### 验证（同种子 40 局 A/B，seeds 20260903–20260942，headless 1942-1945）

- 两臂均 40/40 正常终局、0 error / 0 action-limit。逐格夺控事件口径：基线 AP 193 次（4.8/局）→ 修复 497 次（12.4/局）；触岛种子 26/40 → 39/40；岛屿夺控事件 70 → 290。
- 纵深（每 40 局达某关键岛）基线 → 修复：恩尼威托克 5→33、硫磺岛 8→32、关岛 8→20、塞班 5→15、乌利西 1→17、帕劳 1→11——两栖登岛从"偶尔浅触"变成"高概率打到中太平洋纵深"。日志确认为真实夺控：`%ABattle hex` + `&A+3 Amphibious assault` + `&AAP captured`（有 ASP/会战的强攻登岛，非空地翻转）。
- 边界（如实记录）：马尼拉/冲绳/日本本土**终局控制 0/40**（两臂皆然）——剧本在 ~t8–12 由日本 PW 条约先胜终止，引擎两栖力量已达硫磺岛(距冲绳两格)/马尔库斯岛，但冲绳/本土不在剧本时间窗内；逐回合 PoW 夺格节奏与盟军终胜属后续迭代（非 B 修复对象）。
- 回归全绿：`tests/erasmus.test.js`（gate-off）、goal-fidelity 39/39、state-fidelity 59/59、event-strategy 8/8；rules.js 经 `tools/inline.js` 重建后复跑通过。已 grep 确认无提交金标重放本 headless-1942 路径（改动只影响 headless 进攻推进与聚焦激活）。
- 产物：`js/server/erasmus_ops.js`（eop_pick_unit 两栖偏置）、`js/server/offensive.js`（两栖空海巡航）、`tests/results/b-amphibious-ab-40.json`（A/B 汇总）、`tests/_b_measure.js`（修正计数 runner，未跟踪）。

## zh.7 D1–D5 状态机驱动层补全 + 胜利线对账（盟军为何还输）

### 审计结论

继续用户“盟军 js 状态机漏了什么、为什么还是输”的追查：决策树/A（计划层）/C（事件战略）已与 py 参考引擎逐字忠实（goal-fidelity 39/39），漏的不是树本身，而是 **驱动层的真实反馈信号** 与 **引擎一条胜利线（战略轰炸投降）的规则层 bug**。逐项修复 D1–D5；D5 同时动了引擎结算（game.js/cycle.js），是"状态机补全"里唯一越出 `erasmus_state.js` 的改动，特此单列。

### D1 批内跨局串扰 / D2 同轴延续（erasmus_state.js）

- D1：批跑多局同一进程时 EOP_OVERRIDE 与模块缓存跨局残留。`esm_clear_cross_game` 在新局首钉前清空外部链覆盖。证据：种子 20260909 同种子批内第 2 局结果从 T12 漂到 T10，修后稳定。
- D2：原实现同一阶段每回合首卡都换 d10 重滚选轴，两个相邻轴（如中太平洋↔CBI）交替空转。改为"同阶段同轴延续"：同阶段命中目标时沿用上一轴，只有换阶段/目标达成才重新掷轴。seed20260909 此前中太平洋↔CBI 逐回合对翻、终局两线都无纵深，修后连续同轴 run。

### D3 真实 PoW 与反攻触发信号（al_M_B / al_M_D）

- `al_M_B`（"需满足战争进程"）此前近似为 `!!G.pow`——第 4 回合起恒真，导致中期盟军每回合都被导向"夺 PoW 格"却无"是否已达标"的反馈。改为引擎口径：**PoW 银行** = `G.capture` 中仍由 AP 控制的格数 `esm_pow_bank()`，谓词 = `bank < G.pow`。实测逐回合银行常在 2–3、`G.pow=4`，因此每回合政治阶段 `-1 PW`（见 D5 账本），谓词真实反映"这回合还要再夺够数"。
- `al_M_D`（反攻触发）此前为让反攻战略更早触发而放宽成前线扫描，反噬：触发但反攻清单（16 目标，py L422-434）逐格都在己方手里 → `eop_focus=null` → 整回合空转。回退为 py 字面谓词——对解析出的反攻战略链（与 eop 同源）任一 hex 仍被 JP 控制。回退后 seed20260924 T4 反攻真钉 南太平洋 891（Mariana 方向）、夺岛后 T5 末相位切 推进B29，执行比放宽版健康得多（此前反攻 T4-T8 连钉 5 回合焦点全空）。

### D4 ABSTRACT 操作化（erasmus_state.js）

- 推进B29 / 原子弹胜利 等 ABSTRACT 条目（py 中为纯文本行政指令、无 hex 链）此前钉住后无可执行子目标，bot 靠通用选牌散打。现在钉住期间把事件优先打出来：推进B29 优先 苏联入侵满洲(AP#79)/杜立特等可用事件，之后朝轰炸基地摆 B29（有基地格则作焦点）；原子弹胜利 期间只要苏联事件未打就优先打它。空链（无基地格/无可用事件）落 占领轰炸基地/重返菲律宾 可执行回退链，不再整回合空转。

### D5 胜利线对账（引擎修复 + 资源剥夺链 + 账本）

**引擎级修复 —— 战略轰炸标记语义（game.js + cycle.js，越出状态机的唯一引擎改动）**

- 根因：`STRAT_BOMBING_CAMPAIGN` 事件标记由 `check_event`（game.js bombing() 成功路径）存成 **G.turn**（成功当回合号）。1942-45 剧本 B29 第 9 回合才增援（`L.allowed_units` 空到 T9）、最早第 10 回合才能首次成功轰炸 → 标记**恒 ≥ 10**。而 `victory_1945`（scenario.js L489-508）要求 `is_event_active(campaign)` 落在 **1..9** 且 `get_jp_resources() ≤ 1` 且 B29 在距东京 6 内/中国 → "日本因战略轰炸投降"在规则层面**永不可达**。实测多种子 `mk=10`、资源已降到 3 也永不触发。
- 修复：game.js bombing() 不再对该事件 `check_event`；cycle.js `strategic_bombing.roll()` 改为**连续成功的战役段计数**——当回合任一 B29 轰炸成功则 `marker = min(marker+1, 9)`，全部失败则归 0（一次成功只 +1，不再等于回合号）。语义 = "已连续成功轰炸的段数 1..9 封顶"，正好落在 `victory_1945` 判胜窗。此改动只影响该事件标记的**数值来源**；`STRAT_BOMBING`（id5，pw+1）等其它事件不受影响。
- 配套账本：`ctx._diag` 每回合在 decision trace 输出 `{pow, bank, jpRes, marker, resHexes}`，探针 `tests/_dbg_d5.js` 逐回合打印 JP/AL 钉选 + 账本 + 政治结算，使"离胜利线多远"可量化审计。

**资源剥夺链（erasmus_state.js `esm_jp_resource_hexes`）**

- 新增 `esm_jp_resource_hexes()`：按 `get_jp_resources()` 同口径（RESOURCE_HEX 表过滤 JP 仍控）取当前 JP 资源格名单。终局冲刺轴（仅 `登陆日本`/`原子弹胜利`，**窄门**）钉住时把这些仍 JP 控的资源格按"距链首最近优先"前置进目标链——此前尝试放宽到 `al_L_F`（控东京 8 内格）等会在 T5 一夺塞班就把中期夺岛节奏拐去抢远方资源，反而更早条约败（seed20260924 T8）；窄门后只在中枢推进到登陆前才触发。**注**：`victory_1945` 的资源判据只统计 RESOURCE_HEX（不含日本本土的东京/大阪），故韩国(Seoul 672)/满洲(Harbin 669, Mukden 670)/马来-苏门答腊-婆罗洲(南方)等格直到最后一回合都必须剥夺，才是 res≤1 的正路。

### 验证与剩余边界（如实记录）

- 回归全绿：state-fidelity 59/59、goal-fidelity 39/39、event-strategy 8/8、erasmus.test.js（gate-off）——状态机/保真/事件自测不受引擎标记改动影响。
- headless 1942 完整剧本 10 种子分类（seeds 20260903–20260912，`tests/_dbg_d5.js` 账本口径）结局分布：**5 treaty / 5 撑到 T12 “Japan did not surrender”**（引擎判负、非盟军条约），0 盟军胜。treaty 侧多数因 PoW 银行 < G.pow 的逐回合 -1 PW 于 T10-11 归零。
- 剩余缺口（诚实边界）：(1) `jpRes` 全程卡 **3–5**，组合为 东京圈(朝鲜/满洲 = Seoul+Harbin+Mukden) 或 韩国+南方两格(Miri+Balikpapan) 等——盟军从未把资源线压到 `≤1`；(2) 部分种子在 占领轰炸基地 阶段钉到 T12 终局也没进入 登陆日本/原子弹胜利 → 窄门的资源剥夺救不到它们（门在"已进登陆轴"才开）；(3) 进 登陆日本/原子弹胜利 的种子太晚、此时 res 仍高。即：**盟军胜利需 ~T10 前把轰炸基地+B29 成型、并打进资源线归零——落在剧本时间窗与执行强度边界**。倾向的下一迭代方向（待用户确认）：把资源剥夺/登陆推进并入 占领轰炸基地 阶段（当 res 已 ≤ 阈值且轰炸从中国盒可行时不等晚期轴）；或给 AP 更多夺资源格的早期路径（南洋/南方资源区反攻）。

### 产物

- `js/server/erasmus_state.js`（D1 跨局清理、D2 同轴延续、D3 al_M_B/D 信号、D4 ABSTRACT 回退链、D5 资源剥夺链 + ctx._diag 账本）、`js/server/game.js` + `js/server/cycle.js`（D5 战略轰炸段计数，引擎胜利线修复）、根 `rules.js`（inline 重建）；探针 `tests/_dbg_d5.js`（账本 runner，未跟踪）。

## 2026-09-04

### zh.9：12 页实际图表、异常修复与 20 局验收

- 将 12 页图表从自动线性占位结构重建为稳定节点图；战略轴、卡牌选择、任务部队、反应与 PBM 都有独立路径，所有 D10 为 0–9，盟军反应兵力表为 0–4/5–9。
- 六张战略轴输出真实 `JP01-*` / `AP07-*` 等节点路径、条件证据和骰点；每张牌重新评估战略，删除旧“两回合延续”和资源格动态前插。
- 新增己方卡牌分类、公开单位投影、目标可行性/最低兵力估算、反应和 PBM 选择接口；完整战役恢复航空兵激活。
- 修复四种异常终止/死循环：反应单位无可达战斗格、申报候选失去目标、HQ 加成变化导致超限往返、不可放置增援反复换单位。
- 自动测试：12 页图结构与 PDF 哈希、六轴 54 条黄金路径、原子弹 3 条边界、39 策略目标链、事件绑定、South Pacific 回归、250 步保存/恢复动作重放及汉化覆盖全部通过。
- 正式 20 局（20260903–20260922）：20/20 完赛，0 error、0 action-limit、0 fallback、0 未解释空攻势、0 缺失轨迹节点；日本 19、盟军 1，盟军胜局为 T12 原子弹战略投降。报告见 `research/erasmus-zh9-20game-report.md`。
- 如实保留边界：历史辅助层仍存在直接读取服务器状态的代码；新 `view.ai` 已不暴露对手手牌，但纯 view 安全重构尚未全部完成。

### 无头自对弈稳定性修复（两栖护航 + 反应分配可达性 + Bad move path）

- 目标：消除 escort 改动引入的 4 个 audit 报错（3× `ERASMUS has no legal action` 反应分配卡死 + 1× `Bad move path`），使 1942 完整剧本 headless 50 局 0 error 跑通。
- **两栖登陆护航**（`erasmus_ops.js` + `erasmus.js`）：`eop_pick_unit` 在登陆窗先补"与地面候选同格"的海军护航；`eop_landing_no_escort` 在无可用同格海陆编成时提前收尾，避免 `broken_aa` 的 "Amphibious Assault failed due to lack of naval escort" 吃损失。仅完整全图剧本（gate on）启用。
- **反应分配可达性**（`offensive.js headless_target_score` reaction 分支）：反应落点必须能被后续 `choose_attack_hex` 真正分配，否则反应阶段不自动收尾、分配窗仅剩 undo 卡死。两个口径修复：
  1. **航母编成**：可达性判据从 `get_distance`（理想六角距离）改为 `in_range_on_map`（西南象限 sw 格走 `slow_in_range` 真实地图邻接 BFS）。根因：seed20260916 航母(unit87, br=2)移到 hex63，`get_distance(63,122)=2` 判"可达"，但 63/122 同处 sw 象限、真实邻接 BFS 不连通 → `compute_air_commit_hexes` 收尾 `in_range_on_map` 返回空 → 卡死。
  2. **纯护航编成**（无航母海军）：只能进会战格自动投入（escort 窗靠"同格已投入航母"才给格），否则返回空卡死。seed20260921 护航 unit18(br=null) 被就近打分引导到非会战空格 → 卡死。
  - 地面反应维持原"就近"推进（`mark_ground_reaction_hexes` 本就非会战格），不受影响。
- **Bad move path 兜底**（`offensive.js headless_advance_one`）：`compute_ground_naval_move_hexes` 为算海运路径临时移除地面单位重算供应，使陆路路径在"单位不在场"时按畅通道路算出更短距离，`move_units` 用单位在场供应校验距离超限抛 "Bad move path"；try/catch 捕获后 `pop_undo` 还原半程 paths 并 decline 该组，不再整局崩溃。seed20260920 因此从 turn12 崩溃改为正常完赛。
- 验证：1942 完整剧本 headless audit 50 局（seeds 20260903–20260952）**0 error / 0 action-limit / 0 setup-error**，50 局全部 `complete`；4 个曾报错种子（20260916/20260918/20260920/20260921）逐一复跑均 `complete`。胜负仍日本 50 / 盟军 0 —— 盟军胜利仍属上一节 D1-D5 的"资源线归零 + 轰炸基地成型"执行强度边界，非本批稳定性修复目标。
- 产物：`js/server/erasmus_ops.js`、`js/server/bots/erasmus.js`、`js/server/offensive.js`、`js/client/update.js`（`G.active` 角色名/阵营号修正）、根 `rules.js` + `play.js`（inline 重建）。单主题提交 `edd5296`。

### zh.8 原子弹战略标准 + RTT 战略日志 + 50 局复测

- 按用户最新裁定，把图表 09 三项标准实现为引擎/状态机共用的 `atomic_bomb_strategy_status()`：T9 起每回合至少一次成功战略轰炸；苏联入侵满洲已发生或盟军持有且可作为事件打出；日本资源 ≤3（未发生但可打时 ≤5）。`victory_1945` 改按该谓词触发 `Japan surrenders by atomic bomb strategy`。此为用户裁定，明确区别于规则 16.2 原文的资源 ≤1 口径。
- 修复四个导致状态机无法真实走到原子弹轴的映射错误：(1) `can_play()` 返回事件回合号，旧 `=== true` 令“苏联牌可打”恒假；(2) 战略轰炸基地误限“港口机场”，现为东京 8 格内任何盟军机场；(3) “地图上所有 B29”误把尚未增援的第二架也计入；(4) F 条件误限港口，现为东京 8 格内任何盟军控制格。
- `data/erasmus/pages/page-09.json` 的 G 节点已结构化三项合取条件并修正为 true→`AP_ATOMIC_VICTORY`、false→`AP_INVade_JAPAN`；同步修复生成器，重建 `data/erasmus/charts.json`、`js/server/erasmus_data.js`、`rules.js`/`play.js`。
- AI trace 新增前 12 个有序战略目标（优先级、hex、名称、控制方、距东京、完成状态）、最近盟军单位/控制格/B29 距东京和完整原子弹条件；公开 trace 去除未发生前的苏联手牌可打细节，私有 trace 保留。RTT `server.js` 新增 `AI STRATEGY` 单行 JSON 日志，每回合钉选时打印阶段/战略/动作/焦点/前五未完成目标/推进距离/原子弹账本。
- 同种子 50 局（20260903–20260952，完整缩短剧本，headless）结果：50 complete，0 error/setup-error/action-limit；日本 48、盟军 2（4%），两胜均为原子弹战略投降（seed 20260908 T9、20260946 T11 状态）。旧基线为日本 50、盟军 0。
- 推进指标：最近盟军单位到东京最小 3、平均最小 7.04 格；最近盟军控制格最小 3、平均 6.92；在图 B29 最小 3、平均 7.78。日本胜局的首个未满足条件：苏联条件 39、轰炸连续性 6、资源 3；22 局仍提前条约败。
- 验证：原子弹标准 3 个边界用例、state-fidelity 59/59、goal-fidelity 39/39、event-strategy 8/8、图表/确定性测试通过；最终数据 `tests/results/audit50-1942-1945-The-Shortened-Campaign-50-20260903-headless-atomic-zh8-final.json`，报告 `research/erasmus-atomic-zh8-50game-report.md`。
- 版本记录：游戏引擎/状态机/审计提交 `555a2f0`；RTT 战略日志提交 `9a2d311`。

### zh.10 卡牌选择与两栖编队热修

- game 16 根因：完整战役的选牌窗以战略 `kind` 直接调用通用 OC 排序，绕过第4页 E“可执行无限制军事事件”节点，因此把 Operation Sho-Go（反应牌）作为 OC，同时保留 VADM Kondo / Central Force 等可执行军事事件。
- 修复日本第4页 E 出口：手牌多于2张时优先最高后勤值的可执行无限制军事事件，并把 `event` 意图传到下一动作窗；轨迹显示 `ERASMUS-JP-04/JP04-S-UNRESTRICTED-EC`。
- 修复第5/11页编队过早完成：所有目标携带压制/夺占元数据；精确使用 `rcf`；压制战力加入战斗航程内最强潜在反应单位；夺占必须有地面单位，敌控港口/岛屿必须同时有海军护航。
- 新增 `tests/erasmus-card-force-hotfix.test.js`，覆盖反应牌不再抢占 EC、EC 意图传递、潜在反应兵力、一架飞机不提前结束、海军护航后补地面单位及完整两栖编队。

### zh.11 多目标任务部队与剩余激活量

- 按第5页注释修正“最少但足够”的作用域：它只表示当前目标任务部队达标，不再立即结束整张 EC/OC；尚有合法激活量时继续组织后续目标兵力或把后方单位向下一优先目标前推。
- 压制目标以敌方 AZOI 是否仍覆盖作为完成条件。Jolo 在图表中是“压制东印度”首位，但不要求日本占领；覆盖消失后自动顺延 Makassar。
- 任务部队页的 `IS_AIR_STRIKE` 改由当前 `SUPPRESS/SUPPRESS_HQ` 目标语义驱动，不再错误依赖已经进入会战申报窗口。
- 轨迹新增激活使用率和编队计算；新增 game 17 固定复现测试，要求近藤信竹 EC 激活多于一个单位并进入“后续目标/前线调动”模式。

### zh.12 双方 12 页状态机闭环与 PBM 完整接入

- 重建六张决策轴的显式拓扑，处理框不再伪装为引擎动作；所有 12 页 JSON 均通过节点唯一、无悬空边、终点可达、0–9 骰表边界和 PDF 哈希校验，`inferred_nodes=[]`、`visual_review_required=false`。
- 第 4/10 页选牌树现在每次出牌都执行；第 5/11 页任务部队树按当前引擎窗口恢复到实际 A–M/移动节点，并持续利用剩余激活量组织后续目标或前推部队。
- 第 6/12 页反应链增加情报/天气/特殊反应、潜艇掷骰与损失分配、撤退、反应兵力和战斗格优先级。潜艇目标按 CV→BB→CA→DD、同类最高防御处理。
- 完成双方 PBM：航空兵按“无敌方 ZOI 的非本土 HQ→敌 HQ→受敌 AZOI 的己方港口→受敌 AZOI 的己方机场→受敌 AZOI 的己方地面单位→最近资源格”排序，并执行一机场一空军、最强空军优先；海军按 HQ 港口→仅地面单位港口→最近港口；失败两栖单位优先有己方海军的港口。
- 修复激活上限的可变 HQ 奖励循环：上限从稳定的基础值派生，避免 `2/3→3/2→undo` 反复；修复 PBM 误用全图单位、潜艇掷骰落入 fallback、行政窗口误记 fallback 等问题。
- 回归：全部 `tests/erasmus*.test.js` 通过，包括 12 页图结构、54 条轴黄金路径、39 条目标链、卡牌/编队、250 步保存恢复和确定性测试。
- 20 局固定种子（20260903–20260922，1942–1945 缩短战役，60,000 动作上限）：20/20 正常终局，50,902 个动作，0 error、0 setup-error、0 action-limit、0 fallback、0 未解释空攻势、0 缺失轨迹节点。PBM 实际覆盖：AP 航空 2289、海军 228、失败两栖 37；JP 航空 1583、海军 187、失败两栖 22。
- 双方四类图表均实际运行：日本 axis/card/taskforce/reaction = 2990/1876/10955/6402；盟军 = 2420/2719/14317/9223。发生地面移动 347、盟军夺控 82、日本夺控 60。
- 结果如实记录：日本 20 胜、盟军 0 胜；终局原因只有“日本未投降”和“条约谈判日本胜利”，原子弹胜利 0。该结果不影响状态机合法性验收，但显示盟军策略执行强度/胜利路径仍不平衡，不能解释为双方 AI 强度合格。
- 详细报告：`research/erasmus-zh12-20game-report.md`。仍未完成的独立安全里程碑是把历史规则模块内对 `G` 的派生读取全部收敛为不可变 `view.ai` 快照；本轮没有把这一项伪装成完成。

### zh.13 CDSS 提示板第一批脚注执行化

- 以两份 DOCX 的 `word/document.xml` 为输入，全量提取日军 259 段、盟军 424 段；数据写入 `data/erasmus/cdss_sources.json`，保留源文件 SHA-256、原段落号及 page-01 至 page-12 归属。
- 生成 `docs/rules/normalized/erasmus-v2-zh-charts/node-regions.csv`，含 258 个节点的页码、图表 ID、节点 ID、类型与中文标签；`x/y/width/height` 留空供人工按 page_fraction 回填。
- 修复真实条件错误：日本中期 JP02-E 现在读取 `G.political_will < 4`，不再错误读取 `G.wie`。
- 事件战略补上此前代码明确跳过的分支：欧战正数作事件/否则 FOQ、无需结束 ISR 时转 FOQ、天气牌转 FOQ、东条按 1OC、其他无效事件转 FOQ。
- 卡牌战略增加 Operation MI 适用门、LV 后的奖励优先级，以及盟军“占领战略轰炸基地使用最大有效攻势卡”。
- 编队脚注增加全部潜在反应海空军战力求和，并在非日本/非印度 HQ 格保留至少一个未激活地面单位。
- 回归：全部 Erasmus 单元/黄金/保存恢复测试通过；固定种子 20 局 20/20 完赛，53,908 动作，0 fallback、0 缺失轨迹节点，双方六条 PBM 路径均有覆盖。
- 未冒充完成：最终防御、一亿玉碎、精确 2x 生存判定、伏击 DRM 和反应 D10 对地面投入的差异仍需下一批逐条实现。

### 节点实现索引、自然语言编译规范与启动指南

- 新增自动生成器 `tools/rules/build_erasmus_implementation_map.js`，将 12 张图表的 258 个节点映射到战略轴、选牌、编队、反应/PBM、通用图遍历和确定性骰表入口。
- 生成机器可读 `data/erasmus/node-implementation-map.json` 与人工审计版 `docs/architecture/erasmus-node-implementation-map.md`；明确“调用路径存在”不等于“纸面语义已证明正确”。
- 新增映射一致性测试，校验策略版本、节点一一对应、无重复且每个节点都有实现入口。
- 新增 `docs/architecture/erasmus-natural-language-to-code.md`，固定来源原文→节点/谓词→阵营视图→策略规划→合法动作→回放轨迹的落地流程。
- 新增 `docs/setup/rtt-startup-guide.md`，记录 Windows 下构建、8080 启停、健康检查、日志与常见故障处理。
- 新增 `tools/start-rtt.ps1` 一键脚本，提供启动、停止、重启、状态检查和重建选项；启动前校验 Junction，停止前核对监听进程命令行。

### zh.14：最终国防圈与本州最终防御修复

- 复盘 game 18 确认两个根因：第3页 BC 把敌控港口/机场也要求驻军，令最终国防圈无法完成；显式防御战略的空目标链又被 `eop_axis` 替换成旧南方资源轴，致使东京航母远征美里等资源格。
- 按第3页脚注[2]把驻军量词限定为日本当前控制的格；敌控冲绳、大阪等地点不再成为“待驻军目标”。己控港口要求地面驻军，己控机场要求空军驻军。
- 最终防御目标改为日本区域内实际存在的盟军地面部队所在格；激活优先本土地面部队，再为空中/海军支援，目标移动评分拒绝日本区域外的通用资源攻击。
- 空链战略现在仍是权威覆盖：EVENT、GARRISON、DEFEND 没有可执行地点时不会静默回退 JP_RESOURCE。防御卡牌树未明确选事件时改走 OC，以便真正执行集结与会战。
- 新增 `tests/erasmus-final-defense.test.js`，覆盖敌控地点过滤、己控驻军兵种、显式空链阻断、本州敌军目标过滤和防御 OC 路由。
- 重建 12 页数据、节点实现映射及 `rules.js`/`play.js`；全部 Erasmus 测试通过。完整战役 headless 冒烟 seed 20260903 正常在第9回合结束，2213 动作、0 error、0 fallback、0 未解释空攻势、0 缺失轨迹节点。
- RTT 已从 PID 6372 安全热重启为 PID 34988，`http://localhost:8080/` 健康检查 HTTP 200；现有数据库与 game 18 未删除。

### zh.15：胜利条件核查、盟军生存前视与 AI vs AI 复盘模式

- game 18 终局已从数据库逐行核验：第8回合政治阶段 `current progress of war 3 < 4`，政治意志由1降至0，`victory_check()` 随即执行“Japanese Victory by Treaty Negotiations”。该局盟军是人类席位，C49 的弃牌不能归咎于机器人。
- 明确缩短战役盟军胜利线：任何回合政治意志不得归零；即时胜包括控制日本本土或让日本本土连续3回合无法连接资源格；否则第12回合必须满足当前项目裁定的原子弹三项标准，日本才投降。
- 盟军新增窄范围 PoW 前视：仅在政治意志≤1且 `capture` 银行小于 `G.pow` 时，阻止最后可用牌进入 FO/弃牌，选择最大合法 EC/OC 执行当前图表目标；轨迹记录 `powEmergency`。
- 已在东京8格内盟军机场就位且无日军同格的 B29 不再被普通攻势重复激活，确保其留在棋盘参加下一次战略轰炸。
- 平台新增 `mode=aivai, ai_step=true`：自动建立日本/盟军两个机器人席位并以 Observer 打开；只有创建者可点击“AI 下一阶段”，服务器会让两方完成当前阶段内的反应、会战和 PBM，再在下一阶段标题暂停。
- 固定20局（20260903–20260922）结果：20/20 正常终局，0 error/setup-error/action-limit/fallback/未解释空攻势/缺失轨迹节点；日本20、盟军0，12局撑到第12回合。该结果表明当前修复没有制造非法优势，但仅靠最后关头多打一张牌仍不足以把战略轰炸和资源剥夺转成胜利。

### zh.16：明确目标硬优先与菲律宾空攻势修复

- game 19 轨迹证明图表焦点是 Manila，但旧激活器先按“最近任意敌军”、移动器先按“最弱守军”排序，图表目标只作为末位平分键；这正是日军反复打牌却把兵力送去婆罗洲、迟迟不夺菲律宾的根因。
- 有明确图表目标时，激活、任务部队和无头移动现均先服从目标；占领类焦点必须包含地面单位，目标不可达后才允许转向下一合法敌格。
- 新增针对马尼拉的单位选择回归用例，防止近弱敌再次覆盖决策轴目标。
- `advance` 现在把焦点及占领语义写进回放参数，修复目标硬优先导致的保存/恢复复算分歧；250 动作保存回放测试重新通过。
- 明确目标下纯地面部队也沿该目标前推；参战航空/海军的 PBM 在图表同级候选中靠近下一目标。未给 PBM 权限的后方单位仍不会被非法搬运。
- 盟军在政治意志≤2且 PoW 亏空时提前进入合法最大攻势前视，避免等到政治意志1才处理。
- 最终固定 20 局（20260903–20260922，单局上限 60,000）全部正常终局：0 error、0 setup-error、0 action-limit、0 fallback、0 未解释空攻势、0 缺失轨迹节点；10 局运行至第12回合。
- 行动统计为 232 次地面推进、82 次盟军夺格、48 次日军夺格；双方任务部队、反应和 PBM 图表均有实际轨迹。胜负仍为日本20、盟军0，说明“合法且按目标行动”已验证，但盟军把登陆、战略轰炸和资源封锁转化为胜利的强度仍未达标。
- 验收产物：`tests/results/audit50-1942-1945-The-Shortened-Campaign-20-20260903-headless-zh16-target-pbm-final2.json`。

### zh.18：日本第2回合占领编队与格外航空/航母参战

- 核查确认基础规则已有 `get_air_attack_hex()` / `compute_air_commit_hexes()`：航空兵和有战斗航程的航母可留在战斗格外投入会战。
- 带 `card.hq` 的军事事件现归为受限事件；选牌前按真实启动区、HQ 补给、OOS 和事件兵种过滤预检兵力。
- 第2回合夺占目标拒绝不具备地面占领与海军护航组合的 EC；HQ 选择通过真实事件过滤复算可启动单位。
- 占领编队加入格外远程支援完成条件；首要目标已宣战后，后续移动组可沿图表目标链寻找下一目标。
- 新增 `tests/erasmus-opening-turn-audit.js`。固定种子 20260903–20260922：马尼拉 19/20、至少夺取一个东印度目标 7/20、格外航母投入 10 次；日本空启动 8 次、无护航失败 2 次，后两项仍登记为缺陷。
- 审计产物：`tests/results/opening-turn-zh18-final.json`；策略版本 `erasmus-v2.0-zh.18`。

### zh.20：历史败因、图表目标恢复与后方机动

- 审计历史对局 18–23，确认盟军主要败于 PoW/政治意志、苏联条件、资源压制与本土登陆均未形成闭环，不是单一终局判定错误。
- 撤销测试期“菲律宾+东印度全部投降”硬覆盖；日本恢复按第1页实际选定战略执行，投降状态只进入诊断日志。
- 修复完整战役空军激活后错误 `turn_box`：射程内单位留在基地并格外参战；远方航空/舰队通过引擎合法扩展航程或战略移动前推。
- 盟军 PoW 补充目标优先当前图表链，任务部队以四单位最小组组织，高激活 EC 的余量才进入下一目标。
- 固定种子 20 局及完整分析见 `research/erasmus-zh20-history-and-ai-audit.md`；胜负分布如实记录，不用图表外加成追求 50/50。

### zh.21：盟军终局决策轴、B29/原子弹与资源封锁前视

- 逐像素对照用户提供的第9页终局图，确认并修复 B“是否第12回合”YES 应直达 F；旧实现错误地继续经过 C/D/E。
- 最近 zh.20 的20局中“原子弹胜利”实际触发0次；占领轰炸基地173次、推进B29 30次，仍没有形成资源条件闭环。
- 原子弹执行框不再回退为重返菲律宾：可用时优先打出苏联入侵满洲，否则以确定性距离排序选两个仍由日本控制的资源格。
- 中期第6回合起把图表已有轰炸基地链作为显式 `B29_BASE_APPROACH` 胜利前视；PoW 紧急层先筛本牌可达目标，避免远方塞班吞掉政治意志救火行动。
- G=NO 后保留“登陆日本”图表节点，同时显式挂接 `JAPAN_RESOURCE_BLOCKADE` 规则层：夺取上海、青岛、旅顺和南方岛链机场，随后以航空驻军建立 AZOI；断线状态及三回合计时写入轨迹。
- 进攻激活候选排除 HQ；20局中日本/盟军 HQ 空激活均为0。
- 20局结果：B29前置344次、资源封锁准备113次；20/20结束且0异常、fallback、未解释空攻势、缺失节点，但仍为日本20胜。盟军最终政治意志平均0.65、PoW银行1.2、日本资源6.95，证明下一瓶颈是中期夺格/守岛执行而非终局树未触发。
- 验收文件：`tests/results/audit50-1942-1945-The-Shortened-Campaign-20-20260903-headless-zh21-victory-final.json`。

### zh.22：game 27 实盘缺陷与东印度投降表精确化

- 固化 game 27 修复前公开回放/轨迹：2715 步、2714 条 AI 轨迹；摘要记录盟军单位最近距东京11格、控制格9格、日本剩5个资源格，并保留哈尔滨/奉天被错误插入 PoW 目标的证据。
- 美国海军补员不再由全图“最近敌军”评分吸入仰光；当前战略不在 CBI 时，优先当前太平洋焦点附近的合法港口。
- 修复 HQ 选择器只识别英文战略名的问题；重返菲律宾/DEI、南太平洋、中太平洋/跳岛、CBI 现在分别匹配正确 HQ 家族。
- 远后方 HQ 航空兵若一次前推后仍无法进入目标战斗航程，不再为凑激活上限出动；保留目标进入两倍扩展航程后的正常参战资格。
- 盟军只有在当前图表焦点位于日本区域时才能攻击日本本土，堵住无焦点早期战略退化为“最近敌军”后的自杀式远征。
- PoW 前视只重排当前图表链，移除跨战区全图扫描，防止哈尔滨、奉天及无关大陆目标拆散夺岛兵力。
- 第1页“东印度投降”已按四级结构写入权威 JSON、Markdown 和运行时目标元数据：Balikpapan/Tarakan；条件 Batavia；Tjilatjap/Soerabaja；Bangka/Palembang/Medan。Jolo 等只属于空优“压制东印度”，不会混入投降表。
- 全部 Erasmus 自动测试通过。50局固定种子技术跑批为50/50正常终局、0异常、0 fallback、0缺失节点，但盟军仍0胜；该负面结果保留，后续继续检查苏联入侵牌的保留/重洗和原子弹路线。

### zh.24：科研评估基建 + 期望战斗数学优化层（opt-v1）

- 新增 `tests/match-run.js` 增强对局运行器：双方可配不同 bot、确定性 seed、控制位差分(夺格)/单位集合差分(歼灭/减编)/会战标记解析(成功作战)三路指标；seed 20260903 单局动作数与 `erasmus-campaign-audit.js` 完全一致(1566/11回合)。
- `js/server/framework.js` 增加只读 `exports.pieces`（无语义改动）；`rules.js`/`play.js` 重编译。
- 新增参数注册中心 `js/server/bots/erasmus_config.js`（6 开关+7 数值参数，默认全关=基线逐位一致）与期望战斗数学模块 `js/server/bots/erasmus_math.js`（与引擎表值对齐：ground_battle_table/naval_battle_table、受损单位数判胜、两栖守方+3、broken_aa 护航链）；注册 `erasmus-v2-opt` bot（`EOTS_OPT_PROFILE` 注入 profile，decide 后 finally 重置防串染）。
- 基线逐位一致性验证：同 seed 4 局 perGame 各字段与修改前完全一致（IDENTICAL: true）；`node tests/erasmus.test.js` 通过。
- 基线统计（32 seed/剧本）：1942 日本 32/32 全胜（条约 11），盟军 0 胜，盟军整局 0 地面激活、0 地面战胜利、夺格 3；1943 日本 31/31 全胜（条约 25），盟军地面胜 9/300。
- opt-v1 探针（日本 opt 8 局）：日本夺格 4.4→5.0/局、地面胜 1.8→2.0/局；盟军 opt 尚无效（0 地面激活根因未除，已定位 choose-hq 与激活路径，修复进行中）。
- 新增 `tests/analyze-matches.js`（bootstrap 95% CI + Mann-Whitney U + Cliff's delta）与 `tests/complexity-profile.js`（计划文件 E1 有效复杂度画像）。
- 论文骨架 `research/paper/paper-draft.md`；进度锚点 `work/goal-progress.md`。

### zh.25：两个胜利条件、ZOI 中和机制与封锁战略（测试版2.0）

- 机制核实并落地（用户指正）：两栖目标格被敌非中立 ZOI 覆盖时，br∈[1,5] 舰载/航母在半径 2 内经 set_zoi 设置 JP_ZOI_NTRL 中和敌 ZOI；编队层已实现中和舰优先挑选（taskforce_math 门控）。配对实验（32 局同 seed）证明"无中和舰即取消攻势"的硬闸有害（盟军夺格 -1.9/局 p=0.06），已改为仅偏好不中止。
- 盟军封锁战略（allies_blockade）：复刻 trace 判定的诊断函数 + 最小切割集目标链（Pusan/Seoul 桥头堡断九州→朝鲜陆桥 + 北方口岸/岛链 AZOI 环 + 前沿距离排序），T7 起原子弹不可达时前插第三轴。当前实现会分散兵力（盟军夺格 -1.1/局）且 32 局 0 封锁达成，默认关闭，留作调参项（提高 emBlockadeTurnMin / 与主轴并行而非前插）。
- capture_rate 开关：PBM 地面落点优先"空虚敌控格"（move.js:881 移入即夺）。配对实验为中性（日本地面胜 -1.1 p=0.08，资源 -1.0 p=0.05），不进推荐 profile。
- match-run 新指标：capRate（每回合夺格均值/峰值/有夺格回合数）、blockade（trace 断链起始与进度）、blockadeWins/homelandWins 胜局分类。实测夺格速率日本 0.82/回合（峰值 7）、盟军 0.47/回合——距人类 10+/回合仍远，主要杠杆（多战斗格攻势、深度路径夺格）留待下轮。
- 推荐配置（测试版2.0）：taskforce_math + allies_cv_preserve + allies_pow_quota + allies_resource_raid + japan_resource_defense；32 局基线逐位一致验证保持（base-verify-v3 IDENTICAL）。

### zh.26：W1 岛群扫荡（island_sweep 实验开关）+ 封锁图模型（改进计划 v2 第一批）

- 新指标：activationRatio（激活完成率，基线仅 0.36——64% 激活预算被提前 done 浪费，夺格率低的首要原因）、battleHexesPerTurn、capRate（每回合夺格均值/峰值）、blockade（trace 断链起始/进度）、blockadeWins/homelandWins。
- island_sweep（实验开关，默认关）三段实现：①激活完成率（链上轮换+推进夺格兜底，actR 0.44→0.63）；②岛群簇展开+多路登陆编组（簇内第 k 支海陆对→第 k 个簇格，capture_landing_hexes 批量占领）；③申报窗多焦点（EC 牌焦点已宣战后自动申报簇内下一战斗格）。
- 32 局配对（vs exp-final-1942 同 seed）：日本夺格 271→383（+41%）、battleHexesPerTurn 6.71（多焦点攻势成立）、盟军 1 胜（原子弹，本代码库第二次）、合计 capRate 1.50→1.76/回合、歼灭 560/640→721/748。代价：两栖失败 124→222（诊断：12 海空战败 vs 3 无护航——W3.1 反应概率化是下一步主修）、PW 0.31→0.69。
- W2.1 封锁最小割分析（tools/blockade-cut.js，真实地图数据 vm 加载）：最小 ZOI 机场链 10 环（冲绳 51 边/肯达里 34/莱特 24/塔拉坎 18/米里 15/新加坡 12/金兰湾 13/帕劳/巴厘/萨隆）；对马海峡 3 条水边 ZOI 不可覆盖、朝鲜/满洲陆桥 16 条路边必须地面占领；杀伤前置量化（新加坡/金兰湾半径2内 5 敌机场）。
- W2.4 allies_blockade 兵力聚焦修复：整链前插改为前沿最近 ≤2 环/回合（原实现分散兵力：盟军夺格 -1.1/局且 0 封锁达成）。
- 基线逐位一致验证保持（basev-final-w1 IDENTICAL）；erasmus.test.js 通过。

### 2026-10-04 — AI-WIN-01 阶段记录（验收未完成）

- 快进同步 `fec3435d`，在 `feat/AI-WIN-01-allied-campaign` 保留 Erasmus/AI5，新增独立盟军战役机器人；适配项目规范和本地评测协议。
- 配置与策略缓存按阵营、对局保存；计划随兼容动作封装持久化，旧动作格式可继续执行。加入同进程多局隔离、跨进程 JSON 恢复和纯动作回放检查。
- 以真实激活、ISR、补给、ASP、路径查询贯通选牌、HQ、编队、移动、PBM和增援。登陆包含地面能力；分开记录运输、集结、夺占、守备任务及失效原因。避免完整舰队被重复搬到邻港又搬回。
- 已查明并针对性修正：纯地面移动完成窗缺少 `stop` 映射；城市内置驻军未被纳入占领估算；B29 地区名称筛选漏掉实际东京八格内机场；可合法部署中国盒时却放在不能轰炸的远方机场。
- 真实两栖路径与占领结果、地面胜负完整分母、政治阶段 PoW、终局有效性使用新统计。评测保存有效配置、种子、版本哈希、冻结对手与结束原因；错误/回退/未结束不计胜，不能从胜率分母剔除。
- 本阶段早期 `smoke-v5`：每剧本4个开发种子，增强版合计0/8胜，8/8自然结束且0 fallback；PoW达标分别7/31、4/20，尚不能证明整局实力提高。后续策略修改不得沿用这些结果作为新版验收。
- 本任务仍 `in_progress`。32个开发种子、两剧本合法可重放胜局、冻结后各32个独立种子的验收门尚未通过。运行时模型请求0次。

### ERRATUM — 旧胜率与胜利口径（2026-10-04）

- 本文件此前的“成功作战/两栖胜率”等统计缺少地面失败分母，且把普通陆战混入登陆成功；不能与 AI-WIN-01 的新指标直接横比。旧输出保留，不重写原结果。
- 旧原子弹胜利曾使用更早的结束回合和前置条件。第51、53、54、63、64、65局归入 `research/ai-win-01/historical-rule-audit.json` 的旧规则档，原始文件及哈希保留；它们不证明现行16.2规则下的 AI 胜利。包括旧条目中的“首次原子弹胜”“第二次”等表述，均限当时规则。
- 第78局的后勤连续性可用作行为参考，不代表所有旧引擎放行动作都符合现行规则。空的一格岛分支遗漏8.45D限制，已记录于 `docs/rules/qa/AI-WIN-01-engine-findings.md`；增强规划器不能利用该遗漏。

### 2026-10-04 — AI-WIN-01 开发评测版本准备

- 新增安全 EC 预览，将合法军事事件的后勤值和 HQ 激活预算用于同一任务选择；不执行事件钩子来试探。补齐合法无反应空岛登陆、两栖 LF 减半和地面满编/减编步数估算。
- 封锁路线复用实际资源追踪查询；旧计时遇到恢复通路时报告将重置，不把当前攻势中的国家状态检查提前计入。
- 最新单种子机制探测 `smoke-v6` 的两个剧本均到 T12，均完成 T9 起连续轰炸并将 B29 放入东京八格内，但资源条件未满足，仍为0/2胜。PoW分别5/9、6/8。该探测仅用于定位，不是正式32种子验收。
- 已修复同回合舰队返航靠更换后续目标绕过保护、长期无进展目标不更换，以及 T9 后可行原子弹路线缺少资源优先的问题。
- 版本准备检查：41项计划契约、实际封锁/配置/查询纯读通过；保存、战斗估算、指标、回放合计30项 node:test通过。既有规则及卡牌测试此前通过；5项无关旧测试失败已在 fec3435d 同样复现。UI仅语法检查，未做本次浏览器视觉验收。
- 接下来运行两个剧本各32对固定开发种子；任务仍未完成，只有胜局完整验证后才解锁独立留出评测。

### 2026-10-04 — AI-WIN-01 正式开发批次前复核

- `development-df18110` 因发现旧公开视图含完整撤销快照而中止，保留原文件及 `aborted.json`，不计正式验收。公开视图现移除两种内部rollback及临时抽牌ID；内部撤销未改变。
- AI动作封装校验本方合法动作和候选参数；执行异常原位恢复全部状态及AI缓存。实际非法HQ、错误角色、嵌套补给参数、处理器执行后抛错及兼容性回归通过。
- 修复本州最后的无名3606格被地图筛掉；两个剧本的真实局面都能计划、执行陆路占领并由原国家状态段判盟军胜，无名格不计PoW。这只是胜利环节回归，不是整局AI胜局。
- 登陆估算纳入已有守军舰队的海空胜率；陆路部队不会因海空战败被错误否决。最后一格本州优先于普通新夺格。
- 正式胜率仅计完整录像验证成功的自然合法胜局，逐胜局保存独立哈希证据；配置锁增加实际环境与执行上限。26项评测/回放测试通过。
- 运行时模型调用仍为0。单点1943选牌约2.8秒，主要成本来自真实移动和反应合法性查询；未为加速而削弱合法性检查。

### 2026-10-04 — AI-WIN-01 受限事件与开发批次中止复核

- `development-b38595f` 的1942全部32对完成：原AI5为0/32胜，增强版5/32胜（三局原子弹、两局封锁），五局均完整回放验证。PoW有效回合达标4/214→143/286，提前条约败22/32→0/32。该组是开发证据，不能当独立验收。
- 同批1943仅完成4局增强对局，另4局陷入 Sandcrab 取消重试循环，整批已中止并保留 `aborted.json`。尚未运行留出种子，任务仍未完成。
- 根因：安全预览不支持带事件钩子的EC，原图表接手选牌后增强层又以空任务接手激活；取消后 Sandcrab 的特殊返回绕过 `oc_denied`。现整段委托给原图表，跨HQ/激活/移动/确认/PBM保持；后续卡恢复增强层。取消后只保留原有弃牌出口，不授予额外牌用法。
- 真实seed10保存点验证激活4单位、推进、受限条件失败、取消、弃牌后继续；不再零激活重试。进展指纹排除AI缓存和撤销快照，保留真实RNG、战斗和路径。缺失图表或fallback不能被campaign附加轨迹掩盖。
- 新增终局风险取舍：仅T12、PW>2、连续轰炸及B29条件具备且日方剩2资源时，优先尝试有正占领概率的合法资源夺取。零概率、错误回合、未具备条件仍拒绝；规则不变。
- 修复后47项规划契约、7组引擎/查询契约、48项恢复/规则/战斗/指标/回放/汉化测试及既有Erasmus测试通过；两个实际剧本仍能夺第七本州格。运行时模型调用0次。UI面板以真实汉化脚本作浏览器布局抽检，完整RTT集成未在本Mac运行。

### 2026-10-04 — AI-WIN-01 `9bcbd82` 两剧本开发批次（胜利门未过）

- 1942与1943各32个固定种子、原AI5与增强版共128局，全部自然有效结束；没有fallback、未知图表节点或重复状态中止。原AI5在两剧本均0/32胜。
- 1942增强版8/32合法盟军胜局，全部以独立完整回放验证；Wilson 95%区间约13.3%–42.1%。原版22/32提前条约败，增强版0/32；PoW达标4/214→144/286有效回合。
- 1943增强版0/32胜，原版27/32提前条约败、增强版0/32；PoW达标1/148→221/256。30/32增强局完成连续轰炸与B29东京八格条件，资源余额仍为2–10格，故现阶段只证明生存改善，不能宣称两剧本胜利链完成。
- 第20261011局在T12仅剩277与368两个日军资源格，B29和轰炸条件皆已达成，却因两处资源距离与编队集结太晚，转而占其它格。此开发负例用于下一版前移资源战略；本批结果保留，不作为新版本验收。留出种子仍未运行。

### 2026-10-04 — AI-WIN-01 1943胜利链定点修复

- 尝试在T6–8提前提高资源优先级：1943种子20261011、20261004的T12日军资源余额分别由2/4恶化到5/6；已撤回。尝试在T9后每牌容许第三独立任务：三局资源余额均恶化；已撤回。两组探索性负例仅保存在 `tmp/ai-win-01`，不混入正式评测。
- 使用完整回放重建种子20261011末回合：360等前沿资源港口已有地面部队和护航舰队，但守备预留名单包括201等所有关键地面部队，使最后资源368无法被占领。此诊断回放最终哈希与原结果一致。
- 窄范围修复：仅T12、PW>2、连续战略轰炸/B29达标且日方恰剩2资源时，允许已占格的驻军参加最后资源突击；实际激活、路径、护航、ASP、胜算与引擎判胜仍受原规则检查。普通回合照常守备。
- 同种子定点对局在T12以日方资源1格完成原子弹合法胜利；1600动作完整回放一致，最终哈希 `eae35fcc1c4a8396568901134b2570af446d43d3a40d424695824060cbb4ce84`，固定日本AI5由旧策略辅助校验658次，盟军为纯动作回放。该单局仅证明胜利链可达，新版本仍须两剧本32开发种子与冻结留出验证。
- 48项规划契约及46项相关JavaScript测试通过；运行时模型请求0。

### 2026-10-04 — AI-WIN-01 首版完成与独立留出结果

- 冻结 `a35a557`，两个剧本各32个开发种子与32个独立留出种子，原 AI5/增强版配对合计256局，全部自然有效终局；所有16局盟军胜局均有完整回放 sidecar，0未验证、0验证失败、0 fallback、0缺失图表节点。冻结清单SHA-256为 `db98af8728770c40500d98a7910934e37d6742aaed9828e73b3d628d1cf59e0d`。
- 1942：开发0/32→8/32胜，留出0/32→7/32胜；留出配对精确McNemar双侧p=0.015625。两批增强版均0提前条约败，真实同港登陆编队均32/32局形成。
- 1943：开发0/32→1/32胜，留出双方0/32；开发胜局20261011是合法原子弹完整回放。提前条约败开发27/32→0/32、留出29/32→0/32；PoW达标大幅改善，但没有留出胜率提升证据，不能宣称已能稳定战胜AI5或真人。
- 本机留出局耗时中位：1942原版13.3秒、增强版89.4秒；1943原版7.8秒、增强版59.0秒。额外耗时主要来自真实合法性/移动与反应查询，运行时模型调用仍为0。
- 永久评估报告和机器可读汇总为 `research/ai-win-01/final-evaluation.md`、`research/ai-win-01/final-comparison-a35a557.json`；完整本地证据在 `tmp/ai-win-01/`，交互验收页已更新为两阶段256局数据。1943首次前沿编队在增强版条件中位T9，是下一轮需预注册新种子的主要瓶颈；本轮留出集不得复用作独立验证。

### 2026-10-04 — AI-WIN-01-PUBLISH 胜局归档准备

- 选定 1942 首批五胜的种子 `20261014`、`20261015`、`20261017`、`20261022`、`20261035`，归档其在最终冻结策略 `a35a557` 下的版本；另附 1943 种子 `20261011` 的原子弹胜局。五局是开发集样本，不充作独立留出验证。
- `replays/ai-win-01/` 保存六份无损压缩的完整动作回放、对应两份规则包及 SHA-256 索引。`node tools/verify-ai-win-archive.js` 从归档内容重演六局，六局均核对了盟军自然胜利、胜因、动作数与最终状态哈希。约 26 MB 归档避免把约 300 MB 未压缩临时 JSON 纳入 Git 历史。
- 本阶段只做归档与本地验证；运行时模型请求 0，规则和策略均未改变。下一步将当前分支推送 GitHub 并创建 PR。

### 2026-10-04 — AI-WIN-01-PUBLISH GitHub 发布完成

- 将 `feat/AI-WIN-01-allied-campaign` 推送到 `origin`，创建 [PR #1](https://github.com/fuxiaoji/rots/pull/1)。AI 源码、评估报告、五局 1942 胜局及一局 1943 胜局均随分支发布；未合并入 `master`。
- 六份压缩回放与两份压缩规则包使用仓库内 `replays/ai-win-01/index.json` 的 SHA-256 复核，`node tools/verify-ai-win-archive.js` 六局全过。仓库内保留开发集与留出集的区分，不把归档的五局当作独立胜率证据。

### 2026-10-05 — AI-WIN-02 本州战役开发里程碑（40% 门槛未过）

- 新增本州登陆时机、前沿同港集结、合法护航与 HQ 调整、直接本州目标评分及失败后切换；第 `20261210` 局在 T9 地面进入本州 3606/3706，T10 进入 3705，最终 T12 连续封锁胜。该局不是本州七格全占胜。双剧本最后一格本州优先与实际国家状态段判胜回归通过。
- 按中文规则第 40 页 13.91 和实际 `ground_move_denied` 发现满洲禁止任何单位进入，撤回朝鲜山地前推的错误实验；1943 有两处日控满洲资源且苏联卡当前不可打出时，转向本州准备。釜山固定加权在两局定点试验破坏已有封锁胜，已撤回。
- 当前盟军包 SHA-256 `d878e6ae7445275b5eff9d389d5bdcf19b6f12732a52124d0ac47be385659013`，固定日本 AI5 包 `df4afef8e7705a960e05a4de99443d9663f32cc9c76632a65e4a538044266e43`。预注册开发种子两个剧本各32局均自然有效：1942 为6/32胜（1封锁、5原子弹），1943 为3/32胜（1封锁、2原子弹），原AI5配对对照均0/32。九局均按合法动作与完整终局状态哈希重演；早期旧日本AI5重算建议动作有漂移，核验旁证单列，不改原始结果。
- 1942 提前条约败1/32、PoW达标140/282有效回合；1943 提前条约败1/32、PoW达标223/251。九份胜局已做无损压缩归档；开发集仍低于两个剧本各13/32目标，未打开新留出种子，不宣称独立泛化提升或真人胜率。运行时模型请求与模型成本均为0。详见 `research/ai-win-02/development-results.md`。

### 2026-10-05 — LLM-01 模型对战接口验收

- 核对金融项目多代理规范，项目执行模型为 `gpt-6.1-sol`；Astra 负责设计与审查裁决，两名 Sol 分别交付提供商和本地页面候选补丁，主代理整合。GLM/DeepSeek 独立有界 API 审查的原文、实际模型、哈希、用量、分歧与裁决见 `docs/llm-review.json`，不冒称外部自主 worker。
- 新增异步白名单观察、同源PNG、规则/卡牌元数据提示、短候选编号、阵营隔离记忆、预算与请求账本、私有存档、规则包归档和离线逐步哈希回放。引擎本身仍同步；具体移动路径来自原合法生成器，程序协助advance显式计数。
- 本地页面支持玩家/状态机/LLM组合，固定人类视角、创建者令牌、默认暂停、有界快进和终局回放；Node22无需RTT Windows路径。浏览器实测人类两个动作、DeepSeek对手一个真实请求，版本3，己方手牌可见、对手手牌不公开；页面已保留供继续体验。
- 新增40项验证全通过；规则查询、Erasmus保存回放及基线3个回归入口成功。含完整FSM自然终局、完整脚本提供商LLM协议终局与精确回放，但二者不等同真实LLM自然终局。
- MiniMax-M3、deepseek-flash、glm-5.3文本与glm-4.6v真实图片短轨迹都合法执行并离线回放通过。GLM长候选哈希抄错的一位保持失败记录；缩短编号后5次连续决策成功。真实API与程序强制/协助动作分开计量，实际数据和来源哈希见 `docs/llm-validation.json`。
- 测试凭据只在Git忽略的0600本地配置，私有轨迹与记忆不提交。源代码提交只包含LLM主题；保留AI-WIN-03其他任务的未提交改动。规则摘录尚非完整逐窗口全文，卡牌效果正文未补齐，没有真实LLM整局棋力/冻结胜率结论。启动和调试命令见 `docs/llm-interface.md`。

### 2026-10-05 — AI-WIN-03 规则执行与堆叠修复阶段（整局目标仍开放）

- 将适用多代理规范写入项目，Sol执行模型改为GPT-6.1 Sol；Astra及两名Sol只读候选由主代理整合。外部GLM/DeepSeek无本项目审查入口，未冒称已完成，未使用其他项目凭据。
- 修复跨起点地面／登陆编组、Java未命名路线、已知牌下同港集结与实际支援CF；修正EC防方物流按OPS复位。只对三张明确可跳过伞兵窗口的事件作声明式预览，实际机器人执行合法skip。公开反应按真实骰规则记录区间，不降原夺取阈值，不读取敌手牌或未来随机数。
- 增强双方机器人默认启用堆叠保护。整组投影处理航空配对、原地超限、六舰和HQ容量；最终落点筛选与后续筛选保持交集；七舰全部可动时逐舰PBM；参战航空恢复不得使用未参战扩展航程。真实旧航空损失场景与七舰实际动作均有公开构造回归，查询完整state/RNG/日志不变。
- v21冻结包SHA256 `82a79baa7413584f008ed9748e23e1f4135ada2cd4a72ae62c188adbd6029b09`；75项相关Node测试、81项源合同通过。Astra指出的两项PBM见证问题已修复并复核；当前只完成定点及相关验证，整局评测仍进行中，贪心退路搜索不是完备性证明。
- v19盟军1942为6/32、1943为5/32，11胜全部合法完整重放通过，均未达40%。v18日军前三轮两国32/32，前五轮DEI6/32，仍未达50%；未开启独立留出，不标任务完成。产品运行时模型请求与模型成本为0。
- 为避开原rots工作树并行LLM-01修改，使用 `/Users/Zhuanz1/Desktop/code/eots/ai-win-03-worktree` 继续本任务，保留另一任务文件。按用户要求暂停GitHub提交、推送与PR发布，修改及证据保留本地。

## 2026-10-05 AI-WIN-03 单次规划缓存验证阶段（长期目标仍开放）

- 当前隔离源码与v22包SHA256为 `d4b5a48aebdf576857125dddef06e3c6127df66b7f9e074a0f9740963d621b34`；只共享单次plan的战略运输堆叠布尔，禁止跨动作及临时PBM投影共享。
- 集中75项Node检查、82项源合同通过；两份已录公开决策窗口恢复490原动作后对照v21，完整动作及AI元数据一致、完整state纯度通过、全部缓存命中位置一致。局部查询减少不外推整局。
- v20日军已完成：前三轮两国31/32、前五轮DEI6/32，64份配对回放全通过；未达32/32和16/32。v21双方完整开发评测仍进行，独立留出未开启。
- 用户要求的GitHub提交、推送及PR发布暂停；本条记录本地验证阶段，不将长期目标或发布标记完成。

### 2026-10-05 — AI-WIN-03 与 LLM-01 整合发布准备

- 最新用户指令解除GitHub暂停，要求当前AI改进和LLM接口一起上传。保留LLM原提交 `d6ade89` 与双方历史记录，只在隔离分支整合，不覆盖原工作区。
- 重新内联构建后，统一115项Node测试、82项源合同全通过；包含安全堆叠出口的合法campaign轨迹。没有新增付费API调用，私有配置、轨迹及凭据继续排除。
- v21日军完整固定32开发样本：前三轮两国30/32、五轮DEI3/32，64配对全重放通过；v21盟军1942四胜均完整回放通过、分母32，1943批次仍运行。该冻结包与整合发布包分别记录，不冒称当前包40%或日军100%/50%已达标。

## 2026-10-05 — LLM-EVAL-01 本地真实评测与接口修复

- GitHub同步最新开发2138eba，分支test/LLM-EVAL-01-rtt-10games；密钥仓库外存储，Windows ACL限制私有文件，未发布或推送。
- v4冻结South Pacific同10配对种子20262201–110，各模型日本/盟军5/5，对手AI5；30次尝试全部已执行轨迹重演通过，18自然终局、12未完成。MiniMax3胜3自然负4未完成；DeepSeek5胜4自然负1未完成；GLM2胜1自然负7未完成。全部自然终局是日本胜，两个AI5同10种子亦全部日本胜；不证明LLM优于AI5或完整规则理解。
- 正式真实API3208请求、24,472,883报告tokens、累计请求延迟11,095,093ms，9次用量unknown；含所有开发/诊断、HTTP UI、视觉与独立审查总3594请求、27,440,480报告tokens、12,725,660ms、10次unknown。货币成本unknown，未以tokens当实际账单。
- MiniMax2 FORMAT/2 HTTP529；DeepSeek1 NO_CANDIDATES；GLM7 HTTP429，单次独立探针1308使用上限，未获取重置时间。旧v2/v3诊断和用量单列，没有重开、换提供商或修改规则提高胜率。
- 首局固定截点31条语义案例审计显示HQ地点、单位编号、OC/事件LV、预算、ASP阵营和旧记忆错误；未完成原计划全30局语义核对，已登记偏差，不报告知识准确率。Wilson仅名义二项参考区间，不能作供应商棋力排名。
- 已修激活/取消、活动单位与移动编队、公开实际预算、场景/VP投影、完整路径与v4候选编号合同。正式结果冻结后v5仅修复无路径移动的引擎合法undo出口：DeepSeek-10真实保存点副本恢复5候选、原状态不变、API0；未续跑原失败局。v4策略代码私有归档，尚无v5新增整局胜率。
- v5 28项harness/HTTP/恢复检查通过，15项提供商检查复用未变输入，共43项；统计实际结果汇总与真实保存点检查通过。文档、公开逐局摘要、规则/代码哈希和范围见research/llm-eval-01。

## 2026-10-05 — RTT-LLM-01 原生接入与接口验收阶段

- 8080原生AIvsAI创建页注册已配置MiniMax/DeepSeek/GLM文本及GLM地图图片模型，保留同步规则和原状态机；通过私有异步桥选择引擎候选，不创建第二份棋局。创建后默认暂停。
- 创建者专用白名单摘要显示简短理由、当前计划、备注、提示提供资料和用量；双方当前决策保留，唯一候选后的最近模型选择仍可见。不返回原始观察、完整私有轨迹或reasoning_content；模型说明不冒充规则裁定。
- SQLite事务同时提交棋局/回放/轨迹/记忆；发送前保存请求账本，保存失败可复用prepared，未知在途不自动重发。版本哈希覆盖模型配置、规则、接口、图片器及规则资料。回退恢复对应记忆，费用不归零；删除锁和实例隔离防串局，删局账本私有归档。先提交再广播，发送错误不会回滚已提交动作。
- 9项bridge定点检查通过，安装器原锚点/语法/幂等通过；独立合成用户与mock provider的RTT8181阶段8次假请求、24次LLM桥动作/32次FSM动作，正常阶段边界暂停、权限/双击/删除回退锁及完整混合回放通过，真实API0。旧19项harness已复用成功结果，规则未改。
- 开发真实DeepSeek game91：3次请求、20,032报告tokens、累计请求延迟5,183ms，3合法动作重演一致，在预算耗尽时明确阶段未完成；重启后请求/记忆/预算不变。生命周期后续加固以mock验证，不冒称最终包新增整局棋力验证。
- DeepSeek独立审查1请求6,027 tokens，采纳async兜底；其余错误假设逐条按真实SQL/转义/锁核对未采纳。GLM独立审查1次接口失败、用量未知，未冒称完成双模型审查；Astra/Sol只读审查发现并关闭生命周期/版本/错误持久化风险。合计5真实请求26,059报告tokens、1次用量unknown，货币成本unknown。
- 已建game92（日军AI5、盟军DeepSeek）沿用原game85–88的owner2，默认暂停且请求0。浏览器建局预选与额度显示人工核对并保存本地截图；当前浏览器未登录，创建者侧栏视觉抽检待办，HTTP摘要权限已通过。用户“wan2llm”的另一个具体模型名未确认，未虚构支持。文档与哈希见docs/rtt-llm.md及research/rtt-llm-01/validation.json。

## 2026-10-06 — LLM-PROMPT-01 提示与计划记忆实现阶段

- v6按实际窗口加载完整相关来源页，补足补给/启动、两栖、反应和PBM；白名单提供当前牌/模式/预算、己方补给/ASP、PoW与剧本条件、完整公开地图邻接及单位能力。未公开选中牌只给活动阵营；规则裁定未改变。
- 同次回答维护战役/回合/攻势任务，省略字段保留、显式null清除，局部修改不能续期过时目标。成功动作提交程序recent和执行后事实；RTT事务/trace/回退记忆一致，费用保留；重复公开决策明确暂停。
- 原92失败窗口的旧/新6调用及冻结前2复查保留负例，最终独立种子20262501–03共4决策合法回放。激活连续两步保留campaign/recent由1到2，但notes未更新；PBM错述193地点/移动，日本目标与PW0胜利条件矛盾。接口门通过，语义门未过，没有长期攻势或新胜率结论；验证后不调参。
- 19 harness+9 prompt/memory+9 RTT共37检查通过，最终提示修改重跑受影响28项；旧92的113条动作状态哈希与修复前完全一致。安装器语法/幂等、最终mock RTT6假请求13桥动作23FSM动作的权限/锁/边界/回放通过，真实API0；一次损坏mock归档重跑后替换证据。
- GLM-5.3与DeepSeek-flash独立只读审查、Astra裁决、Sol实现审计，root整合。全部开发/审查/验证合计14真实请求408,250报告tokens、累计请求延迟66,292ms，用量unknown0、货币成本unknown。日本战役选牌输入82,338tokens，成本仍高，不声称已解决。
- RTT8080启动HTTP200，原92/93保存旧上下文供复盘；新94盟军DeepSeek对日本AI5沿用owner2，默认暂停请求0。浏览器视觉抽检被Browser Use安全策略拒绝（原错误页协议不允许），未绕过；后端接口和权限检查通过。结果/哈希/请求账本在research/llm-prompt-01，本轮仅本地提交。

## 2026-10-06 — LLM-WIN-01 接口与开发检查点（长期目标仍未达）

- v7/v7.1补齐四国正式投降与正控制审计、战役目标合同、4项攻势任务、可编辑计划/只读程序历史与预览压缩；directOnly过滤advance，所有模型微步骤仍由当前合法候选决定。v7.2增加既定任务纯查询，不修改裁定。
- 用户将基线改为战役AI：旧dev-01原AI5的21请求845,800tokens/27动作只保留开发负例；余额恢复后dev-02从seed20262602合法setup对盟军erasmus-campaign开始，未在已有局中替换对手。
- dev-02请求59累计1,998,634tokens/169动作，PH/MAL要求格均控制，但四正式标记仍0，DEI/BURMA未完成。第59 high选牌16,384生成tokens截断，完整回放通过；随后显式迁移v7.2并保留费用/配置历史继续，未宣称成功或整局胜率。
- 42项组合本地检查通过；扩展conquest7项与受影响RTT9项通过，涵盖纯度/敌私有信息独立/路径/同异港/未知预览/保存恢复。Astra/Sol只读审查；第一轮双模型2请求27,106tokens，本轮任务事实GLM超时unknown、DeepSeek失败15,687tokens+成功18,952tokens，未冒称本轮双模型完成。完整费用范围与结果边界见research/llm-win-01/results.md。
- v7.3在第195动作/77请求/2,655,551累计tokens完整回放检查点后迁移，按PDF29–30页补地面战阈值/倍率/平手守方胜，澄清异港护航/航空航程/公开字段；新接口conquest7+prompt9检查通过。首次Palembang登陆9CF未打出LF6导致零损平手失败保留，四正式投降标记仍0；目标继续。

## 2026-10-07 — LLM-WIN-01 移动方式与当前兵力修复（目标仍未达）

- v7.4修复观察/提示歧义：advanced_move仅展开方式，默认落点不是各方式并集；原revision200副本零API验证480经两栖方式出现。起点三元路径不算已移动，己方实际路径白名单保留且不作为PBM禁令。45项组合检查通过；真实模型第94请求主动展开，后续95/96格式失败保留。
- dev-02第265动作/106请求完整回放通过，3,703,653累计tokens、2,323,247ms、程序强制46、协助0；菲律宾/马来亚正式标记2/2且仍正控制，DEI/BURMA0/0，任务继续，不声明四国成功。
- v7.5派生当前军力面CF与基础ASP，避免减损43被当18CF/2ASP；实际编组费用可因建制运输、驳船或事件降低，查询/候选优先。微步骤输出仅变更字段，memory:{}保留记忆，格式校验仍严格；8项征服定点检查通过，Astra只读语义复核。未修改裁定、种子、对手或历史轨迹。

### 2026-10-07 — LLM-WIN-01 补给证据及选牌陆进查询阶段（目标未达）

- dev-02请求170/422动作完整回放通过：PH/MAL正式标记2/2，关丹失守，DEI余5/BURMA余4；6,213,134累计tokens、3,953,221ms，forced83/assisted0/unknown0，货币unknown。登陆缺护航与关丹反攻失败保留，不报告整局胜或四国成功。
- v7.6观察层将无公开断补证据的快速缓存false改null，HQ/已激活true注明豁免。选牌/模式/HQ窗只查询己方精确eligible卡/HQ单兵陆进端点；96预览/128查询截断明确partial，未知事件unknown，已离手牌的当前己方牌仍授权。规则哈希不变、不自动编队、不读取敌方私有数据。
- 10 conquest+9 prompt+9 RTT共28受影响检查分次通过；Sol只读复核和真实HQ纯查询探针通过，root整合。零API初始选牌测量16.01→49.95ms、84,577→97,777 UTF8字节，仅该窗口描述，字节不代替token费用。
- v7.5私有归档，第422动作后显式迁移v7.6继续原局，费用不清零，当前目标仍in_progress。

### 2026-10-07 — LLM-WIN-01 关丹收复与OC任务相容性阶段（目标未达）

- dev-02第500动作/198真实请求完整回放通过，关丹收复、PH/MAL正式2/2且正控制；DEI余5/BURMA余4。累计7,329,673tokens/4,630,115ms、forced102/assisted0/unknown0，high选牌再截断32,768，费用保留，未称目标成功。
- v7.7按PDF17§7.24提醒同一OC若多个任务均攻击守军格会冲突，不自动判备选/后续任务非法；稀疏表明确检查集合及完整单兵陆进否定语义。Astra只读裁决，root实现；10 conquest+9 prompt+16 provider+19 harness+9 RTT共63唯一相关本地检查分次通过。
- 规划请求65,536生成/480秒、微步骤原32,768/240秒；provider仅DeepSeek有界上限放宽，其余不变。最初第199尝试被旧本地上限拒绝，网络API未发送，tokens0；通用失败/unknown原记录及单列审计保留。修复后预检在步进之前，同局迁移保留费用和哈希，长期目标继续。

### 2026-10-07 — LLM-WIN-01 仰光推进与增援定义阶段（目标未达）

- 第642动作完整回放通过，provider尝试247中真实网络246、199本地配置失败无网络。9,277,836累计tokens/5,905,555ms，forced129/assisted0；unknown1为保留的本地错误统计，已发送请求报告用量完整，货币unknown。
- v7.7真实夺Tarakan、Rangoon；Miri被夺回，PH/MAL2/2正控制，DEI余5/BURMA余3。原局多版本开发，不声明四国达成或自然终局胜。
- v7.8将自动selected/active己方场外单位定义保留，修复增援P51只有编号的问题；11 conquest+9 prompt、受影响19 harness通过，16 provider/9 RTT未变成功证据复用，共64唯一检查。
- 第642动作后显式累计预算10m→20m，history记录完整，费用/失败/动作不重置；Astra裁决继续当前有进展的局，root整合。20m为暂停上限，新有界段继续，长期任务in_progress。

### 2026-10-07 — LLM-WIN-01 同策略823动作检查点（目标未达）

- 310实际网络请求+1本地配置失败，11,905,682累计tokens/7,360,097ms，forced157/assisted0；823动作完整回放通过。PH/MAL2/2正控制，Burma四格全控但正式0，DEI仅余309 Tjilatjap/421 Miri。中途Burma失三格已保留，重新夺控不当正式投降。
- v7.8/20m累计上限及规则未改，64项未变输入成功检查复用；继续下一有界段，费用/失败不清零，不称整局胜率或四国目标完成。

### 2026-10-07 — LLM-WIN-01 860动作保存与余额阻断（目标未达）

- 333网络请求+1本地配置失败，12,760,653累计tokens/7,798,128ms，forced162/assisted0；860动作完整回放通过。第334 HTTP402未执行动作，官方余额-0.05元/is_available=false，已请求充值原账户；未改用其他模型或FSM代打。
- PH/MAL正式2/2正控制，Burma四格全控待结算，DEI余309 Tjilatjap/421 Miri。保存paused是请求资源失败，长期任务未完成；费用/失败/策略/规则历史全保留。
- RTT无在途请求后按项目脚本重启，PID50376/HTTP200、v7.8加载；当前生成包157f93含另项半自动扩展，原局恢复器继续使用冻结825b6d归档，两个规则包不混算。无额外原生付费请求/浏览器视觉验收。

### 2026-10-07 — LLM-WIN-01 用户授权GLM接续阶段（目标未达）

- 用户“用glm”后，rev860显式Japan DeepSeek→GLM-5.3，controllerHistory记录状态/冻结规则/对手/记忆哈希及priorStats；原保存点三文件归档，费用/失败/动作不重置。实际响应model与profile分开记录，结果混合归因，不称GLM独立整局/纯DeepSeek胜。
- 12项conquest通过，新增切换保持状态/记忆/统计/完整回放检查；Astra只读裁决、root实施，真实开发协作外部API0。GLM首请求335实际glm-5.3，37,494tokens/5,189ms。
- 实际接续进入第5回合，Burma正式4、PH/MAL2/2正控制；DEI余Tjilatjap/Miri。新有界段进行中，目标未达，完整结算与GLM阶段用量待该段结束，货币unknown。
