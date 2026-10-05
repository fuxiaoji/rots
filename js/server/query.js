function on_query(q, params, b) {
    // Public definitions/control only. Callers must query a copied position.
    if (q === "llm_public_data") {
        const hexes = []
        for (let h = 0; h <= LAST_BOARD_HEX; h++) {
            const m = get_map_data(h)
            if (!m || m.id !== int_to_hex(h)) continue
            hexes.push({ hex: h, id: m.id, name: m.name || String(m.id), region: m.region || null,
                terrain: m.terrain, port: !!m.port, airfield: !!m.airfield, resource: !!m.resource,
                named: !!m.named, control: !is_controllable_hex(h) ? null : is_space_controlled(h, JP) ? "Japan" : is_space_controlled(h, AP) ? "Allies" : null })
        }
        let activation = null
        if (R === G.active && L.P === "activate_units") {
            const activeCount = G.offensive.active_units[R].length
            const limit = G.offensive.logistic + L.hq_bonus
            activation = { hqId: G.offensive.active_hq[R] || null, logistic: G.offensive.logistic,
                hqBonus: L.hq_bonus, limit, activeCount, remaining: Math.max(0, limit - activeCount), overBudget: activeCount > limit }
        }
        const scenario = { id: G.sid, name: scenario_data().name, lastTurn: scenario_data().last_turn }
        if (G.sid === SOUTH_PACIFIC_SCENARIO) {
            const scoring = rules_query_snapshot(() => get_victory(), G.active)
            scenario.victoryMode = "south-pacific-vp"
            scenario.victory = { basis: "current-engine-implementation", evaluation: "if-scored-now",
                vp: scoring.vp, breakdown: scoring.text, winningSideIfScoredNow: scoring.won_side,
                alliesMaximumVP: 5, japanMinimumVP: 6, politicalWillZeroWinner: "Japan" }
        }
        return { hexes, scenario, activation, cards: cards.map((c, id) => c ? { id, name: c.name, type: c.type,
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
