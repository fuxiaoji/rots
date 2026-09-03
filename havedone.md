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
