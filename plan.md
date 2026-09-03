# 太阳帝国兵棋引擎与 AI 研究计划

## 总体研究问题

如何在一个规则复杂、隐藏信息显著、行动空间动态变化的卡牌驱动兵棋中，构建可验证的确定性引擎，并比较规则状态机、模仿学习 Transformer 和强化学习策略的表现、稳定性与可解释性？

## 阶段与质量门

### P0 - 项目治理与可复现基线

- 建立 `agent.md`、`plan.md`、`havedone.md`。
- 固定目录职责、来源权威顺序、提交约定和完成定义。
- 质量门：仓库干净、首个项目基线提交可检出。

### P1 - 规则知识库

- 将中文规则书和伊拉斯谟图表逐页 Markdown 化。
- 建立 SHA-256、页码、规则编号和提取方式记录。
- 按 1.0-16.0 章节整理规则书；保留页面重叠以避免跨页语义丢失。
- 将图表分成日本与盟军、决策轴/选牌/任务编成/反应四类。
- 质量门：55 页都有逐页文件；章节文件可追溯；缺页与版面风险有记录。

### P2 - 规则本体与状态模型

- 定义实体：阵营、单位、卡牌、格子、HQ、资源、标记和剧本。
- 定义状态：公开状态、阵营私有状态、随机状态、阶段/环节状态。
- 定义动作：合法性前置条件、成本、效果、后置条件和日志事件。
- 为规则建立稳定 ID，例如 `EOTS-7.25`。
- 质量门：状态 schema 可序列化、可哈希、可重放；核心规则有决策表。

### P3 - 确定性状态机与规则引擎

- 实现回合、阶段、环节和中断/反应窗口。
- 分离合法行动生成、状态转移、随机数和视图投影。
- 用固定种子记录完整事件流，支持保存、恢复、回放与差异比较。
- 质量门：核心流程与战斗测试通过；同一状态、动作和种子产生相同结果。

### P4 - 伊拉斯谟 PvE 基线 AI

- 将 12 页图表转成机器可执行决策图。
- 实现日本与盟军的阶段切换、选牌、任务编成和反应决策。
- 所有动作输出 `decision_trace`，包含节点、条件、掷骰、候选动作和最终选择。
- 质量门：逐节点黄金测试覆盖；图表回放结果与人工走图一致。

### P5 - 训练环境与数据集

- 提供 Gym 风格 `reset/step/legal_actions/observation` 接口。
- 用伊拉斯谟、自博弈和人工对局生成带版本号轨迹。
- 隐藏信息按玩家视角投影，杜绝信息泄漏。
- 质量门：轨迹可重放；数据 schema、种子、引擎版本和策略版本齐全。

### P6 - Transformer 与强化学习

- 先做行为克隆基线，再做离线 RL/在线自博弈。
- 候选架构：状态/事件序列编码器 + 合法动作掩码 + policy/value heads。
- 对照组：随机合法策略、启发式策略、伊拉斯谟策略和搜索增强策略。
- 质量门：在冻结评测集和未见种子上报告胜率、非法动作率、决策时间和校准误差。

### P7 - 科研评估与报告

- 预先固定主要指标、对照组、随机种子和停止条件。
- 分离探索性实验与确认性实验。
- 报告消融：规则特征、历史长度、动作表示、奖励塑形和对手池。
- 质量门：结果可复现；结论不超出数据；限制与失败案例完整记录。

## 当前迭代

当前迭代：12 页已生成独立 JSON/Markdown 文档与运行时编译数据，图表解释器已接入 South Pacific；条件谓词仍有显式 inferred 项，必须继续逐页视觉校对和黄金路径覆盖。未经校对的图表条件不得伪装成确定规则。

配套补全（2026-09-03）：
- `erasmus_complete_ai_state_machine.py` 作为可运行的确定性状态机 AI 研究参考（覆盖决策轴/选牌/编成/反应四窗，含 `--self-test`）。
- JS 引擎 `js/server/bots/erasmus.js` 解释器升级为“按候选迭代 + 合法动作过滤”的优先级解析；`*_OPS_CARD` 与 `*_EVENT_CARD` 在选行动窗口消歧；策略版本 `erasmus-v2.0-zh.3`，50 固定种子回归 0 fallback、全部正常终局。
- 1942 完整剧本自对弈：修复 `before_commit_offensive` 卡牌攻势限制导致的“确认窗仅剩 undo”死锁——受限确认窗新增 `cancel` 出口，回退到选行动窗口并将该卡本回合禁止再以攻势打出；新增剧本参数化 AI vs AI 运行器，`1942-1945 (The Shortened Campaign)` 10 局 0 报错、全部正常终局。
- 攻势零会战修复：`evaluateChart` 里“unit+done 且有激活单位即强制 done”的兜底不再作用于 `Declare battle hexes.` 窗口——该窗口的 `unit` 是选取射程内已激活空中单位发起空袭（随后 `action_hex` 创建战斗格），此前被整窗吞掉导致全程零会战。策略版本 `erasmus-v2.0-zh.4`；1942 全剧本 10 局 0 报错、每局平均申报 16.5 个会战格并产生真实交战，South Pacific 50 种子回归 0 fallback/全部终局。已知边界：无头 bot 无法做地面接敌移动（目标路径由客户端 `move(path)` 提供，服务端不暴露路径参数），会战以空中打击为主。
- RTT PvE 场景白名单扩到 `1942-1945 (The Shortened Campaign)`（`create.html` 不再强制回南太平洋），供人类在浏览器里亲自体验完整剧本 vs 伊拉斯谟；服务端建局冒烟通过。
- 50 局多种子完整剧本验证（seeds 20260903–20260952，审计运行器 `tests/erasmus-campaign-audit.js`）：发现并修复 **Fuel Shortage 事件窗死锁**（`events.js` `P.fuel_shortage`：选中单位无可落位目的地时窗口只剩 undo，真人靠 undo、bot 无合法动作）——`prompt()` 检测陷阱自动丢弃该次选择并写入 `L.unmovable` 不再重复候选；引擎级语义等价出口，策略版本仍 `erasmus-v2.0-zh.4`。修复后 50/50 正常终局、0 报错；胜率日本 50 / 盟军 0；双方战略（决策轴+选牌）与战术（编成+反应+空袭会战申报+交火）决策均 >0（日本 49.9%/50.1%，盟军 46.6%/53.4%）。SP 50 与 1942 10 局回归与基线逐项一致。
- 无头自对打环境修复（策略版本 `erasmus-v2.0-zh.5`）：地面/海上接敌移动路径原由客户端算（`L.allowed_hexes` + `move(path)`），服务端不暴露路径动作参数，无头 bot 无法推进进敌格。新增 opt-in `headless_moves` 开关，`P.move_offensive_units` 在攻击/会战移动/反应三阶段复用客户端 `update_move_hex()` 计算落格并按目标评分执行 `advance`（推进/夺格/进战斗格），解除 PBM 无路可走悬死、补 `js/move.js append_path` 潜伏 `units` 未定义 bug、`erasmus.js` 加 `advance` 覆盖与 awaiting-only 兜底。50 局完整剧本（headless 开）50/50 终局 0 报错、260 次地面接敌、双方各 1322/1911 次推进决策、盟军夺格 22→177；headless 关的 OFF 50 / SP 50 / 1942 10 三组回归与 zh.4 基线 0 差异（行为 opt-in，关闭不变）。胜负仍日本全胜——阵营失衡为已知范围外，非本修复对象。
- 盟军 0 胜定向归因（headless 10 局，seeds 20260903–20260912）：10/10 以 **PW 归零条约败** 结束（t8–11），~2/3 扣分是 Progress of War 未达标（逐回合需新夺 ≥pow 个名城格，几乎每回合失败，10 局 ~67 败 vs 2 成）；夺格吞吐太低且散——马来亚/暹罗同几格的反复拉锯（Kuala Lumpur×11/Jitra×8）占 29/44，中央太平洋只偶达 Saipan/Palau，**从未触达菲律宾马尼拉/冲绳/日本本土任何格**（0 例），故“登陆日本失败率”实为“从未能发起登陆”；~50% 攻势无战事（No battle hexes declared）。根因是图表解释器只有分窗战术、无回合级选轴与夺格配额。修复方向（拟 zh.6）：回合级“保 PoW 夺格节奏 + 中央太平洋主线 + 过滤空转攻势”。
- zh.6 已落地其“选轴 + 焦点执行”子集（`erasmus-v2.0-zh.6`）：新增 `js/server/erasmus_ops.js` 目标聚焦操作层（盟军中太平洋主线 Wake→Tarawa→Kwajalein→Eniwetok→Palau/Ulithi→Saipan→Iwo/Okinawa→本土；日本资源<13 时南方资源夺控轴），`erasmus.js` 选目标格/会战单位与 `offensive.js` 可渡海推进都向“当前最优先未夺目标（焦点）”聚焦、目标夺控才放行下一格，publicTrace 增 axis/focus 可审计；同源 Python 参考引擎 `erasmus_complete_ai_execution_engine.py` 通过 `--self-test`。headless 完整剧本 50 局 50/50 终局 0 error（含修复“无进攻路径撤退单位”崩溃 2 种子）；同种子 10 局 No-battle 申报 343→278、马来亚/暹罗拉锯消失、日方南方资源轴依目标表夺控；胜负仍日本全胜——回合级“保 PoW 夺格节奏”与盟军两栖登岛推进留 zh.7。
- zh.7 完整状态机移植（`erasmus-v2.0-zh.7`）：按用户指示把完整 py 参考引擎 `erasmus_complete_ai_execution_engine.py` 的**决策树 + 有序目标链 + 阶段门槛** 1:1 移植成 JS 回合级状态机 `js/server/erasmus_state.js`——每方每游戏回合的首卡窗按 py 树求值一次、钉住该方该回合战略，下回合首卡重评；仅完整全图剧本启用（gate 需地图含菲律宾/DEI/日本区域；South Pacific/Burma 等 gate-off 走原 zh.6 路径，SP-50/erasmus.test.js 金标不动）。目标链经 `eop_set_strategy_chain` 覆盖固定轴，其余沿用 zh.6 焦点执行层。**保真自测** `tests/erasmus-state-fidelity.test.js`：59 例（含 py `--self-test` 三黄金用例）同 ctx 同策略名，逐字通过。headless 完整剧本 50 局（seeds 20260903–20260952）50/50 终局 0 error/0 action-limit、968 次钉选（≈19.4/局 = 每方每回合首卡一次），轴分布 JP 早期外围防御/中期资源战略、AP 早期建立ABDA/t4 DEI/t5-8 南太平洋/t9+ 占领轰炸基地，阶段门槛随真实地图状态切换。同种子 10 局 zh.6→zh.7：盟军夺格 14→23、AP 推进决策 131→357、groundMove 24→45、fallback 28→19、no-battle 278→249、日本转图表守势（capturedJP 10→0）。胜负仍日本全胜：盟军 50 局仍未夺马尼拉/马里亚纳/冲绳/日本本土名城格——两栖登岛/夺岛推进瓶颈留 zh.8。
- zh.7 B 引擎占格/登岛执行（同一 `erasmus-v2.0-zh.7`）：先修夺格计数低估（早期探针只扫本方 action 增量、漏 ~8 成跨方 `done/next` 边界结算与 `&A` 会战窗前缀的夺控行，曾误报“基线 0 夺岛”）；真根因 = 攻势总挑离焦点最近的纯空/海军（只空袭不夺控）+ 两栖编成不渡空海（够不着焦点岛就原地放弃）。修复两处执行：`erasmus_ops.js` `eop_pick_unit` 焦点敌占时偏置激活两栖地面（B_BIAS）、`offensive.js` 两栖编成朝焦点空海巡航推进（B_CRUISE）。同种子 40 局 A/B（20260903–20260942，逐格夺控事件口径，均 0 error/action-limit）：AP 夺格 193→497（4.8→12.4/局）、触岛种子 26→39/40、岛屿夺控 70→290；纵深恩尼威托克 5→33/40、硫磺岛 8→32/40（真实 `+3 Amphibious assault` 强攻登岛）。边界：马尼拉/冲绳/本土终局控制两臂仍 0/40——剧本 ~t8-12 日本 PW 先胜，冲绳/本土不在时间窗；详见 havedone。
- zh.7 A/C 忠实补做（同一 `erasmus-v2.0-zh.7`，用户“研究一下,状态机原文是没问题的,可能是你偷懒了”指示下对 py 参考引擎做缺省部分逐字对拍）。**(A) 计划层忠实化**：补移植 py `_resolve_pointer`（L857-871：检索序 JP_MID→JP_EARLY→JP_LATE→AL_MID→AL_LATE→AL_EARLY、`token∈key or key∈token`、跨 Goal 扁平化**不去重**、取链最长者）与逐行 `_classify`；修“见外围防御”错落 13 格兜底（1/38 失配根因：角色标签与指针递归去重两处），py 金标 `tests/results/py-goals-golden.json` + `tests/erasmus-goal-fidelity.test.js` 逐策略比 kind 序列与逐位 hex——**39/39 逐字相等**。**(C) 事件战略顺序化**：py 对 EVENT 只在 executor ADMIN-log 不打牌，事件清单（JP 8 行 / AL 6 行）是“按序打事件”的行为说明——JS 钉住事件战略时按 py 口径展开（JP 中/晚目标“同早期阶段事件战略”为指针、AL mid/late 决策树直接 `return AL_EARLY_STRATEGIES["事件战略"]` 且 JS AL mid/late 库原无此键曾静默落空 EVENT）；`esm_bind_strategy_entry` 把事件战略任意阶段绑定到【早期】清单条目，选牌窗 `esm_event_strategy_card_pick` 把清单逐行译成引擎条件按序执行（结束己方 ISR=己阵营 `isr_agreement` 牌且己方 ISR 激活；造成敌方 ISR=己阵营 `isr_rivalry` 牌且敌方未 ISR；东京玫瑰/杜立特/巴丹/天气点名牌），命中行内取最小 OV、行不可行顺延、全行无命中退通用选牌；`via=事件战略:清单#N「行」` 与 `eventPhase` 进 trace 可审计。自测 `tests/erasmus-event-strategy.test.js`（JP/AL×三阶段→早期 8/6 行）8 例过；headless 1942 16 局 0 error、事件战略钉选 goals=8、定向命中例 `清单#3「造成美国ISR」`/`清单#4「东京玫瑰」`。gate-off（erasmus.test.js / SP）与 goal-fidelity 39/39、state-fidelity 59/59 全绿。

## 初始评估指标

- 引擎：规则测试通过率、重放一致率、非法状态率、每步耗时。
- 伊拉斯谟 AI：图表节点覆盖率、人工一致率、非法动作率、决策可解释率。
- 学习型 AI：胜率、Elo、样本效率、动作熵、价值校准误差、跨剧本泛化。
- 工程：可复现实验比例、规则到代码追溯覆盖率、回归缺陷数。
