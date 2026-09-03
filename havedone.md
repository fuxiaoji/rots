# 已完成工作记录

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
