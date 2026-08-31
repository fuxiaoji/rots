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
		rows.slice(-20).forEach(function (row) {
			var trace = row.trace
			var item = document.createElement("p")
			item.textContent = `#${row.replay_id} ${eots_t(row.role)} · ${trace.chart}/${trace.node} · ${trace.explanation} 动作：${trace.action}${trace.argument === undefined ? "" : " → " + trace.argument}`
			if (trace.fallback) item.className = "error"
			panel.appendChild(item)
		})
	} catch (_) { /* Trace is auxiliary; game rendering must remain available. */ }
}

document.addEventListener("DOMContentLoaded", function () {
	eots_refresh_ai_trace()
	setInterval(eots_refresh_ai_trace, 2000)
})
