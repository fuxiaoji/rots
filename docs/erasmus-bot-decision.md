# 伊拉斯谟 v2.0 机器人决策文档（erasmus-v2.0-zh.7）

> 本文档描述 **当前正在使用** 的 JS 决策树/状态机机器人 `rules.bots["erasmus-v2"]` 的
> 完整决策、行动、选牌逻辑，供逐条核对。对应源码：
> - `js/server/bots/erasmus.js` —— 决策入口 + 图表解释器 + 无头移动安全网
> - `js/server/erasmus_state.js` —— 回合级状态机（决策树 + 策略表 + 选牌）
> - `js/server/erasmus_ops.js` —— 操作聚焦层（选目标格 / 选进攻单位）
> - `js/server/erasmus_data.js` —— 生成的 `ERASMUS_CHARTS`（zh.6 决策轴图，gate 关时用）
>
> 规则引擎（cycle/game/offensive/scenario/supply/actions/events 等）**不是本机器人的代码**，
> 机器人只通过 `view`（动作菜单）与 `context`（seed/role）观察，并返回一个 `action` 名 + `argument`。

---

## 0. 总体架构：两层

机器人对每个「轮到它」的窗口（prompt）做一次 `decide(view, context)`，返回
`{ action, argument, publicTrace, privateTrace }`。内部有两层，按剧本分叉：

| 层 | 文件 | 作用 | 何时生效 |
|---|---|---|---|
| **状态机层**（选轴+选牌） | `erasmus_state.js` | 每回合首卡钉住一个「战略」，并产出有序目标链；决定本回合打 OC 还是打事件/哪张牌 | 完整全图剧本（1942-1945 缩短战役等，含菲律宾+东印度+日本区域） |
| **图表解释器层**（微执行） | `erasmus.js` | 窗口级走 `ERASMUS_CHARTS` 决策轴图，把动作名映射到合法按钮，选参数 | 子图剧本（South Pacific / Burma）全程；完整剧本中作为「战略钉住之后的逐窗口微执行」 |

完整剧本下两者**协作**：状态机决定「这个回合打哪个战略、主攻哪条目标链」，图表/操作层在
「激活哪些单位、往哪格申报会战、怎么移动」这些逐窗口问题上按该链执行。

---

## 1. `decide(view, context)` 入口流程（erasmus.js L365-400）

```
decide(view, context):
  1. 若 esm_gate_on()（完整全图剧本）:
       sm = esm_pin_strategy(view, context)          # 首卡窗求值钉住, 其余沿用缓存
       若 sm 非空: eop_set_strategy_chain(role, {name,kind,note,goals,chain})  # 覆盖操作层焦点链
     否则: eop_clear_all_chains()                    # gate 关, 防跨剧本串台
     （任何 SM 异常 → sm=null，回退原路径，不阻断游戏）

  2. 若 sm 非空:
       a. 若 esm_is_card_window(view)     ("Select card to play.") → esm_card_window_action(sm,...)
       b. 若 esm_is_card_action_window(view) ("C{idx}: Select action.") → esm_card_action_window_action(sm,...)
       c. 其余窗口 → 落到下方图表微执行（焦点链已被外部链覆盖转向钉住战略）

  3. chart = select_chart(role, view)               # 选一张决策轴图
     res  = evaluateChart(chart, view, context)     # 走图 → 得 action+argument
     若 sm 非空, 给 res.publicTrace 附加 sm 的 trace（axis/phase/strategy/focus/diag）
     返回 res
```

`context` 携带 `role`（"Japan"/"Allies"）、`seed`、`actionOrdinal`（本局第几个动作，单调递增）。

---

## 2. 状态机层（erasmus_state.js）

### 2.1 剧本门槛 `esm_gate_on()`（L38-58）

- `G.sid === SOUTH_PACIFIC_SCENARIO || BURMA_SCENARIO` → **关**（子图剧本走 zh.6 图表）。
- 否则再自检地图内容：必须同时存在 `Philippines` / `DEI`（含 Java/Sumatra/Borneo/Celebes）/ `Japan`
  三个区域 → 开；缺任一个 → 关。
- 结果按 `sid` 缓存。

### 2.2 阶段判定 `esm_phase(role)`（L69-84）

| 角色 | early | mid | late |
|---|---|---|---|
| **日本** | 默认 | 马来亚+东印度+菲律宾**全部投降**，或 `turn>=4` | 盟军控制了**距东京 ≤8 的港口** |
| **盟军** | 默认 | `turn>=4` | 塞班(Saipan)由盟军控制，或 `turn>=9` |

判断顺序：先判 late，再 mid，否则 early。

### 2.3 首卡检测 + 缓存（L840-946）

- 模块级缓存 `ESM_LOCKED[key]`，key = `${seed}|${sid}`；每方存 `{turn, phase, strategyName, strategy, runStart, runHeld}`。
- **新对局检测**：回合回退 或 `actionOrdinal` 回退 → 清缓存重建（多局同进程防串台）。
- **首卡窗判定**：`esm_is_card_window(view)` 且（该方本回合尚无缓存 或 缓存回合 ≠ 当前回合）。
  - 首卡窗 → 求值决策树、钉住战略、写缓存。
  - 非首卡窗 → 直接返回缓存中的已钉战略（同回合沿用）。

### 2.4 决策树（逐分支，源码 L219-329）

决策树输入 `ctx`（引擎真实状态算出的布尔量，见 §2.5），输出**战略名**。随机分支用
`erasmus_hash` 派生的 d10（不进引擎 RNG）。

**日本早期 `esm_jp_eval_early`（页1）：**
```
if 盟军 HQ 在菲律宾/DEI/马来亚断补 (jp_A):
    if 手牌>=3:
        if 日本资源<13 (jp_D):                         → 激进的空优战略
        if turn>=3:
            if 后勤>=20 (jp_F):                        → 中太平洋战略
            if (后勤<=19 或 AZOI覆盖DEI港口) 且 控拉包尔+瓜岛: → 中太平洋战略
            if 外围目标1完成 (jp_M):                    → 马绍尔防御
            否则                                        → 外围防御战略
        否则                                            → 外围防御战略
    否则                                                → 激进的南方资源战略
if DEI 投降格全被占 (jp_B):                            → 保守的空优战略
if 手牌>=3 且 马来/菲/DEI 未全降 (jp_L):
    d10: <=2 → 事件战略; <=6 → 激进的南方资源战略; 其余 → 外围防御战略
否则                                                    → 事件战略
```

**日本中期 `esm_jp_eval_mid`（页2）：**
```
if 手牌<3:   can_pass → PASS;  否则 → 事件战略
if 资源<13 (jp_D):                                      → 资源战略
if 后勤>=20 (jp_F):
    if 美战争意志<4 (jp_E):                              → 中太平洋战略
    if 缅甸已降 (jp_F_burma):
        if (有甘地 或 缅步数>盟) 且 后勤>=18:              → 印度战略
        否则                                            → 外围防御战略
    否则                                                → 中缅印战略
if 后勤>=15 (jp_G):   （同上缅甸分支, 印度战略/外围防御/中缅印）
否则                                                    → 外围防御战略
```

**日本晚期 `esm_jp_eval_late`（页3）：**
```
if 手牌<3:                                              → 事件战略
if 距东京8内港口全驻军 且 距东京5内机场全驻军:             → 最终国防圈战略
if can_pass:                                            → PASS
if 盟军地面在本州:                                       → 最终防御战略
否则                                                    → 事件战略
```

**盟军早期 `esm_al_eval_early`（页7）：**
```
if 手牌<3:                                              → 事件战略
if 菲律宾 HQ 未补给:                                     → 撤离菲律宾
if 马来亚 HQ 未补给:                                     → 撤离马来亚
if 未打过 Arcadia(ABDA):                                 → 建立ABDA
if CBI 防御未建立:                                       → 增强CBI防御
if 有 pass 且 仅剩1牌:                                   → PASS
if 菲未降 且 军种一致 且 >=2航母 且 美陆军军近航母 且 澳无日地面: → 橙色计划
if DEI未降 且 ABDA补给:                                  → DEI防御
否则                                                    → 攻势进攻
```

**盟军中期 `esm_al_eval_mid`（页8）：**
```
if can_pass:                                            → PASS
if 需战争进程(银行<G.pow) 且 手牌>=3 且 日控>=1反攻目标:   → 反攻战略
if 手牌<3:                                              → 事件战略
d10: <=4 → 南太平洋战略; <=7 → 中太平洋战略; ==8 → DEI战略; 其余 → CBI战略
```

**盟军晚期 `esm_al_eval_late`（页9）：**
```
if can_pass:                                            → PASS
if turn==12 且 手牌<3:                                   → 事件战略
if 无战略轰炸基地(距东京8内己控机场):                     → 占领轰炸基地
if B29 未全就位基地:                                     → 推进B29
if 未控制距东京8内格:
    d10: <=2 → 重返菲律宾; <=5 → 跳岛作战; 其余 → 轮流战略
if 满足原子弹判据:                                       → 原子弹胜利
否则                                                    → 登陆日本
```

（`轮流战略` 通过 `esm_resolve_alternate` 在「重返菲律宾↔跳岛作战」间按上回合相反切换。）

### 2.5 ctx 布尔量 → 引擎真实状态映射（`esm_build_ctx`，L353-490）

| ctx 字段 | 含义 | 引擎来源 |
|---|---|---|
| `cards_in_hand` | 手牌数 | `G.hand[faction].length` |
| `can_pass` | 能否 PASS | `G.passes[faction] > 0` |
| `current_turn` | 回合 | `G.turn` |
| 日 `jp_A` | 盟军 HQ 在菲/DEI/马来断补 | `G.oos` + region |
| 日 `jp_B_dei_surrender_hexes_occupied` | DEI 关键格全日控 | `nations.DEI.keys` 全 `is_space_controlled(JP)` |
| 日 `jp_D_res_lt_13` / 资源 | 日本资源格数 | `get_jp_resources()`（`RESOURCE_HEX` 中 JP 控） |
| 日 `jp_F/G/J` 后勤 | **手牌 LV(`logistic`) 合计**（用户选定口径） | `Σ G.hand[JP] 中 cards[c].logistic` |
| 日 `jp_E_us_will_lt_4` | 美战争意志<4 | `G.wie < 4`（口径=WIE） |
| 日 `jp_I_azoi_covers_dei_ports` | AZOI 覆盖 DEI 港口 | `has_zoi(h, JP)` 覆盖 `esm_geo().deiPorts` |
| 日 `jp_J_controls_rabaul_guadalcanal` | 控拉包尔+瓜岛 | `is_space_controlled` |
| 日 `jp_M_perimeter_target_1_complete` | 外围目标1完成 | Sarong/Vogelkop/Biak/瓜岛/莫尔茨比 全 JP 控 |
| 日 `jp_L_B/C` 驻军 | 距东京8内港口/5内机场全驻军 | 全 `is_space_controlled(JP)` |
| 日 `jp_L_E_allied_on_honshu` | 盟军地面在本州 | region=Japan 的 AP ground |
| 盟 `al_B/C_hq_supplied_phil/malaya` | 菲/马来 HQ 补给 | SW/Malaya/ABDA HQ 在位且非 `G.oos` |
| 盟 `al_D_arcadia_played` | 已打 Arcadia | AP#4 已移除 或 ABDA 已上盘 |
| 盟 `al_E_cbi_def_established` | CBI 防御已立 | SEAC 在位 且 缅甸有盟军地面（近似） |
| 盟 `al_K_service_agreement` | 军种一致 | `G.inter_service[AP] !== 1` |
| 盟 `al_L_has_2_carriers` | ≥2 航母 | naval 且 `br` 计数 |
| 盟 `al_M_us_corps_near_carrier` | 美陆军军近航母 | 航母与 AP ground 距离 ≤15（页7 近似） |
| 盟 `al_M_B_needs_war_progress` | 需战争进程 | `G.capture` 中 AP 控格数 < `G.pow`（引擎口径 PoW 银行） |
| 盟 `al_M_D_jp_controls_counterattack_target` | 日控≥1反攻目标 | 反攻战略链上存在 JP 控格 |
| 盟 `al_L_D/E/F/G` | 轰炸基地/B29就位/控8内格/原子弹判据 | 见 §2.9 |

### 2.6 策略表（`ESM_JP_LIB` / `ESM_AL_LIB`，L691-746）

每个战略 = `{ name, kind, targets(有序目标行), notes }`。`kind` 决定选牌行为：

| kind | 含义 | 选牌意图 |
|---|---|---|
| `CONQUEST` | 有序夺控/作战目标链 | 打 **OC** 攻势 |
| `EVENT` | 事件战略（8/6 行事件清单） | 打 **事件牌**（按清单顺序） |
| `PASS` | 本回合跳过 | **pass** |
| `GARRISON` / `DEFEND` | 国防圈/最终防御（v1 近似） | 按事件微执行 |
| `ABSTRACT` | 推进B29 / 原子弹胜利 | 打 **OC**（原子弹持苏联牌时优先事件） |

目标行经 `parse_goals` 解析（`esm_parse_goals_inner`，L645-684）：
- 分类关键字：压制=SUPPRESS、登陆日本/板载=INVADE_JAPAN、航母攻击=NAVAL、B29/轰炸=B29、
  驻军/加固=GARRISON、加强港口=PORTS、投降/占领/夺/攻占/推进/登陆/进军=CONQUEST，其余按是否含格名落 CONQUEST/ADMIN。
- 取格：4 位 hex id → idx；英文地名 → 名称匹配；中文区域 → 区域命名格/区域资源格；「见X」→ 跨战略指针展开。
- `chain` = 所有 Goal 的 hex 去重保序，喂给操作聚焦层。

### 2.7 同轴延续（D2，L799-834）

仅当「旧轴与新掷都是**同阶段 d10 轮换轴**」时可能延续旧轴（防止每回合对翻、链首格永远夺不下）：
- 轮换轴 = mid 的{南太平洋/中太平洋/DEI/CBI}、late 的{重返菲律宾/跳岛作战}。
- 旧轴链上仍有未夺目标 → 延续旧轴；链目标全达成 → 允许重掷。
- 旧轴连钉 ≥2 回合仍无链上推进（控格数没涨）→ 放行换轴（停滞出口）。

### 2.8 资源剥夺入链（D5，L916-930）

仅在钉住「登陆日本 / 原子弹胜利」且链非空、`get_jp_resources() > 1` 时：
把「仍在日本手里的资源格」按距链首距离前置进链，让焦点层把资源真正打到 ≤1
（引擎 `victory_1945` 的战略轰炸胜利线要求 `get_jp_resources() <= 1`）。

### 2.9 原子弹判据（`esm_atomic_met`，L493-505）

三条件全真才「原子弹胜利」：
1. 无战略轰炸失败（`lock.bombFail` 为空；引擎把 STRAT_BOMBING_CAMPAIGN 置 0 即记一次失败）。
2. 苏联入侵满洲已发生（`G.removed[AP]` 含 SOVIET_INVADE）或 盟军持该牌且可作事件。
3. 日本控资源格 `<=`（已打苏联 ? 3 : 5）。

---

## 3. 选牌逻辑（状态机层）

### 3.1 选牌窗 `esm_card_window_action`（L950-985）

按已钉战略的 `kind` 决定意图：

| kind | 行为 |
|---|---|
| PASS | 返回 `{action:"pass"}` |
| GARRISON/DEFEND | `esm_choose_card("event")`（打事件/低值牌，保大 OC） |
| ABSTRACT | 先 `esm_atomic_event_pick`（原子弹胜利持苏联牌→打苏联事件），否则 `esm_choose_card("ops")`，退 `event` |
| CONQUEST | `esm_choose_card("ops")`（最高 OV 可打 OC 牌），退 `event` |
| EVENT | 先 `esm_event_strategy_card_pick`（按清单顺序），退 `esm_choose_card("event")`，再退 `ops` |

### 3.2 `esm_choose_card(hand, intent, ...)`（L991-1003）

- `intent="ops"`：在「可作 OC」的牌里选 **OV(ops) 最大** 者。
- `intent="event"`：在「可作事件」的牌里选 **OV 最小** 者（保住大 OC 牌）。
- 验证经 `get_allowed_actions(c)`；验证失败退化到任一手牌。

### 3.3 事件战略顺序化 `esm_event_strategy_card_pick`（L1018-1055）

把早期事件清单（JP 8 行 / AL 6 行）逐行译成「手牌/引擎状态」条件，取首个可执行行：

| 清单行（命中条件） | 取牌 |
|---|---|
| 结束己方 ISR（己方 `G.inter_service` 激活） | 己方阵营 `isr_agreement` 牌 |
| 造成敌方 ISR（敌方未 ISR） | 己方阵营 `isr_rivalry` 牌 |
| 东京玫瑰 | 名含 "Tokyo Rose" |
| 杜立特空袭 | 名 "Doolittle Raid" |
| 巴丹行军 | 名含 "Bataan/Battan Death March" |
| 天气牌 | 名 "Weather" |
| 其余（欧战正负/补员/东条1OC/FOQ/其他放牌） | 无可稳定判定 → 顺延，由通用选牌兜底 |

命中行内取 **OV 最小** 的牌。

### 3.4 「Select action」窗 `esm_card_action_window_action`（L1058-1066）

- CONQUEST / ABSTRACT → 返回 `{action:"ops"}`。
- EVENT / GARRISON / DEFEND → 返回 `{action:"event"}`。
- 意图不可行 → null（落回图表默认）。

---

## 4. 图表解释器层（erasmus.js，微执行）

### 4.1 选图 `select_chart`（L74-86）

按窗口内容定 `kind`：
- 含 `card/event/ops` 按钮 → `card-selection`
- prompt 含 reaction/反应 → `reaction`
- 含 `unit/hex/action_hex` → `task-force`
- 否则 → `decision-axis`

再按 `phase`（turn>=10=end, >=5=middle, else early）在 `ERASMUS_CHARTS` 里找
`role+phase+kind` 匹配的图，找不到逐级放宽。

### 4.2 走图 `evaluateChart`（L190-332）

- 过滤合法动作（排除 undo/redo/awaiting）；无合法动作且只有 `awaiting` → 返回 `awaiting`。
- 从 START 沿 `condition` 节点走（`predicate_value` 求真假 → 选对应边），到 `action/priority/fallback/terminal`。
- `priority`（SELECT）节点：`first_executable_strategy` 按优先级迭代候选，返回第一个
  能在当前窗口执行的动作；全不可执行 → `fallback`（保护出口）。
- 之后有一连串**无头安全网修正**（见 §4.4）。

### 4.3 谓词 `predicate_value`（L50-72）

把谓词 id 映射到 `view` 状态：手牌数、后勤、资源、WIE、pass、回合、FO、会战、天气、ISR、
支援点等；以 `TARGET_/ENEMY_/CAN_/GROUND_/DAMAGE_/IS_/HAS_` 开头的未知谓词一律 false。

### 4.4 动作/参数选择

- `strategy_family(tag)`（L88-97）把策略名后缀归类：`_OPS_CARD`→ops、
  `(UN)LIMITED_EVENT_CARD/_EVENT_CARD/_EVENT`→event、`FUTURE_OFFENSIVE`→fo、
  `PASS`→pass、`PBM/REACTION`→reaction、`GROUND/LANDING/STRIKE/ADVANCE`→ground，其余 default。
- `action_for_strategy(strategy, legal)`（L99-104）：按 family 的动作优先级表
  `FAMILY_ACTION_PRIORITY` 取第一个合法动作。
- `pick_argument`（L119-129）：候选按字符串数值排序，取 `erasmus_hash(seedText) % len`（确定性伪随机）。
- `target_argument`（L134-188）：见 §5 操作聚焦层 + CDSS 增援。

### 4.5 无头移动安全网（L237-315，防崩溃/防死循环）

按顺序修正，覆盖正常策略结果：
1. 进度 `(N of M)` 满且可 `done` → `done`。
2. 「Activate units」窗无可新增单位（只剩空中/已激活）→ `done`。
3. 非「Declare battle hexes」非「Activate units」且有已激活单位 → `done`（收尾）。
4. fallback → 取保护出口，过滤 `HEADLESS_MOVE_NOOP`。
5. 出现 `advance` → 必选 `advance`（无头地面/海军推进）。
6. 「Move units」+ 纯空（无 advance）→ `turn_box`（退回合轨）。
7. 「unit」候选全是已选(unselect) → 若移动窗则选 unit 撤销（让 advance/done 接管），否则跳下一个非 unit 动作。
8. 「Move units」+ 已有选中组 + 无 advance + 有 no_move/advanced_move → `no_move`/`advanced_move` 收尾。
9. 最终 `HEADLESS_MOVE_NOOP` 兜底 → 退回 advance/done/turn_box/unit/no_move/... 等可控动作。

`HEADLESS_MOVE_NOOP = {move, avoid_zoi, amphibious, barges, extended_air, advanced_move, no_organic}`
（这些按钮只切 move_type 或直接崩溃，永不作最终动作）。

---

## 5. 操作聚焦层（erasmus_ops.js）

### 5.1 主轴与焦点

- `eop_axis(role)`：外部链覆盖（状态机钉住的 `chain`）优先；否则默认 `EOP_AXES`：
  - 盟军 = `AP_CENPAC_MAIN`（Wake→Tarawa→Kwajalein→Eniwetok→Palau→Ulithi→Saipan→Iwo→Okinawa→日本本土）。
  - 日本 = `JP_SOUTH_RESOURCE`（资源<13 时抢南方资源；达标后返回 null=转防守）。
- `eop_focus(role)`：链上第一个**未被本方控制**的格（「目标达成前不换目标」）。

### 5.2 选目标格 `eop_pick_action_hex`（L142-155）

候选里选**距焦点最近**的格（逐步靠近主轴），无焦点返回 undefined。

### 5.3 选进攻/激活单位 `eop_pick_unit`（L185-216）

- 主键 = 到**最近敌单位**的距离（越靠前线越先激活，激活后当回合即可开战夺格）；
  次键 = 到焦点距离（保留战略方向）。
- 两栖偏置（B 开关，浏览器默认开）：焦点是敌占格时，若候选里有「到最近敌军距离不比最优
  远太多」的**两栖地面**（`asp` 或 `strat_move`），优先选它组成登陆力量（否则总挑纯空/海军，
  只会远距空袭、无法登岛占格）。

### 5.4 引擎无头推进转向 `eop_advance_tiebreak`（L222-227）

供 `offensive.js` 在同等优先目标内做次级排序（靠近焦点）；无焦点返回 -1。

---

## 6. CDSS 增援/补员落位（erasmus_state.js L1092-1230）

增援落位 `esm_pick_placement` 按优先级打分（越小越优）：
- **B29**：距东京 ≤8 的港口/机场（最优）→ 最近基地 → 中国盒兜底。
- **指挥部 HQ**：盟军 → 指定母港（SWPac→澳、CPac→瓦胡岛、ANZAC→莫尔茨比、SEAC→加尔各答）；
  日军 → 最近东京。
- **地面**：离敌人(地面)最近的港口；**空中**：离敌 AZOI 最近的港口/机场；**海军**：离敌最近的港口。

补员选择 `esm_pick_replacement_unit`：优先恢复被消灭部队（回盘）> 翻正减损 > 满员；同类选最强战力。

---

## 7. 确定性

- 所有随机来自 `erasmus_hash(seedText)`（FNV-1a，L36-40），seedText 含
  `${seed}:${actionOrdinal}:${chart}:${node}`。
- d10 = `hash % 10`；图骰 = `hash % sides + 1`。
- **绝不触碰引擎 RNG**（`G.seed` / `random()`）；相同 seed 下决策完全确定。

---

## 8. 已知边界 / 近似（记录在案）

1. **后勤值口径** = 手牌中带 `logistic` 字段的军事事件牌 LV 之和（用户选定口径）。
2. `jp_E_us_will_lt_4` 用 `G.wie`（War in Europe）口径，非 `political_will`。
3. `al_M_us_corps_near_carrier` 用距离 ≤15 近似；CBI 已立用「SEAC 在位 + 缅甸有盟军地面」近似。
4. GARRISON/DEFEND 为 v1 有界近似（按事件微执行）；推进B29/原子弹胜利（ABSTRACT）落到
   具体可执行回退链（占领轰炸基地 / 重返菲律宾）。
5. 无头环境：地面/海军接敌靠 `advance` 按钮（`headless_moves` 开关）；空中单位不参与常规
   攻势夺格（留原地 ZOI/防守），会战申报以「Declare battle hexes」空袭为主。
6. 战略轰炸胜利线（引擎 `victory_1945`）要求 `get_jp_resources() <= 1`，即盟军需打下 14 个
   资源格中的 13 个——这是当前盟军仍未取胜的核心原因（当前只打下 1 个资源格）。

---

## 9. 快速核对清单（人工抽查用）

- [ ] 完整剧本首卡窗是否钉住战略，且 trace 的 `axis/phase/strategy` 与决策树分支一致？
- [ ] 同回合后续窗口是否沿用同一战略（不重复掷轴）？
- [ ] d10 轮换轴是否有同轴延续（不每回合对翻）？
- [ ] 选牌：CONQUEST 打最高 OV 的 OC；EVENT 按清单顺序、OV 最小；PASS 直接 pass？
- [ ] 激活单位是否按「离最近敌军最近」优先，且两栖地面优先于纯空/海军？
- [ ] 无头移动窗是否稳定推进（advance / no_move / turn_box），无 toggle 死循环？
- [ ] 增援 B29 是否落位距东京 ≤8 的基地？
