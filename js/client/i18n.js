function eots_apply_static_locale() {
	document.documentElement.lang = eots_language()
	document.querySelectorAll("[data-i18n]").forEach(function (element) {
		var key = element.dataset.i18n
		element.textContent = eots_t(key)
	})
	var selector = document.getElementById("eots_language")
	if (selector) selector.value = eots_language()
	var wrap = document.getElementById("mapwrap")
	if (wrap) wrap.classList.toggle("cn-map", eots_language() === "zh-CN")
}

function eots_set_language(language) {
	localStorage.setItem(EOTS_LANGUAGE_KEY, language === "en-US" ? "en-US" : "zh-CN")
	eots_apply_static_locale()
	if (typeof on_update === "function" && typeof view !== "undefined") on_update()
}

document.addEventListener("DOMContentLoaded", eots_apply_static_locale)

