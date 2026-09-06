// 冻结「AI 1.0」(git a68de77 / erasmus-v2.0-zh.22，用户认定的最佳 AI)。此文件不包含
// 任何策略逻辑——它只负责把 zh22 的四份源码包进一个 IIFE，用命名空间隔离 zh22 与
// 测试版(zh.23+)同名的 eop_*/esm_* 函数，再把返回的 EOTS_BOTS 以新 key
// "erasmus-v1.0" 合并进外层 EOTS_BOTS。逻辑原样，仅改显示名。
var EOTS_BOTS_V10 = (function () {
/** import server/bots_v10/erasmus.js*/
return EOTS_BOTS
})()
if (typeof EOTS_BOTS !== "undefined" && EOTS_BOTS_V10) {
    for (const k of Object.keys(EOTS_BOTS_V10)) {
        const v10 = EOTS_BOTS_V10[k]
        if (v10 && typeof v10 === "object") {
            v10.name = "AI 1.0"
            EOTS_BOTS["erasmus-v1.0"] = v10
        }
    }
}
