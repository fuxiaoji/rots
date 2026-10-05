# LLM-01：本地模型对战

在 `rots/` 运行，需要 Node.js 22 或更新版本，无新增 npm 依赖：

```sh
node tools/inline.js
node tools/llm-arena.js
```

打开 http://127.0.0.1:8090/。配置 Japan / Allies，支持人类 vs LLM、状态机 vs LLM、LLM vs LLM。建局默认暂停，“AI 下一步”执行一个动作；快进最多20步，遇人类窗口停止。South Pacific为默认剧本，状态机支持范围按原配置校验。1942/1943可选增强盟军 `erasmus-campaign`；1942可选增强日军 `erasmus-japan-campaign`，原Erasmus和AI5继续作为独立选项。

## 配置与模型

私有配置默认是 `.env.llm.local`，Git忽略；也可通过 `EOTS_LLM_ENV_FILE` 指向仓库外的配置文件，arena和CLI都支持。环境变量优先。POSIX权限0600；Windows必须用ACL限制私有配置及`llm-private/`目录（chmod不能提供Windows访问隔离）。本次凭据存于仓库外的私有目录。浏览器不接收密钥。参考 `.env.llm.example`，不要用示例的空值覆盖已有密钥变量。

- `minimax`：MiniMax-M3文本。本轮使用 `EOTS_LLM_MINIMAX_BASE_URL=https://api.minimaxi.com/v1` 成功。
- `deepseek`：deepseek-flash文本，关闭思考。
- `glm`：glm-5.3文本，enabled/low思考。中国Coding密钥设 `EOTS_LLM_GLM_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4`。本轮通用端点HTTP429/code1113，Coding端点成功，两者额度不可混同。
- `glm-vision`：glm-4.6v，共享GLM密钥；另设 `EOTS_LLM_GLM_VISION_BASE_URL` 为Coding端点，本轮真实PNG调用通过。
- `custom`：设置 `EOTS_LLM_BASE_URL/MODEL/API_KEY/VISION`，支持同一Chat Completions协议的模型/本机兼容服务。视觉能力显式声明，不能由模型名字推定。这不是所有供应商协议的通用转换器。

官方来源：[MiniMax](https://platform.minimax.io/docs/api-reference/text-openai-api)、[DeepSeek](https://api-docs.deepseek.com/api/create-chat-completion/)、[GLM-5.3](https://docs.z.ai/guides/llm/glm-5.3)、[GLM-4.6V](https://docs.z.ai/guides/vlm/glm-4.6v)。开发执行模型使用 [`gpt-6.1-sol`](https://developers.openai.com/api/docs/models/gpt-6.1-sol)，与游戏运行时模型独立。

## 规则、提示、记忆

规则引擎保持同步，LLM异步层只从棋局副本生成白名单己方观察：自己的牌元数据、公开单位/控制、窗口、公开日志、规则摘录与合法候选。禁止发送牌库、PRNG、敌方手牌/记忆、回滚和缓存。人类页面固定阵营，观战无私有牌。文字压缩地图/单位字段；PNG由同一观察生成，红Japan、蓝Allies，格号与文字一致。图片是示意棋盘。

v4模型只返回当前短候选编号，例如 `r3-a2`，以及摘要和记忆，不能提交任意动作或AI元数据。决策编号保留在服务端账本；状态版本、活动阵营和当前候选精确校验负责绑定响应。真实前测发现模型选对动作却反复抄错额外nonce，故移除其回显要求。非法编号拒绝，至多一次重新请求；重试可以重新选择当前候选，两次用量均记录。

`move`使用引擎生成的当前编队真实路径；`advance`明确标为程序协助，由现有程序选编队/落点，不算LLM自行决定全部移动。v5仅在所选移动方式无真实路径、当前窗口只有引擎合法撤销出口时保留`undo`，不开放通用撤销。未适配窗口或异常明确暂停，不静默换状态机，也不改游戏规则。

记忆按game/role隔离，含objective、最多6条notes、最近12个己方动作。合法执行成功后才提交；旧计划可以失效，猜测不成为事实。规则摘录目前每章前1800字符，来自带页码/哈希的机械提取；South Pacific额外提供官方§17.10.7简述及当前引擎VP模式。已激活单位、移动编队与取消候选分别显示，本方激活预算和当前VP投影由程序计算；不能把复述这些值当作模型独立推理。静态卡牌metadata不等同完整事件正文。尚未提供逐窗口全文检索或完整地图拓扑，不宣称完整规则理解。

## 预算、存档、审计

整局请求硬上限、动作上限、单请求超时与已报告token预算可配置。页面默认40次请求；单请求默认30秒。唯一候选由程序直接执行。128动作滑窗内同局面超过16次暂停，是harness停止策略，不是规则裁定。无静默接管。

逐请求账本保留真实模型、prompt/output/观察/来源哈希、用量、耗时和结果码；截断、空响应中的已付用量也计入。用量缺失标unknown，不能当0。token预算只约束可报告用量，未知请求仍受请求硬上限；货币单价未配置，成本unknown。

`llm-private/arena/`保存0600私有棋局、记忆和创建者令牌哈希；标签页sessionStorage保存令牌，刷新/重启可恢复。API只在终局开放完整回放，避免初始种子和未公开选牌泄漏。每次保存归档精确规则包；离线回放不调用API，逐步核对合法动作和状态哈希。接口代码变化默认拒绝恢复，显式策略迁移保留旧/新哈希及动作号，不能豁免规则哈希检查。旧记录缺少模块哈希时仅保有当时已有的来源证据。

```sh
node tools/llm-cli.js profiles
node tools/llm-cli.js play --profile deepseek --role Allies --steps 10 --max-requests 10 --out llm-private/demo
node tools/llm-cli.js inspect --input llm-private/demo.save.json --role Allies
node tools/llm-cli.js play --input llm-private/demo.save.json --steps 10
node tools/llm-cli.js verify --input llm-private/demo.replay.json
node tools/llm-cli.js play --input llm-private/demo.save.json --allow-policy-migration true --steps 10
node --test tests/llm-*.test.js
```

早期接口证据见 `docs/llm-validation.json` 和 `docs/llm-review.json`。新的真实API整局评测、诊断与冻结清单见 `research/llm-eval-01/`。真实短轨迹、脚本模型对局与FSM终局分别统计，不能冒充真实LLM胜率。
