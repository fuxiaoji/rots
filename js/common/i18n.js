/** Data-only game localization. Canonical game objects are never mutated. */

const EOTS_LANGUAGE_KEY = "eots.language"
const EOTS_DEFAULT_LANGUAGE = "zh-CN"

var EOTS_UI_ZH = {
	"Japan": "日本", "Allies": "盟军", "Observer": "观察者",
	"Play card": "打出卡牌", "Rebuild unit": "重建单位", "Roll": "掷骰",
	"Prompt": "提示", "Continue": "继续", "Use Bonus": "使用修正",
	"Play Event": "触发事件", "Play for Operations": "作为作战牌打出",
	"Hold": "保留", "Advanced move": "扩展移动", "No move": "不移动",
	"Eliminate": "消灭", "Stop": "停止", "Displace": "撤离",
	"Reduce divisions track": "降低师级编制", "HQ Withdrawal": "司令部撤退",
	"Early HQ Return": "司令部提前返回", "Remove Inter-Service Rivalry": "消除军种对立",
	"China Offensive": "中国攻势", "Future Offensive": "未来攻势",
	"Build Jarhat Road": "修筑焦尔哈德公路", "Build Imphal Road": "修筑英帕尔公路",
	"Build Ledo Road": "修筑利多公路", "Discard": "弃牌", "Choose all": "全选",
	"Pass": "过牌", "Skip": "跳过", "Range": "航程", "Next": "下一步",
	"Done": "完成", "Delay": "延迟", "Disable organic": "禁用建制移动",
	"Avoid ZOI": "避开影响区", "Strategic": "战略移动", "Amphibious": "两栖突击",
	"Ground": "地面移动", "Extended range": "延长航程", "Barges": "驳船",
	"Redo": "重做", "Undo": "撤销", "Review Proposal": "查看回滚提议",
	"Allied Event Cards": "盟军事件卡", "Japanese Event Cards": "日本事件卡",
	"Victory Points": "胜利点", "Eliminated Units": "被消灭单位",
	"Political Status": "国家状态", "Battle info": "战斗信息",
	"Current offensive": "当前攻势", "Japan Hand": "日本手牌", "Allied Hand": "盟军手牌",
	"Default road markers": "默认道路标记", "Hide unit path": "隐藏单位路径",
	"Vassal like control": "类 Vassal 控制", "Hide ZOI": "隐藏影响区",
	"Read me!": "说明", "Rules": "规则", "Charts": "图表",
	"Allied Deck": "盟军牌库", "Japanese Deck": "日本牌库",
	"Inspect Japanese Cards": "查看日本卡牌", "Inspect Allied Cards": "查看盟军卡牌",
	"Inspect Political Status": "查看国家状态", "Inspect Victory Points": "查看胜利点",
	"Inspect Eliminated Units": "查看被消灭单位", "Check Unit Supply": "检查单位补给",
	"Check Distance": "检查距离", "Load full log": "载入完整日志",
	"Language": "语言", "Chinese": "中文", "English": "English",
	"ERASMUS decision trace": "伊拉斯谟决策轨迹"
}

function eots_language() {
	if (typeof localStorage === "undefined") return EOTS_DEFAULT_LANGUAGE
	return localStorage.getItem(EOTS_LANGUAGE_KEY) || EOTS_DEFAULT_LANGUAGE
}

function eots_t(text) {
	if (eots_language() !== "zh-CN" || typeof text !== "string") return text
	if (EOTS_UI_ZH[text]) return EOTS_UI_ZH[text]
	return text
		.replace("You are watching!", "正在观战！")
		.replace("Waiting for Allies to confirm post battle move.", "等待盟军确认战后移动。")
		.replace("Waiting for Japan to confirm post battle move.", "等待日本确认战后移动。")
}

function eots_localized_name(kind, name) {
	if (eots_language() !== "zh-CN" || typeof EOTS_ZH_NAMES === "undefined") return name
	return (EOTS_ZH_NAMES[kind] && EOTS_ZH_NAMES[kind][name]) || name
}
