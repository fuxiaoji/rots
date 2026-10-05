# South Pacific：LLM 规则补充 SP-17.10.7

来源：GMT Games，Empire of the Sun V3.2（2021），PDF第43页，§17.10.7。
URL：https://gmtwebsiteassets.s3.us-west-2.amazonaws.com/EOTS_Rules-2021-LR.pdf
来源PDF SHA256：4c7c241d8d1c2e7851705dd72caed701d605ed62299c7294262bcf3c9ec70450
人工核对日期：2026-10-05。以下为简述，非逐字转录。

官方规则允许开局选港口控制或VP模式。未提前获胜时在第6回合结束判胜。VP模式：日本VP<=2为盟军决定性胜利，3–5为盟军战术胜利，6–9为日本战术胜利，>=10为日本决定性胜利。控制计分须满足补给条件；日本分数考虑中国战线、Townsville隔离、低于4的盟军政治意志、澳大利亚委任统治地、新几内亚、Vogelkop、新赫布里底与澳洲本土港口。盟军政治意志为0，日本自动胜利；任一方在场景地图无HQ则失败，Oahu不算场景地图内HQ。

当前软件使用VP模式。observation.scenario.victory来自当前引擎，表示若现在按终局方式结算的投影，实际终局由引擎产生。本次接口修复未改任何裁定。官方Townsville隔离条款以地图东边缘为基准，当前引擎使用Oahu路径；该差异待另行审计，不能把投影当完整官方规则验证。
