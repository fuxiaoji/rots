# 架构索引

当前阶段只固定边界，不提前实现未经核验的规则。

未来系统分为以下层：

1. `Rule Corpus`：带来源页码与规则编号的事实层。
2. `Domain Model`：单位、地图、卡牌、阵营、阶段与隐藏信息模型。
3. `Legal Action Generator`：仅根据玩家可见状态生成合法动作。
4. `Transition Engine`：纯函数式状态转移、显式随机种子和事件日志。
5. `Policy Layer`：人类、伊拉斯谟、搜索或 Transformer/RL 策略，共用同一动作接口。
6. `Evaluation Harness`：对局、回放、回归测试、指标与实验版本记录。

详细数据契约将在 P2 根据规则知识库建立。
