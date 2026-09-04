function eots_apply_static_locale() {
	document.documentElement.lang = eots_language()
	document.querySelectorAll("[data-i18n]").forEach(function (element) {
		var key = element.dataset.i18n
		var translated = eots_t(key)
		if (element.textContent !== translated) element.textContent = translated
	})
	var selector = document.getElementById("eots_language")
	if (selector) selector.value = eots_language()
	var wrap = document.getElementById("mapwrap")
	if (wrap) wrap.classList.toggle("cn-map", eots_language() === "zh-CN")
	document.querySelectorAll("#roles .role_name span, #status").forEach(function (element) {
		if (!element.dataset.en || element.textContent !== eots_t(element.dataset.en)) element.dataset.en = element.textContent
		var translated = eots_t(element.dataset.en)
		if (element.textContent !== translated) element.textContent = translated
	})
}

function eots_set_language(language) {
	language = language === "en-US" ? "en-US" : "zh-CN"
	localStorage.setItem(EOTS_LANGUAGE_KEY, language)
	if (window.UI_LOCALE && typeof window.UI_LOCALE.set_language === "function") window.UI_LOCALE.set_language(language)
	eots_apply_static_locale()
	if (typeof on_update === "function" && typeof view !== "undefined") on_update()
}

document.addEventListener("DOMContentLoaded", function () {
	eots_apply_static_locale()
	new MutationObserver(eots_apply_static_locale).observe(document.body, { childList: true, subtree: true, characterData: true })
})

var eots_last_trace_replay = 0

function eots_ai_phase_label(phase) {
	var labels = {
		early: "早期阶段", mid: "中期阶段", late: "终局阶段", all: "全阶段",
		"card-selection": "卡牌选择", "task-force": "任务部队编成",
		reaction: "反应", pbm: "战后移动", general: "通用行动",
	}
	return labels[phase] || phase || "未知"
}

function eots_ai_window_from_chart(chart) {
	var match = String(chart || "").match(/-(\d\d)$/)
	var page = match ? Number(match[1]) : 0
	if ([1, 2, 3, 7, 8, 9].includes(page)) return "战略决策轴"
	if ([4, 10].includes(page)) return "卡牌选择"
	if ([5, 11].includes(page)) return "任务部队编成"
	if ([6, 12].includes(page)) return "反应 / 战后移动"
	return "通用行动"
}

function eots_ai_text(parent, className, text) {
	var node = document.createElement("div")
	if (className) node.className = className
	node.textContent = text
	parent.appendChild(node)
	return node
}

function eots_render_ai_current(panel, row) {
	var trace = row.trace || {}
	var sm = trace.sm || {}
	var diag = sm.diag || {}
	var targets = Array.isArray(sm.priorityTargets) ? sm.priorityTargets : []
	var pending = targets.filter(function (target) { return !target.achieved })
	var current = pending[0] || targets[0]
	var card = document.createElement("section")
	card.className = "ai_trace_current"
	eots_ai_text(card, "ai_trace_title", `当前 AI 决策 · #${row.replay_id}`)
	var grid = document.createElement("div")
	grid.className = "ai_trace_grid"
	function field(label, value, className) {
		var item = document.createElement("div")
		item.className = "ai_trace_field" + (className ? " " + className : "")
		eots_ai_text(item, "ai_trace_label", label)
		eots_ai_text(item, "ai_trace_value", value === undefined || value === null || value === "" ? "—" : String(value))
		grid.appendChild(item)
	}
	field("阵营", eots_t(row.role))
	field("回合", diag.turn)
	field("战略阶段", eots_ai_phase_label(sm.phase || trace.phase))
	field("当前窗口", trace.windowKind || sm.windowKind ? eots_ai_phase_label(trace.windowKind || sm.windowKind) : eots_ai_window_from_chart(trace.chart))
	field("选定战略", sm.strategy || trace.axis || trace.strategy, "ai_trace_strategy")
	field("正在执行", `${trace.action || "—"}${trace.argument === undefined ? "" : " → " + trace.argument}`)
	field("当前首要目标", current ? `${current.name || current.id || "Hex " + current.hex}${current.id ? "（" + current.id + "）" : ""}` : "本战略没有地图目标", "ai_trace_focus")
	field("图表节点", `${trace.chart || "—"} / ${trace.node || "—"}`)
	card.appendChild(grid)

	var targetBox = document.createElement("div")
	targetBox.className = "ai_trace_targets"
	eots_ai_text(targetBox, "ai_trace_subtitle", "战略目标优先级（未完成目标在前）")
	if (!targets.length) {
		eots_ai_text(targetBox, "ai_trace_empty", "该战略没有地点目标，按事件或规则条件执行。")
	} else {
		var list = document.createElement("ol")
		targets.slice().sort(function (a, b) {
			return Number(a.achieved) - Number(b.achieved) || (a.priority || 999) - (b.priority || 999)
		}).slice(0, 12).forEach(function (target, index) {
			var item = document.createElement("li")
			if (target.achieved) item.className = "achieved"
			if (!target.achieved && index === 0) item.className = "current"
			var flags = []
			if (!target.achieved && index === 0) flags.push("当前首位")
			if (target.achieved) flags.push("已完成")
			if (target.resource) flags.push("资源格")
			if (target.controlledBy) flags.push(`控制：${eots_t(target.controlledBy)}`)
			if (target.distanceToTokyo !== undefined) flags.push(`距东京 ${target.distanceToTokyo} 格`)
			item.textContent = `${target.priority || index + 1}. ${target.name || target.id || "Hex " + target.hex}${target.id ? " [" + target.id + "]" : ""}${flags.length ? " · " + flags.join(" · ") : ""}`
			list.appendChild(item)
		})
		targetBox.appendChild(list)
	}
	card.appendChild(targetBox)
	panel.appendChild(card)
}

async function eots_refresh_ai_trace() {
	var panel = document.getElementById("ai_trace")
	if (!panel) return
	var gameId = new URLSearchParams(location.search).get("game")
	if (!gameId) return
	try {
		var response = await fetch(`/api/ai-trace/${encodeURIComponent(gameId)}`)
		if (!response.ok) return
		var rows = await response.json()
		if (!rows.length || rows[rows.length - 1].replay_id === eots_last_trace_replay) return
		eots_last_trace_replay = rows[rows.length - 1].replay_id
		panel.replaceChildren()
		eots_render_ai_current(panel, rows[rows.length - 1])
		var history = document.createElement("details")
		history.className = "ai_trace_history"
		var summary = document.createElement("summary")
		summary.textContent = "最近 20 步决策记录"
		history.appendChild(summary)
		rows.slice(-20).forEach(function (row) {
			var trace = row.trace
			var item = document.createElement("p")
			var sm = trace.sm || {}
			item.textContent = `#${row.replay_id} ${eots_t(row.role)} · ${eots_ai_phase_label(sm.phase || trace.phase)} · ${sm.strategy || trace.axis || trace.strategy || "未标明战略"} · ${trace.chart}/${trace.node} · 动作：${trace.action}${trace.argument === undefined ? "" : " → " + trace.argument}`
			item.title = trace.explanation || ""
			if (trace.fallback) item.className = "error"
			history.appendChild(item)
		})
		panel.appendChild(history)
	} catch (_) { /* Trace is auxiliary; game rendering must remain available. */ }
}

document.addEventListener("DOMContentLoaded", function () {
	eots_refresh_ai_trace()
	setInterval(eots_refresh_ai_trace, 2000)
})
