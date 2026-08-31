// ui_locale.js — EOTS 界面中文化（按钮 / 提示 / 菜单 / 日志）
// 映射方法：不改动 play.js / rules.js / world.js / client.js 源码，
// 通过包装原渲染函数 + DOM 静态文本替换实现。
// 与 locale.js（卡牌/算子/地名）完全独立。默认中文，可在设置菜单切换回英文。
// 本文件用于 eots_rtt-master（新版 js/* 编译结构）：其 on_log 带 i 参数，包装时需透传全部参数。
(function () {
    "use strict"

    var KEY = "eots.language"
    // 默认中文；localStorage 存 "0" 时切回英文（与地图美工切换逻辑一致）
    var is_zh = localStorage.getItem(KEY) !== "en-US"

    // ============ 翻译表：英文原文本 → 中文（依据 EOTS V3.2 中文规则术语） ============
    var UI_MAP = {
        /* ---- 按钮 ---- */
        "Play card": "打出卡牌",
        "Rebuild unit": "重建单位",
        "Roll": "掷骰",
        "Prompt": "提示",
        "Continue": "继续",
        "Use Bonus": "使用修正",
        "Play Event": "触发事件",
        "Play for Operations": "打出为作战点",
        "Hold": "保留",
        "Advanced move": "拓展移动",
        "No move": "不移动",
        "Eliminate": "消灭",
        "Stop": "停止",
        "Displace": "撤离",
        "Reduce divisions track": "降低师级编制",
        "HQ Withdrawal": "司令部撤退",
        "Early HQ Return": "提前返回HQ",
        "Remove Inter-Service Rivalry": "消除内部军种对立",
        "China Offensive": "中国攻势",
        "Future Offensive": "未来攻势",
        "Build Jarhat Road": "修筑贾尔哈德公路",
        "Build Imphal Road": "修筑英帕尔公路",
        "Build Ledo Road": "修筑利多公路",
        "Discard": "弃牌",
        "Choose all": "全选",
        "Pass": "过",
        "Skip": "跳过",
        "Range": "航程",
        "Next": "下一步",
        "Done": "完成",
        "Delay": "延迟",
        "Disable organic": "禁用建制",
        "Avoid ZOI": "避开影响区",
        "Strategic": "战略移动",
        "Amphibious": "两栖突击",
        "Ground": "地面移动",
        "Extended range": "延长航程",
        "Barges": "驳船",
        "Redo": "重做",
        "Undo": "撤销",
        "Review Proposal": "查看回滚提议",

        /* ---- 顶栏菜单 ---- */
        "Default road markers": "默认道路标记",
        "Hide unit path": "隐藏移动路径",
        "Vassal like control": "类Vassal控制",
        "Hide ZOI": "隐藏影响区",
        "Read me!": "说明",
        "Rules": "规则",
        "Charts": "图表",
        "Allied Deck": "盟国牌库",
        "Japanese Deck": "日本牌库",
        "Inspect Japanese Cards": "查看日本卡牌",
        "Inspect Allied Cards": "查看盟国卡牌",
        "Inspect Political Status": "查看国家状态",
        "Inspect Victory Points": "查看胜利点",
        "Inspect Eliminated Units": "查看被消灭单位",
        "Check Unit Supply": "查看单位补给",
        "Check Distance": "查看距离",
        "Load full log": "载入完整日志",

        /* ---- 对话框标题 ---- */
        "Allied Event Cards": "盟国事件卡",
        "Japanese Event Cards": "日本事件卡",
        "Victory Points": "胜利点",
        "Eliminated Units": "被消灭单位",
        "Political Status": "国家状态",
        "Battle info": "战斗信息",

        /* ---- 面板标题 ---- */
        "Current offensive": "当前攻势",
        "Japan Hand": "日本手牌",
        "Allied Hand": "盟国手牌",

        /* ---- 阵营 / 侧边栏 ---- */
        "Japan": "日本",
        "Allies": "盟军",
        "Pass": "过",

        /* ---- 常见游戏提示（prompt） ---- */
        "Select card to play.": "选择要打出的卡牌。",
        "Play future offensive card or pass.": "打出未来攻势卡或过。",
        "Select action.": "选择行动。",
        "Select battle hexes.": "选择战斗格。",
        "Assign hits.": "分配命中。",
        "Select units to activate.": "选择要启动的单位。",
        "Select a card to discard.": "选择要弃掉的卡牌。",
        "Roll for attrition.": "掷耗损骰。",
        "Select a unit to eliminate.": "选择要消灭的单位。",
        "Select a unit to displace.": "选择要撤离的单位。",
        "Select a unit to rebuild.": "选择要重建的单位。",
        "Choose a HQ.": "选择司令部。",
        "Select an action hex.": "选择行动格。",
        "Move units.": "移动单位。",
        "Select units.": "选择单位。",
        "Select target hex.": "选择目标格。",
        "Select a card to play for operations.": "选择要打出为作战点的卡牌。",
        "Select a card to play as an event.": "选择要触发事件的卡牌。",
        "Place reinforcements.": "放置增援。",
        "Use replacements.": "使用补员。",
        "Select a unit to replace.": "选择要补员的单位。",
        "Select a card to hold.": "选择要保留的卡牌。",
        "Select a card to play for the future offensive.": "选择要打出为未来攻势的卡牌。",
        "Confirm China Offensive.": "确认中国攻势。",
        "Select a battle.": "选择战斗。",
        "Choose a battle hex.": "选择战斗格。",
        "Assign units to attack.": "分配攻击单位。",
        "Check stacking.": "检查堆叠。",
        "Choose disengagement.": "选择脱离战斗。",
        "Declare battle hexes.": "声明战斗格。",
        "Roll to strategic bombing.": "掷战略轰炸骰。",
        "Roll for submarine warfare.": "掷潜艇战骰。",
        "Roll for attrition.": "掷耗损骰。",
        "Select hexes for supply.": "选择补给格。",
    }

    // ============ 日志术语表：只保留高质量长短语（\b 边界，不区分大小写） ============
    // 注意：不做单双词替换（如 to/at），避免产生"中英混合垃圾"；未命中的日志保持英文原文
    var TERM_LIST = [
        ["played as an Event", "触发事件"],
        ["played as a Event", "触发事件"],
        ["played for", "打出为"],
        ["played", "打出"],
        ["advanced to", "推进至"],
        ["moved to", "移动至"],
        ["withdrew to", "撤退至"],
        ["advance", "推进"],
        ["strategic movement", "战略移动"],
        ["amphibious invasion", "两栖突击"],
        ["ground movement", "地面移动"],
        ["extended range", "延长航程"],
        ["activated", "启动"],
        ["attacks", "攻击"],
        ["attacked", "被攻击"],
        ["rolled", "掷出"],
        ["rolls", "掷出"],
        ["roll for", "掷骰："],
        ["eliminated", "被消灭"],
        ["reduced", "损毁"],
        ["rebuilt", "重建"],
        ["displaced", "撤离"],
        ["discarded", "弃掉"],
        ["recruited", "增援"],
        ["reinforce", "增援"],
        ["delayed", "延迟"],
        ["withdrawn", "撤退"],
        ["reinforcements", "增援"],
        ["replacement", "补员"],
        ["attrition", "耗损"],
        ["bombing", "轰炸"],
        ["submarine", "潜艇"],
        ["offensive", "攻势"],
        ["operations", "作战点"],
        ["turn", "回合"],
        ["waiting for", "等待"],
        ["select card to play", "选择要打出的卡牌"],
        ["select action", "选择行动"],
        ["place reinforcements", "放置增援"],
        ["assign hits", "分配命中"],
        ["emergency move", "紧急移动"],
        ["japan", "日本"],
        ["allied", "盟国"],
        ["allies", "盟国"],
    ]

    // ============ 动态提示模板（完整模板正则 → 中文，含变量回填 %s） ============
    // 原则：整串匹配，未命中保持英文原文；绝不词级替换
    var PROMPT_PATTERNS = [
        ["India surrenders\\. Choose unit to emergency move\\.", "印度投降。选择单位进行紧急移动。"],
        ["India surrenders\\. Confirm emergency move\\.", "印度投降。确认紧急移动。"],
        ["Hold Arcadia or discard and replace with random card\\.", "保留阿卡迪亚或弃掉，并随机补充一张卡牌。"],
        ["Discard one card to draw JP 47: VADM Kondo or pass\\.", "弃一张牌以抽取 JP47：近藤信竹，或过。"],
        ["Play Arcadia or pass\\.", "打出阿卡迪亚或过。"],
        ["Choose units that wll conduct strategic bombing\\.", "选择进行战略轰炸的单位。"],
        ["No strategic bombing this turn\\.", "本回合不进行战略轰炸。"],
        ["Roll for submarine warfare\\.", "掷潜艇战骰。"],
        ["Play future offensive card or pass\\.", "打出未来攻势卡或过。"],
        ["Choose unit to emergency move\\.", "选择单位进行紧急移动。"],
        ["Confirm emergency move\\.", "确认紧急移动。"],
        ["Choose unit and hex\\.", "选择单位与格。"],
        ["China Offensive Roll\\.", "中国攻势掷骰。"],
        ["Choose HQ to displace\\.", "选择要撤离的司令部。"],
        ["Choose returning HQ\\.", "选择要返回的司令部。"],
        ["Remove overstacked units\\.", "移除超堆叠单位。"],
        ["Place reinforcements\\. \\(Done\\)\\.", "放置增援。（完成）。"],
        ["Choose card to draw\\.", "选择要抽取的卡牌。"],
        ["Choose card to discard\\.", "选择要弃掉的卡牌。"],
        ["Choose unit to repair\\.", "选择要修复的单位。"],
        ["Choose unit to damage\\.", "选择要损伤的单位。"],
        ["Choose unit to flip\\.", "选择要翻转的单位。"],
        ["Confirm retreat\\.", "确认撤退。"],
        ["Choose unit to retreat\\.", "选择要撤退的单位。"],
        ["Choose space to move\\.", "选择移动的格。"],
        ["Choose battle hex\\.", "选择战斗格。"],
        ["End action\\.", "结束行动。"],
        ["Move units\\.", "移动单位。"],
        ["Assign hits\\. \\(One step should survive\\)\\.", "分配命中。（应保留一个军力面）。"],
        ["Turn (\\d+) Select card to play\\.", "回合 %s：选择要打出的卡牌。"],
        ["(.*): Select action\\.", "%s：选择行动。"],
        ["Choose hex to place (.*)\\.", "选择放置 %s 的格。"],
        ["Choose unit to reinforce (.*)\\.", "选择增援 %s 的单位。"],
        ["Choose (.*) as a reinforcement\\.", "选择 %s 作为增援。"],
        ["Choose units to damage\\. Chosen: (.*)", "选择要损伤的单位。已选：%s"],
        ["Choose units to repair\\. Chosen: (.*)", "选择要修复的单位。已选：%s"],
        ["Submarine attack\\. Apply hits: (.*)\\.", "潜艇攻击。应用命中：%s。"],
        ["Yamato run\\. Reduce one step\\.", "大和特攻。降低一个军力面。"],
        ["India surrenders\\. Choose space to move\\.", "印度投降。选择移动的格。"],
        ["Apply attrition for not-supplied units", "对未补给单位应用耗损。"],
        ["Coastal artillery and mines\\. Reduce one naval unit\\.", "海岸炮和水雷。降低一个海军单位。"],
        ["Choose airfield bombardment target\\.", "选择机场轰炸目标。"],
        ["Place Tokyo Express marker\\.", "放置东京快车标记。"],
        ["Discard pile is empty, could not replace card\\.", "弃牌堆为空，无法替换卡牌。"],
        ["Have no card to discard, could not replace card\\.", "没有卡牌可弃，无法替换卡牌。"],
        ["Choose coastal hex\\.", "选择海岸格。"],
        ["No kamikaze attack possible\\. No air units\\.", "无法神风特攻。没有空中单位。"],
        ["Kamikaze attack\\. Choose air unit\\.", "神风特攻。选择空中单位。"],
        ["Kamikaze attack\\. Choose target\\. Hits: (.*)\\.", "神风特攻。选择目标。命中：%s。"],
        ["Choose paratroopers landing hex\\.", "选择伞兵着陆格。"],
        ["No B-29 base attacked\\.", "没有 B-29 基地被攻击。"],
        ["Attack to B-29 base\\. Choose unit\\.", "攻击 B-29 基地。选择单位。"],
        ["Move units\\. Units could be selected: (.*)\\.", "移动单位。可选择的单位：%s。"],
        ["Choose unit to cancel\\.", "选择要取消的单位。"],
        ["CBI could not be built\\.", "无法修筑 CBI。"],
        ["Choose hex to build CBI\\.", "选择修筑 CBI 的格。"],
        ["Play Operation Z\\.", "打出 Z 作战。"],
        ["Move activated units\\.", "移动已启动单位。"],
        ["Play Operation No\\. 1\\.", "打出 1 号作战。"],
        ["Choose Military Event to use as Future Offensive\\.", "选择要用作未来攻势的军事事件。"],
        ["Confirm (.*) as Future Offensive\\?", "确认 %s 作为未来攻势？"],
        ["Choose hex for post battle movement\\.", "选择战后移动的格。"],
        ["The Great Marianas Turkey Shoot\\. Choose unit to hit\\.", "马里亚纳火鸡大猎杀。选择要攻击的单位。"],
        ["Bonus could not be used\\.", "无法使用修正。"],
        ["ABDA HQ could not be placed\\.", "无法放置 ABDA 司令部。"],
        ["Choose unit to reaction\\.", "选择要反应的单位。"],
        ["Choose hex to reaction\\.", "选择反应的格。"],
        ["Choose unit to hit\\.", "选择要攻击的单位。"],
    ]

    // ============ 日志完整模板（正则 → 中文，含变量回填 %s） ============
    // 原则：整行匹配（自动剥离日志前缀如 !/@/#J），未命中保持英文原文；不做词级替换
    var LOG_PATTERNS = [
        /* 静态 */
        ["No progress of war required\\.", "无需战争进展要求。"],
        ["AP chooses Arcadia \\+4 random cards\\.", "盟国选择阿卡迪亚会议，+4 张随机卡牌。"],
        ["AP chooses 5 random cards\\.", "盟国选择 5 张随机卡牌。"],
        ["No possible reinforcements\\.", "没有可用的增援。"],
        ["No units activated\\.", "没有单位被启动。"],
        ["No battle hexes declared\\.", "没有声明战斗格。"],
        ["No units assigned to strategic bombing\\.", "没有分配战略轰炸单位。"],
        ["Strategic bombing not possible\\.", "战略轰炸不可行。"],
        ["JP started China offensive\\.", "日本发动中国攻势。"],
        ["China surrenders!", "中国投降！"],
        ["Amphibious Assault failed due to lack of naval escort\\.", "由于缺乏海军护航，两栖突击失败。"],
        ["No retreat possible\\.", "无法撤退。"],
        ["Offensive interrupted due to disengagement\\.", "攻势因脱离战斗而中断。"],
        ["Japanese naval aircraft range advantage:", "日本海军飞机航程优势："],
        ["AP captured Marshall islands\\.", "盟国占领马绍尔群岛。"],
        ["India returned to stable\\.", "印度恢复稳定。"],
        ["Diverted Logistics:", "转移物流："],
        ["Tokyo express marker removed\\.", "移除东京快车标记。"],
        ["Escort reduced to \\+2\\.", "护航减至 +2。"],
        ["Escort reduced to 0\\.", "护航减至 0。"],
        ["Air Naval combat:", "空海军战斗："],
        ["Ground combat:", "地面战斗："],
        ["AP submarine warfare:", "盟国潜艇战："],
        ["War in europe prevent from AP amphibious shipping reinforcement\\.", "欧洲战事阻止盟国两栖运输增援。"],
        ["AP reinforcements delayed due to Panama canal attack\\.", "巴拿马运河袭击导致盟国增援延迟。"],
        ["AP reinforcements delayed\\.", "盟国增援延迟。"],
        ["Progress of war target - (.*)\\.", "战争进展目标 - %s。"],
        ["Sent to Europe roll:", "派往欧洲掷骰："],
        ["No hq could be selected\\.", "没有可选择的司令部。"],
        ["Barges ability used\\.", "使用驳船能力。"],
        ["Organic transport used\\. (.*) carry (.*)", "使用建制运输。%s 运载 %s。"],
        ["Special reaction in (.*):", "%s 中的特殊反应："],
        ["No possible units\\.", "没有可用的单位。"],
        ["(.*) discarded\\.", "%s 弃掉。"],
        ["AP draw reduced by 1 due to China's surrender\\.", "中国投降使盟国少抽 1 张。"],
        ["AP draw reduced by 1 due to India's surrender\\.", "印度投降使盟国少抽 1 张。"],
        ["AP draw reduced by 1 due to Australia's surrender\\.", "澳大利亚投降使盟国少抽 1 张。"],
        ["AP draw reduced by 1 due to War in Europe at Level 4\\.", "欧洲战事达 4 级使盟国少抽 1 张。"],
        ["JP use strategic reserves \\((.*) cards\\)\\.", "日本使用战略储备（%s 张卡牌）。"],
        ["Strategic warfare reduces JP draw to (.*) \\(-(.*)\\)\\.", "战略战使日本抽牌减至 %s（-%s）。"],
        ["JP resources - (.*) \\((.*) cards\\)\\.", "日本资源 - %s（%s 张卡牌）。"],
        /* 战斗修正 */
        ["\\+2 Attacker Air support\\.", "+2 攻击方空中支援。"],
        ["\\+2 Attacker Naval support\\.", "+2 攻击方海军支援。"],
        ["\\-1 Jungle\\.", "-1 丛林。"],
        ["\\-2 Mixed terrain\\.", "-2 混合地形。"],
        ["\\-3 Mountains\\.", "-3 山地。"],
        ["\\+3 Amphibious assault\\.", "+3 两栖突击。"],
        ["\\+1 Armor brigade\\.", "+1 装甲旅。"],
        ["\\+1 Defensive doctrine\\.", "+1 防御教义。"],
        ["\\+4 Ambush\\.", "+4 伏击。"],
        ["\\+3 Surprise attack\\.", "+3 奇袭。"],
        ["\\+1 Defective torpedoes \\(1942\\)\\.", "+1 故障鱼雷（1942）。"],
        ["\\+1 High altitude interceptors\\.", "+1 高空拦截机。"],
        ["\\+4 Col\\.Tsuji\\.", "+4 辻政信。"],
        ["\\-1 activation \\(US Line of Communication\\)\\.", "-1 启动（美国交通线）。"],
        ["([+\\-])1 activation \\(Bridge over the River Kwai\\)\\.", "%s1 启动（桂河大桥）。"],
        /* 出牌 / 弃牌 / 过 */
        ["(.*) played as event\\.", "%s 作为事件打出。"],
        ["(.*) played\\.", "%s 打出。"],
        ["(.*) played as operation card\\.", "%s 作为作战卡打出。"],
        ["(.*) played for Chinese Offensive\\.", "%s 打出用于中国攻势。"],
        ["(.*) played for withdraw HQ\\.", "%s 打出用于司令部撤退。"],
        ["(.*) played for return HQ\\.", "%s 打出用于返回司令部。"],
        ["(.*) played future offensive card\\.", "%s 打出未来攻势卡。"],
        ["(.*) played FO card\\.", "%s 打出未来攻势卡。"],
        ["(.*) discards (.*)\\.", "%s 弃掉 %s。"],
        ["(.*) pass\\.", "%s 过。"],
        ["Pass used, (.*) remains\\.", "使用过，剩余 %s 次。"],
        /* 移动 / 占领 / 放置 */
        ["(.*) moved to (.*)\\.", "%s 移动至 %s。"],
        ["(.*) placed to (.*)\\.", "%s 放置至 %s。"],
        ["(.*) captured (.*)\\.", "%s 占领 %s。"],
        ["(.*) retreat to (.*)\\.", "%s 撤退至 %s。"],
        ["(.*) flipped to full size\\.", "%s 翻转至满编。"],
        ["(.*) voluntary delayed to next turn\\.", "%s 自愿延迟至下一回合。"],
        ["(.*) activated for (.*)\\.", "%s 启动用于 %s。"],
        ["(.*) assigned to attack to (.*)\\.", "%s 分配攻击 %s。"],
        ["(.*) skipped move\\.", "%s 跳过移动。"],
        /* 战斗 */
        ["(.*) fire \\((.*)\\)\\.", "%s 开火（%s）。"],
        ["(.*) won in ground combat (.*)\\.", "%s 在地面战斗中获胜 %s。"],
        ["(.*) could not participate ground combat\\.", "%s 无法参加地面战斗。"],
        ["Battle hex (.*) declared in (.*)\\.", "战斗格 %s 声明于 %s。"],
        /* 状态 / 政治 / 抽牌 */
        ["(.*) controlled (.*)\\.", "%s 控制 %s。"],
        ["(.*) status changed to (.*)\\.", "%s 状态变为 %s。"],
        ["Political will changed to (.*) \\((.*)\\) - (.*)\\.", "政治意志变为 %s（%s） - %s。"],
        ["AP draw (.*) cards\\.", "盟国抽 %s 张卡牌。"],
        ["JP receive (.*) cards\\.", "日本获得 %s 张卡牌。"],
        ["AP receive (.*) passes\\.", "盟国获得 %s 次过。"],
        ["JP receive (.*) passes\\.", "日本获得 %s 次过。"],
        ["AP draw reduced by 1 due to (.*)\\.", "盟国少抽 1 张，因为 %s。"],
        ["(.*) has drawn 3 cards already, draw skipped\\.", "%s 已抽 3 张，跳过抽牌。"],
        ["(.*) draw additional card\\.", "%s 额外抽一张。"],
        ["(.*) hand is empty, could not discard random card\\.", "%s 手牌为空，无法弃随机卡牌。"],
        /* 回合标题 */
        ["Turn (\\d+) - (.*)", "第 %s 回合 - %s"],
        ["Turn (\\d+)", "第 %s 回合"],
    ]

    // ============ 侧边栏手牌状态专用翻译 ============
    function t_stat(text) {
        if (!is_zh || typeof text !== "string") return text
        if (Object.prototype.hasOwnProperty.call(UI_MAP, text)) return UI_MAP[text]
        return text
            .replace(/(\d+) cards/, "$1 张卡牌")
            .replace(/(\d+) passes/, "$1 次过")
            .replace(/\+ FO/, "+ 未来攻势")
    }

    // ============ 翻译函数 ============
    function t(text) {
        if (!is_zh || text === undefined || text === null) return text
        if (Object.prototype.hasOwnProperty.call(UI_MAP, text)) return UI_MAP[text]
        return text
    }

    // 长短语替换（仅用于模板变量回填，处理变量中残留的英文动词/名词）
    function term_replace(text) {
        if (typeof text !== "string") return text
        var s = text
        for (var i = 0; i < TERM_LIST.length; i++) {
            var word = TERM_LIST[i][0]
            var re = new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi")
            s = s.replace(re, TERM_LIST[i][1])
        }
        return s
    }

    // 日志：剥离前缀 → 整串/完整模板匹配 → 未命中保持英文原文（绝不词级替换）
    function t_log(text) {
        if (!is_zh || typeof text !== "string") return text
        var m = text.match(/^([!@$>]|#[JAI]|%[JA]|&[JA]|Q)(.*)$/)
        var prefix = m ? m[1] : ""
        var body = m ? m[2] : text
        if (Object.prototype.hasOwnProperty.call(UI_MAP, body)) {
            body = UI_MAP[body]
        } else {
            var matched = false
            for (var i = 0; i < LOG_PATTERNS.length; i++) {
                var mm = new RegExp("^" + LOG_PATTERNS[i][0] + "$").exec(body)
                if (mm) {
                    var cn = LOG_PATTERNS[i][1]
                    for (var j = 1; j < mm.length; j++) {
                        cn = cn.replace("%s", function () { return term_replace(mm[j]) })
                    }
                    body = cn
                    matched = true
                    break
                }
            }
            if (!matched) return text
        }
        return prefix + body
    }

    // 动态提示：先整串精确匹配，再按完整模板正则匹配（含变量回填），未命中保持英文原文
    function t_prompt(text) {
        if (!is_zh || typeof text !== "string") return text
        if (Object.prototype.hasOwnProperty.call(UI_MAP, text)) return UI_MAP[text]
        for (var i = 0; i < PROMPT_PATTERNS.length; i++) {
            var m = new RegExp("^" + PROMPT_PATTERNS[i][0] + "$").exec(text)
            if (m) {
                var cn = PROMPT_PATTERNS[i][1]
                for (var j = 1; j < m.length; j++) {
                    var val = m[j]
                    // 回填前对变量做长短语翻译（处理残留英文动词/名词），并防 $& 特殊替换
                    cn = cn.replace("%s", function () { return term_replace(val) })
                }
                return cn
            }
        }
        return text
    }

    // ============ 挂钩 1：按钮（client.js 的 action_button_imp） ============
    var orig_abi = window.action_button_imp
    if (typeof orig_abi === "function") {
        window.action_button_imp = function (action, label, callback) {
            return orig_abi(action, t(label), callback)
        }
    }

    // ============ 挂钩 2：动态提示（EOTS play.js 的 on_prompt） ============
    var orig_op = window.on_prompt
    if (typeof orig_op === "function") {
        window.on_prompt = function (text) {
            return orig_op(t_prompt(text))
        }
    }

    // ============ 挂钩 4：侧边栏角色名（client.js 的 init_role_element） ============
    var orig_ire = window.init_role_element
    if (typeof orig_ire === "function") {
        window.init_role_element = function (role_id, role_name) {
            var el = orig_ire(role_id, t(role_name))
            var span = el && el.querySelector(".role_name span")
            if (span) {
                span.dataset.en = role_name  // 保留英文原文供切换恢复
                span.textContent = t(role_name)
            }
            return el
        }
    }

    // ============ 挂钩 5：侧边栏手牌状态（EOTS play.js 的 update_role_info） ============
    var orig_uri = window.update_role_info
    if (typeof orig_uri === "function") {
        window.update_role_info = function () {
            orig_uri()
            if (is_zh && window.roles) {
                for (var i = 0; i < window.roles.length; i++) {
                    var r = window.roles[i]
                    if (r && r.stat) r.stat.innerHTML = t_stat(String(r.stat.textContent))
                }
            }
        }
    }

    // ============ 挂钩 3：日志（EOTS play.js 的 on_log） ============
    var orig_ol = window.on_log
    if (typeof orig_ol === "function") {
        window.on_log = function () {
            var args = Array.prototype.slice.call(arguments)
            var text = args[0]
            if (typeof text === "string" && text.charAt(0) === "Q") {
                // "Q" 前缀：卡牌说明文本（data 层已汉化），不做术语替换
                return orig_ol.apply(null, args)
            }
            args[0] = t_log(text)
            return orig_ol.apply(null, args)
        }
    }

    // ============ 静态文本替换（菜单 / 对话框标题 / 面板标题） ============
    function zh_text(el) {
        var orig = el.dataset.en
        if (orig === undefined) {
            orig = el.textContent.trim()
            el.dataset.en = orig
        }
        var text = is_zh ? t(orig) : orig
        if (el.childElementCount > 0) {
            // 保留子元素（如 checkbox input），只更新纯文本节点
            var found = false
            for (var i = 0; i < el.childNodes.length; i++) {
                var node = el.childNodes[i]
                if (node.nodeType === 3 && node.textContent.trim() !== "") {
                    node.textContent = text
                    found = true
                    break
                }
            }
            if (!found) el.appendChild(document.createTextNode(text))
        } else {
            el.textContent = text
        }
    }

    function apply_static() {
        document.querySelectorAll(".dialog_header, .panel-head, dialog h3, dialog p, dialog label, dialog button, .role_name span")
            .forEach(zh_text)
        // 菜单项：可能含 div/a/label 子元素（保留 input/a 结构），只翻译文本容器
        document.querySelectorAll("#toolbar menu li").forEach(function (li) {
            var target = li.querySelector("div, a, label")
            if (target) zh_text(target)
            else zh_text(li)
        })
        document.querySelectorAll("#toolbar menu > a").forEach(zh_text)
        // 中文界面切换项
        var cb = document.getElementById("ui_zh_checkbox")
        if (cb) cb.checked = is_zh
    }

    // ============ 语言切换 ============
    document.addEventListener("DOMContentLoaded", function () {
        apply_static()
        var cb = document.getElementById("ui_zh_checkbox")
        if (cb) {
            cb.addEventListener("change", function () {
                is_zh = cb.checked
                localStorage.setItem(KEY, is_zh ? "zh-CN" : "en-US")
                apply_static()
                // 重新渲染按钮 / 提示（日志历史不重渲）
                if (typeof on_update === "function") on_update()
            })
        }
    })

    // 暴露给调试
    window.UI_LOCALE = {
        t: t, t_log: t_log, t_prompt: t_prompt, t_stat: t_stat,
        is_zh: function () { return is_zh },
        set_language: function (language) {
            is_zh = language !== "en-US"
            apply_static()
        }
    }

    // ============ 地图美工切换（中文版地图） ============
    // 新模块 play.css 默认只引用英文地图；通过给 #mapwrap 加 v2 类切到 cnmap_* 中文地图。
    function update_map_art_button() {
        var btn = document.getElementById("map_art_button")
        if (!btn) return
        var wrap = document.getElementById("mapwrap")
        var v2 = wrap && wrap.classList.contains("v2")
        btn.classList.toggle("active", v2)
        btn.title = v2 ? "当前：中文版地图（点击切换原版）" : "当前：原版地图（点击切换中文版）"
    }

    window.toggle_map_art = function () {
        var wrap = document.getElementById("mapwrap")
        if (!wrap) return
        var v2 = wrap.classList.toggle("v2")
        localStorage.setItem("eots_map_art", v2 ? "cn" : "en")
        update_map_art_button()
    }

    // 默认中文版地图；localStorage 存 "en" 时切回原版（与语言切换的偏好逻辑一致）
    if (localStorage.getItem("eots_map_art") !== "en") {
        document.addEventListener("DOMContentLoaded", function () {
            var wrap = document.getElementById("mapwrap")
            if (wrap) wrap.classList.add("v2")
            update_map_art_button()
        })
    } else {
        document.addEventListener("DOMContentLoaded", update_map_art_button)
    }
})()
