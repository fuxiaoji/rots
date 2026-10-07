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
		CAPTURE: "夺占", ASSEMBLE: "运输与集结", GARRISON: "驻守", BLOCKED: "重新规划",
		POW: "补齐战争进展", RESOURCES: "夺取资源", FORWARD_BASE: "夺取前沿基地", HOMELAND: "本州占领",
		ASSEMBLE_ESCORT: "集中护航", B29_DEPLOYMENT: "部署轰炸机", AIR_SUPPORT_BASE: "前推空中支援",
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

function eots_render_ai_current(panel, row, inference) {
	var trace = row.trace || {}
	if (trace.llm) return eots_render_llm_current(panel, row, inference)
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
	field(trace.campaign ? "策略节点" : "图表节点", trace.chart === "CAMPAIGN"
		? `战役规划 / ${eots_ai_phase_label(trace.node)}` : `${trace.chart || "—"} / ${trace.node || "—"}`)
	if (trace.campaign?.pow) {
		var pow = trace.campaign.pow
		field("本回合战争进展", `${pow.held}/${pow.required}，尚缺 ${pow.gap}`)
		field("政治意志", pow.politicalWill)
		field("剩余手牌", pow.remainingCards)
	}
	if (trace.activationPlan) {
		field("激活量使用", `${trace.activationPlan.selected}/${trace.activationPlan.limit}，剩余 ${trace.activationPlan.remaining}；${trace.activationPlan.mode}`)
		field("编队标准", `需求 ${trace.activationPlan.required ?? "—"}，当前 ${trace.activationPlan.strength ?? 0}${trace.activationPlan.potentialReactionStrength ? "，潜在反应 " + trace.activationPlan.potentialReactionStrength : ""}`)
	}
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
			if (target.kind === "SUPPRESS" || target.kind === "SUPPRESS_HQ") flags.push("压制目标（不要求占领）")
			if (target.requiresOccupation) flags.push("夺占目标（需要地面部队）")
			if (target.controlledBy) flags.push(`控制：${eots_t(target.controlledBy)}`)
			if (target.distanceToTokyo !== undefined) flags.push(`距东京 ${target.distanceToTokyo} 格`)
			if (target.objective) flags.unshift(`${eots_ai_phase_label(target.objective)}${target.damageLevel && !target.campaignTask ? " · 伤害标准 " + target.damageLevel + "x" : ""}`)
			item.textContent = `${target.priority || index + 1}. ${target.name || target.id || "Hex " + target.hex}${target.id ? " [" + target.id + "]" : ""}${flags.length ? " · " + flags.join(" · ") : ""}`
			list.appendChild(item)
		})
		targetBox.appendChild(list)
	}
	card.appendChild(targetBox)
	panel.appendChild(card)
}

function eots_render_llm_current(panel, row, inference) {
	var t = row.trace, card = document.createElement("section")
	card.className = "ai_trace_current"
	eots_ai_text(card, "ai_trace_title", `${eots_t(row.role)} · LLM 决策摘要 · #${row.replay_id}`)
	eots_ai_text(card, "ai_trace_value", `${t.model} · 回合 ${t.turn} · ${t.windowKind}`)
	eots_ai_text(card, "ai_trace_subtitle", "选定动作")
	eots_ai_text(card, "ai_trace_value", t.label || t.action)
	if (t.explanation !== undefined) {
		eots_ai_text(card, "ai_trace_label", "创建者专用 · 模型简短说明（不是规则裁定）")
		eots_ai_text(card, "ai_trace_value", t.explanation || "未提供说明")
		eots_ai_text(card, "ai_trace_subtitle", "当前计划（模型记忆，可能失效）")
		eots_ai_text(card, "ai_trace_value", t.objective || "尚无计划")
		;(t.notes || []).forEach(note => eots_ai_text(card, "ai_trace_value", "• " + note))
		if (t.campaign) {
			eots_ai_text(card, "ai_trace_subtitle", "战役目标（模型计划）")
			eots_ai_text(card, "ai_trace_value", t.campaign.objective || "—")
			eots_ai_text(card, "ai_trace_label", t.campaign.victoryBasis || "")
			;(t.campaign.targets || []).forEach((target, index) => eots_ai_text(card, "ai_trace_value", `${index + 1}. 地图 ${typeof int_to_hex === "function" ? int_to_hex(target.hex) : target.hex} · ${target.purpose}`))
		}
		if (t.turnPlan) {
			eots_ai_text(card, "ai_trace_subtitle", `第 ${t.turnPlan.turn} 回合计划`)
			;(t.turnPlan.objectives || []).forEach(goal => eots_ai_text(card, "ai_trace_value", "• " + goal))
			;(t.turnPlan.constraints || []).forEach(limit => eots_ai_text(card, "ai_trace_label", limit))
		}
		if (t.offensive) {
			eots_ai_text(card, "ai_trace_subtitle", "攻势任务（引用已验证，可行性仍需核对）")
			eots_ai_text(card, "ai_trace_value", `${t.offensive.objective || "—"} · 卡 ${t.offensive.cardId || "未定"} · ${t.offensive.mode || "未定"} · HQ ${t.offensive.hqId || "未定"}`)
			;(t.offensive.tasks || []).forEach(task => {
				eots_ai_text(card, "ai_trace_value", `${task.intent} · 地图 ${typeof int_to_hex === "function" ? int_to_hex(task.targetHex) : task.targetHex} · ${task.stage}`)
				eots_ai_text(card, "ai_trace_label", `地面 ${task.ground.join(",") || "无"} / 护航 ${task.escort.join(",") || "无"} / 支援 ${task.support.join(",") || "无"}`)
				eots_ai_text(card, "ai_trace_value", task.nextStep)
			})
			;(t.offensive.stopOrReplan || []).forEach(stop => eots_ai_text(card, "ai_trace_label", "重评条件：" + stop))
		}
		;(t.memoryAssessment?.issues || []).forEach(issue => eots_ai_text(card, "error", issue))
		if (t.recent?.length) {
			eots_ai_text(card, "ai_trace_subtitle", "最近已执行（程序记录）")
			t.recent.slice(-4).forEach(event => eots_ai_text(card, "ai_trace_label", `#${event.revision} ${event.stateBefore} → ${event.stateAfter} · ${event.label}`))
		}
	}
	eots_ai_text(card, "ai_trace_label", t.policy === "forced" ? "唯一合法候选 · 程序执行 · 本步不调用模型" : `本步模型请求 · ${t.latencyMs || 0} ms · ${t.usage?.total_tokens ?? "未知"} tokens`)
	if (t.assisted) eots_ai_text(card, "ai_trace_label", "程序协助编队和合法落点")
	if (t.policy === "forced" && inference?.trace.explanation !== undefined) {
		eots_ai_text(card, "ai_trace_subtitle", `最近一次模型选择 · #${inference.replay_id}`)
		eots_ai_text(card, "ai_trace_value", inference.trace.label + "：" + inference.trace.explanation)
	}
	if (t.stats && t.limits) eots_ai_text(card, "ai_trace_value", `双方累计：请求 ${t.stats.requests}/${t.limits.maxRequests} · 报告 tokens ${t.stats.totalTokens}/${t.limits.maxTotalTokens} · 用量未知 ${t.stats.usageUnknown}`)
	if (t.sources?.length) eots_ai_text(card, "ai_trace_label", "提示提供的资料：" + t.sources.map(s => s.file).join("、") + "（不表示模型实际采用）")
	panel.appendChild(card)
}

async function eots_refresh_ai_trace() {
	var panel = document.getElementById("ai_trace")
	if (!panel) return
	var gameId = new URLSearchParams(location.search).get("game")
	if (!gameId) return
	try {
		var statusResponse = await fetch(`/api/llm-status/${encodeURIComponent(gameId)}`)
		if (statusResponse.ok) {
			var status = await statusResponse.json()
			if (status) {
				var statusNode = document.getElementById("llm_runtime_status")
				if (!statusNode) { statusNode = document.createElement("div"); statusNode.id = "llm_runtime_status"; panel.before(statusNode) }
				statusNode.className = "ai_trace_current"
				statusNode.textContent = `LLM 双方累计：请求 ${status.stats.requests}/${status.limits.maxRequests} · 报告 tokens ${status.stats.totalTokens}/${status.limits.maxTotalTokens} · 用量未知 ${status.stats.usageUnknown}` + (status.error ? `\n阶段未完成，已暂停：${status.error}` : "")
				document.getElementById("ai_trace_panel").open = true
			}
		}
		var response = await fetch(`/api/ai-trace/${encodeURIComponent(gameId)}`)
		if (!response.ok) return
		var rows = await response.json()
		if (!rows.length) { panel.replaceChildren(); eots_last_trace_replay = 0; return }
		if (rows[rows.length - 1].replay_id === eots_last_trace_replay) return
		eots_last_trace_replay = rows[rows.length - 1].replay_id
		panel.replaceChildren()
		var latest = new Map(), inferences = new Map()
		rows.forEach(row => { latest.set(row.role, row); if (row.trace.llm && row.trace.policy === "llm") inferences.set(row.role, row) })
		Array.from(latest.values()).sort((a, b) => Number(!!b.trace.llm) - Number(!!a.trace.llm)).forEach(row => eots_render_ai_current(panel, row, inferences.get(row.role)))
		if (rows.some(row => row.trace.llm)) document.getElementById("ai_trace_panel").open = true
		var history = document.createElement("details")
		history.className = "ai_trace_history"
		var summary = document.createElement("summary")
		summary.textContent = "最近 20 步决策记录"
		history.appendChild(summary)
		rows.slice(-20).forEach(function (row) {
			var trace = row.trace
			var item = document.createElement("p")
			var sm = trace.sm || {}
			if (trace.llm) {
				item.textContent = `#${row.replay_id} ${eots_t(row.role)} · ${trace.model} · ${trace.label || trace.action} · ${trace.explanation || trace.policy}`
				history.appendChild(item)
				return
			}
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
