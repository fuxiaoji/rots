function on_query(q, params, b) {
    // Public definitions/control only. Callers must query a copied position.
    if (q === "llm_public_data") {
        const hexes = []
        for (let h = 0; h <= LAST_BOARD_HEX; h++) {
            const m = get_map_data(h)
            if (!m || m.id !== int_to_hex(h)) continue
            hexes.push({ hex: h, id: m.id, name: m.name || String(m.id), region: m.region || null,
                terrain: m.terrain, port: !!m.port, airfield: !!m.airfield, resource: !!m.resource,
                neighbors: (m.nh || []).filter(n => Number.isInteger(n) && n >= 0 && n <= LAST_BOARD_HEX), edges: m.edges_int || 0,
                named: !!m.named, control: !is_controllable_hex(h) ? null : is_space_controlled(h, JP) ? "Japan" : is_space_controlled(h, AP) ? "Allies" : null })
        }
        let activation = null
        if (R === G.active && L.P === "activate_units") {
            const activeCount = G.offensive.active_units[R].length
            const limit = G.offensive.logistic + L.hq_bonus
            activation = { hqId: G.offensive.active_hq[R] || null, logistic: G.offensive.logistic,
                hqBonus: L.hq_bonus, limit, activeCount, remaining: Math.max(0, limit - activeCount), overBudget: activeCount > limit }
        }
        const scenario = { id: G.sid, name: scenario_data().name, lastTurn: scenario_data().last_turn,
            nations: ["PHILIPPINES", "MALAYA", "DEI", "BURMA"].map(key => {
                const nation = nations[key], keys = nation.keys.map(mapId => {
                    const hex = hex_to_int(mapId)
                    return { hex, mapId, name: get_map_data(hex)?.name || String(mapId),
                        control: is_space_controlled(hex, JP) ? "Japan" : is_space_controlled(hex, AP) ? "Allies" : null }
                }), surrenderedTurn = Number(G.surrender[nation.id] || 0)
                return { id: nation.id, key, name: nation.name, surrenderedTurn, keys,
                    allJapanControlled: keys.every(h => h.control === "Japan"), engineReady: keys.every(h => h.control !== "Allies"),
                    // check_nation_controlled requires no opposite controlled key.
                    remainingKeys: keys.filter(h => h.control === "Allies").map(h => h.hex),
                    status: surrenderedTurn ? "surrendered" : keys.some(h => h.control === "Allies") ? "capture-required" : "await-national-status",
                    basis: "public national status; source PDF35-36 sections13.22/13.32/13.42/13.52; engine key-control check" }
            }) }
        if (G.sid === SOUTH_PACIFIC_SCENARIO) {
            const scoring = rules_query_snapshot(() => get_victory(), G.active)
            scenario.victoryMode = "south-pacific-vp"
            scenario.victory = { basis: "current-engine-implementation", evaluation: "if-scored-now",
                vp: scoring.vp, breakdown: scoring.text, winningSideIfScoredNow: scoring.won_side,
                alliesMaximumVP: 5, japanMinimumVP: 6, politicalWillZeroWinner: "Japan" }
        } else if (CAMPAIGN_SCENARIOS.includes(G.sid)) {
            scenario.victoryMode = "campaign"
            scenario.victory = { basis: "current-engine-implementation", politicalWillZeroWinner: "Japan",
                lastTurn: scenario_data().last_turn, atomic: atomic_bomb_strategy_status(), blockade: queryBlockadeStatus(),
                homeland: nations.JAPAN.keys.map(hex_to_int).map(hex => ({ hex, alliesControlled: is_space_controlled(hex, AP) })) }
        }
        const ownReaction = R !== G.offensive.attacker && R !== undefined && cards[G.offensive.counter_offensive_card]?.faction === R ? G.offensive.counter_offensive_card : null
        const selectedCard = L.P === "offensive_segment_card_action" ? (R === G.active ? L.c : null) : ownReaction || G.offensive.offensive_card
        const cardMode = L.P === "offensive_segment_card_action" ? null : ownReaction ? "reaction" : G.offensive.type === EC ? "event" : "ops"
        const ownFaction = R === JP || R === AP ? R : null
        const held = G.capture.filter(h => is_space_controlled(h, AP))
        const ownHQs = ownFaction === null ? [] : HQ_LIST.filter(u => pieces[u].faction === ownFaction && unit_on_board(u))
        const ownSupply = ownFaction === null ? [] : rules_query_snapshot(() => {
            check_supply()
            return pieces.map((p, u) => p?.faction === ownFaction && unit_on_board(u) ? { id: u, supplied: !!check_unit_supply(G.location[u], u, p) } : null).filter(Boolean)
        }, ownFaction)
        const previewCards = ownFaction === null || R !== G.active ? [] : /offensive_segment/.test(L.P)
            ? [...G.hand[R], ...(G.future_offensive[R] > 0 ? [G.future_offensive[R]] : [])]
            : selectedCard > 0 && cards[selectedCard]?.faction === R ? [selectedCard] : []
        const previews = []
        for (const cardId of previewCards) for (const mode of ["ops", "event"]) for (const hqId of ownHQs) {
            if (previews.length >= 96) break
            const preview = queryCardPreview(cardId, { faction: R, cardMode: mode, hqId })
            previews.push({ ...preview, availability: preview.eligible ? "exact-preview" : "unavailable-not-legality-proof" })
        }
        return { hexes, scenario, activation, planning: {
            ownASPRemaining: ownFaction === null ? null : get_asp_limit(ownFaction), ownSupply,
            pow: { required: G.pow, heldCount: held.length, heldHexes: held, gap: Math.max(0, G.pow - held.length), applies: G.sid !== SOUTH_PACIFIC_SCENARIO && G.sid !== BURMA_SCENARIO },
            currentCardId: selectedCard > 0 ? selectedCard : null, currentCardMode: selectedCard > 0 ? cardMode : null,
            currentCardBasis: L.P === "offensive_segment_card_action" ? "own-selected-unplayed" : ownReaction ? "own-counter-offensive" : "public-attacking-card",
            offensive: { attacker: ROLES[G.offensive.attacker] || null, cardId: G.offensive.offensive_card || null,
                ownReactionCardId: ownReaction,
                stage: G.offensive.stage, ownHQ: ownFaction === null ? null : G.offensive.active_hq[ownFaction] || null,
                logistic: G.offensive.logistic, intelligence: G.offensive.intelligence,
                navalMoveDistance: G.offensive.naval_move_distance, groundMoveDistance: G.offensive.ground_move_distance, airMoveDistance: G.offensive.air_move_distance,
                movedUnitIds: (G.offensive.paths || []).filter((_, i) => i % 2 === 0 && pieces[G.offensive.paths[i]]?.faction === ownFaction),
                battleHexes: (G.offensive.battle_hexes || []).slice() },
            ownHQDistances: ownHQs.map(id => ({ id, distances: hexes.filter(h => h.named).map(h => [h.hex, get_distance(G.location[id], h.hex)]) })),
            cardPreviews: previews, previewsLimited: previews.length >= 96,
            ownUnitDefinitions: pieces.map((p, id) => p?.faction === ownFaction ? { id, definitionId: p.id, name: p.name || p.id, faction: p.faction, class: p.class, type: p.type || null, service: p.service || null,
                cf: p.cf || 0, rcf: p.rcf || 0, lf: p.lf || 0, cr: p.cr || 0, cm: p.cm || 0, br: p.br || 0, ebr: p.ebr || 0, aspCost: p.asp || 0, oneStep: !!p.one_step, parenthetical: !!p.parenthetical } : null).filter(Boolean),
        }, cards: cards.map((c, id) => c ? { id, name: c.name, type: c.type, faction: c.faction,
            ops: c.ops, logistic: c.logistic, hq: c.hq, reaction: !!c.reaction,
            metadata: Object.fromEntries(Object.entries(c).filter(([k, v]) => !["name", "type", "ops", "logistic", "hq"].includes(k) && (typeof v === "number" || typeof v === "boolean" || Array.isArray(v) && v.every(x => typeof x === "number")))) } : null) }
    }
    if (q === "llm_legal_moves") {
        // Reuse the actual selected group's client movement generator; no AI scoring.
        if (R !== G.active || L.P !== "move_offensive_units" || !G.active_stack.length) return []
        update_move_hex()
        const paths = []
        map_for_each(L.allowed_hexes || [], (hex, path) => paths.push({ hex, path: object_copy(path) }))
        return paths
    }
    if (q === "llm_semi_catalog") {
        // [LLM-SEMI-01] 半自动模式战略目录: 当前阶段可命名的伊拉斯谟战略与默认有序
        // 目标链(纯解析, 不钉选、不掷骰、不改任何缓存)。执行引用仍以钉选时的引擎
        // 展开为准; 空优/最终防御等动态目标在真实钉选时由引擎补充。
        const role = ROLES[R]
        if ((role !== "Japan" && role !== "Allies") || typeof esm_phase !== "function" || typeof esm_lib !== "function") return null
        const phase = esm_phase(role)
        const lib = (esm_lib(role) || {})[phase] || {}
        const describe = t => {
            const m = get_map_data(t.hex) || {}
            return { hex: t.hex, mapId: m.id || (typeof int_to_hex === "function" ? int_to_hex(t.hex) : String(t.hex)),
                name: m.name || m.id || String(t.hex),
                control: is_space_controlled(t.hex, JP) ? "Japan" : is_space_controlled(t.hex, AP) ? "Allies" : null,
                kind: t.kind || null, requiresOccupation: !!t.requiresOccupation, damageLevel: t.damageLevel ?? null,
                resource: !!m.resource, port: !!m.port, airfield: !!m.airfield }
        }
        const strategies = Object.entries(lib).map(([key, entry]) => {
            let defaultChain = []
            try { defaultChain = esm_goal_target_meta(esm_parse_entry(entry, role, phase)).map(describe) } catch (e) { defaultChain = [] }
            return { name: key, kind: entry.kind, targets: entry.targets, notes: entry.notes, defaultChain }
        })
        return { role, phase, turn: G.turn, strategies,
            basis: "erasmus v2.0 chart strategy library, current phase only; defaultChain is chart order — the model may return a subset/reordering of these mapIds, execution priority follows the returned order" }
    }
    if (q && typeof q === "object" && q.name === "rules_query") {
        return rules_query_dispatch(q)
    }
    if (q.name === "battle_info") {
        return battle_info_query(q.index)
    }
    if (q === "original_control") {
        return scenario_data().original_control
    }
    if (q === "atomic_bomb_strategy_status") {
        return atomic_bomb_strategy_status()
    }
}

function vp_query() {
    return get_victory()
}

//could corrupt G, run only in safe context
function battle_info_query(battle) {
    if (!set_has(G.offensive.battle, battle)) {
        create_battle_hex(battle)
    }
    G.log = []
    var result = {
        naval_cf: [],
        naval_distant_hits: [],
        naval_rm: [],
        naval_log: [],
        ground_cf: [],
        ground_rm: [],
        ground_log: [],
        battle_hex: G.offensive.battle_names[battle],
        battle_name: battle,
    }
    var battle_hex = G.offensive.battle_names[battle]
    G.offensive.battle = {battle_hex}
    prepare_battle()
    result.air_naval = G.offensive.battle.air_naval
    G.log = []
    prepare_attack(JP)
    get_battle_modifiers(JP)
    result.naval_cf = G.offensive.battle.strength
    result.naval_rm[JP] = G.offensive.battle.roll_modifiers
    result.naval_distant_hits[JP] = G.offensive.battle.distant_hits
    result.naval_log[JP] = G.log
    G.log = []
    prepare_attack(AP)
    get_battle_modifiers(AP)
    result.naval_rm[AP] = G.offensive.battle.roll_modifiers
    result.naval_distant_hits[AP] = G.offensive.battle.distant_hits
    result.naval_log[AP] = G.log
    G.log = []
    prepare_ground_battle()
    result.ground = G.offensive.battle.ground
    G.log = []
    prepare_attack(JP)
    get_battle_modifiers(JP)
    result.ground_cf = G.offensive.battle.strength
    result.ground_rm[JP] = G.offensive.battle.roll_modifiers
    result.ground_log[JP] = G.log
    G.log = []
    prepare_attack(AP)
    get_battle_modifiers(AP)
    result.ground_rm[AP] = G.offensive.battle.roll_modifiers
    result.ground_log[AP] = G.log
    return result
}

function draw_list() {
    var hand = [G.draw[JP].concat(G.hand[JP]), G.draw[AP].concat(G.hand[AP])]
    if (G.future_offensive[AP] > 0) {
        hand[AP].push(G.future_offensive[AP])
    }
    if (G.future_offensive[JP] > 0) {
        hand[JP].push(G.future_offensive[JP])
    }
    hand[AP].sort()
    hand[JP].sort()
    return {hand}
}
