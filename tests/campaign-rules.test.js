"use strict"

// AI-WIN-01. Invoke actual source functions through test-only VM entry points.
// A terminal parent frame isolates each segment; control, supply, resource trace,
// PoW and victory are not mocked. Imports expand in memory, never into rules.js.
const assert = require("assert")
const fs = require("fs")
const path = require("path")
const vm = require("vm")
const crypto = require("crypto")
const zlib = require("zlib")
const root = path.resolve(__dirname, "..")

function loadCampaignRules() {
    function expand(relative) {
        return fs.readFileSync(path.join(root, "js", relative), "utf8")
            .replace(/^\/\*\* import ([^\r\n]+)\*\/$/gm, (_, imported) => expand(imported.trim()))
    }
    const context = vm.createContext({ exports: {}, console })
    vm.runInContext(expand("rules.js") + `
        function campaign_test_bind(state) {
            G = state; R = AP; V = null; G.active = AP;
            G.L = L = { P: "campaign_test", pw: 0, L: { P: "campaign_test_return" } };
        }
        exports.campaignTest = {
            constants: { AP, JP, chinaBox: CHINA_BOX, lastBoardHex: LAST_BOARD_HEX,
                jpControl: JP_CONTROLLED, notUsed: NOT_USED,
                b29: [B_29_1, B_29_2], bombingCampaign: events.STRAT_BOMBING_CAMPAIGN.id,
                blockade: events.JAPAN_TRACE_RESOURCES.id, tojo: events.TOJO.id,
                scenario1942: "1942-1945 (The Shortened Campaign)",
                scenario1943: "1943-1945 (The Even Shorter Campaign)" },
            hex: hex_to_int, coordinate: int_to_hex,
            distance: (a, b) => get_distance(hex_to_int(a), hex_to_int(b)),
            resourceCoordinates: RESOURCE_HEX.map(int_to_hex),
            honshuCoordinates: nations.JAPAN.keys.slice(),
            clearBoard(state) {
                campaign_test_bind(state);
                G.location.fill(NOT_USED); G.oos = []; G.reduced = [];
                reset_offensive(); check_supply(); G.capture = [];
            },
            initialControl(state, coordinates, faction) {
                campaign_test_bind(state);
                for (const coordinate of coordinates) {
                    const h = hex_to_int(coordinate);
                    if (faction === JP) G.supply_cache[h] |= JP_CONTROLLED;
                    else G.supply_cache[h] &= ~JP_CONTROLLED;
                }
            },
            map(state, coordinate) {
                campaign_test_bind(state);
                const h = hex_to_int(coordinate), m = get_map_data(h);
                return { hex: h, coordinate, name: m.name || null, region: m.region,
                    port: !!m.port, airfield: !!m.airfield, resource: !!m.resource,
                    controllable: !!create_controllable_hex(h), named: !!m.named };
            },
            atomic(state) { campaign_test_bind(state); return atomic_bomb_strategy_status(); },
            trace(state) { campaign_test_bind(state); return check_japan_resource_trace(); },
            nationalStatus(state) { campaign_test_bind(state); P.national_status_segment(); },
            capture(state, coordinate, faction) { campaign_test_bind(state); capture_hex(hex_to_int(coordinate), faction); },
            controlled(state, coordinate, faction) { campaign_test_bind(state); return is_space_controlled(hex_to_int(coordinate), faction); },
            powTarget(state) { campaign_test_bind(state); set_pow(); return G.pow; },
            powCheck(state) { campaign_test_bind(state); check_progress_of_war(); },
            powCount(state) { campaign_test_bind(state); return G.capture.filter(h => is_space_controlled(h, AP)).length; },
            canSoviet(state) { campaign_test_bind(state); return !!cards[SOVIET_INVADE].can_play(); },
            soviet(state) { campaign_test_bind(state); cards[SOVIET_INVADE].event(); },
            groundDenied(state, coordinate) {
                campaign_test_bind(state); G.active_stack = [ap_army("1_m")];
                return !!ground_move_denied(hex_to_int(coordinate));
            },
            rivalCandidates(state, selected, candidates) {
                campaign_test_bind(state); G.offensive.active_units[AP] = [selected];
                L.allowed_units = candidates.slice(); apply_inter_service(); return L.allowed_units.slice();
            },
        };
    `, context, { filename: "campaign-test-source.js" })
    return { rules: context.exports, api: context.exports.campaignTest, constants: context.exports.campaignTest.constants }
}

function runCases(name, cases) {
    let passed = 0
    for (const [label, test] of cases) {
        try { test(); passed++ }
        catch (error) {
            console.error(`FAIL ${name}: ${label}\n${error.stack}`)
            process.exitCode = 1
        }
    }
    console.log(`${name}: ${passed}/${cases.length} cases passed`)
}

function campaignCases() {
    const { rules, api, constants: C } = loadCampaignRules()
    const fresh = () => rules.setup(20261004, C.scenario1942, {})
    function empty() {
        const state = fresh()
        api.clearBoard(state)
        return state
    }
    function disconnected(turn = 10) {
        const state = empty()
        state.turn = turn
        api.initialControl(state, api.resourceCoordinates, C.AP)
        api.initialControl(state, api.honshuCoordinates, C.JP)
        return state
    }
    function powState(coordinate, initialFaction) {
        const state = empty()
        state.turn = 5
        state.pow = 1
        state.political_will = 6
        api.initialControl(state, [coordinate], initialFaction)
        state.capture = []
        return state
    }
    return [
        ["1942 and 1943 campaign opening clocks are different", () => {
            const a = fresh(), b = rules.setup(20261004, C.scenario1943, {})
            assert.equal(a.turn, 2)
            assert.equal(a.political_will, 8)
            assert.equal(a.asp[C.AP][0], 1)
            assert.equal(b.turn, 5)
            assert.equal(b.political_will, 6)
            assert.equal(b.pow, 4)
            assert.equal(b.inter_service[C.AP], 1)
            assert.equal(b.inter_service[C.JP], 1)
        }],
        ["1943 has Pacific ground troops; ISR filters rival US services", () => {
            const state = rules.setup(20261004, C.scenario1943, {})
            const onMap = rules.pieces.map((p, id) => ({ ...p, id, location: state.location[id] }))
                .filter(p => p.faction === C.AP && p.location < C.lastBoardHex)
            const marine = onMap.find(p => p.class === "ground" && p.type === "marine" && api.coordinate(p.location) === 4423)
            const army = onMap.find(p => p.class === "ground" && p.service === "army" && api.coordinate(p.location) === 4423)
            const carrier = onMap.find(p => p.class === "naval" && p.service === "navy" && p.br > 0)
            assert(marine && army && carrier, "Guadalcanal has ground troops; Pacific naval units also exist")
            assert(onMap.some(p => p.class === "ground" && p.type === "marine" && api.coordinate(p.location) === 3626), "Townsville has another marine unit")
            const candidates = [army.id, marine.id, carrier.id]
            assert.deepEqual(Array.from(api.rivalCandidates(state, army.id, candidates)), [army.id])
            state.inter_service[C.AP] = 0
            assert.deepEqual(Array.from(api.rivalCandidates(state, army.id, candidates)), candidates)
        }],
        ["PoW starts at T4 and uses total available ASP capped at four", () => {
            const state = fresh()
            state.asp[C.AP] = [3, 2]
            state.turn = 3
            assert.equal(api.powTarget(state), 0)
            state.turn = 4
            assert.equal(api.powTarget(state), 3, "spent ASP does not reduce the turn's quota")
            state.asp[C.AP][0] = 7
            assert.equal(api.powTarget(state), 4)
        }],
        ["capture and hold a Japanese-starting hex satisfies PoW", () => {
            const state = powState(3813, C.JP)
            api.capture(state, 3813, C.AP)
            assert.equal(api.powCount(state), 1)
            api.powCheck(state)
            assert.equal(state.political_will, 6)
        }],
        ["capture then lose a hex does not satisfy PoW; recapture restores credit", () => {
            const state = powState(3813, C.JP)
            api.capture(state, 3813, C.AP)
            api.capture(state, 3813, C.JP)
            assert.equal(api.powCount(state), 0)
            api.powCheck(state)
            assert.equal(state.political_will, 5)
            api.capture(state, 3813, C.AP)
            assert.equal(api.powCount(state), 1)
        }],
        ["recovering a hex that began the turn Allied gives no PoW credit", () => {
            const state = powState(3813, C.AP)
            api.capture(state, 3813, C.JP)
            api.capture(state, 3813, C.AP)
            assert.equal(api.powCount(state), 0)
            api.powCheck(state)
            assert.equal(state.political_will, 5)
        }],
        ["Philippines liberation gives PoW credit for national control conversion", () => {
            const state = empty()
            state.turn = 5
            state.pow = 4
            // Six eligible hexes; Manila+Davao are the two national keys.
            const eligible = [2911, 2812, 2813, 3014, 2915, 2715]
            api.initialControl(state, eligible, C.JP)
            state.surrender[0] = 2
            state.capture = []
            api.capture(state, 2813, C.AP)
            api.capture(state, 2915, C.AP)
            assert.equal(api.powCount(state), 2)
            api.nationalStatus(state)
            assert.equal(state.surrender[0], 0)
            assert.equal(api.powCount(state), 6)
            assert(eligible.every(h => api.controlled(state, h, C.AP)))
            const before = state.political_will
            api.powCheck(state)
            assert.equal(state.political_will, before)
        }],
        ["Tokyo alone and six named Honshu hexes are insufficient", () => {
            const state = empty()
            assert.deepEqual(Array.from(api.honshuCoordinates).sort(), [3407, 3506, 3507, 3606, 3607, 3705, 3706])
            api.capture(state, 3706, C.AP)
            api.nationalStatus(state)
            assert.equal(state.result, undefined)
            for (const coordinate of [3407, 3506, 3507, 3607, 3705]) api.capture(state, coordinate, C.AP)
            api.nationalStatus(state)
            assert.equal(state.result, undefined, "the unnamed West Honshu hex 3606 is still required")
            api.capture(state, 3606, C.AP)
            api.nationalStatus(state)
            assert.equal(state.result, "Allies")
            assert.equal(api.controlled(state, 3307, C.JP), true, "Kyushu is not required for Honshu conquest")
        }],
        ["a real disconnected resource graph wins on the third consecutive status segment", () => {
            const state = disconnected()
            assert.equal(api.trace(state), false)
            api.nationalStatus(state)
            assert.equal(state.events[C.blockade], 10)
            assert.equal(state.result, undefined)
            state.turn = 11
            api.nationalStatus(state)
            assert.equal(state.result, undefined)
            state.turn = 12
            api.nationalStatus(state)
            assert.equal(state.result, "Allies")
            assert(state.log.some(line => line === "Allies Victory by blockade."))
        }],
        ["one restored Korean resource route resets blockade rather than pausing the clock", () => {
            const state = disconnected()
            api.nationalStatus(state)
            state.turn = 11
            api.initialControl(state, [3305], C.JP)
            assert.equal(api.trace(state), true, "Seoul reconnects to the mainland through the actual map")
            api.nationalStatus(state)
            assert.equal(state.events[C.blockade], 0)
            api.initialControl(state, [3305], C.AP)
            state.turn = 12
            api.nationalStatus(state)
            assert.equal(state.events[C.blockade], 12)
            assert.equal(state.result, undefined, "a restarted blockade cannot finish within T12")
        }],
        ["airport, port and controllable objective are distinct map properties", () => {
            const state = empty()
            for (const coordinate of [3814, 3709]) {
                const m = api.map(state, coordinate)
                assert.equal(m.airfield, true)
                assert.equal(m.port, false)
                assert.equal(m.controllable, true)
            }
            for (const coordinate of [3813, 3416, 3209]) {
                const m = api.map(state, coordinate)
                assert.equal(m.airfield, true)
                assert.equal(m.port, true)
            }
            const shima = api.map(state, 3308)
            assert.equal(shima.name, "Shima")
            assert.equal(shima.airfield, false)
            assert.equal(shima.port, false)
            assert.equal(shima.controllable, false)
            assert.equal(shima.named, false)
            const before = api.powCount(state)
            api.capture(state, 3308, C.AP)
            assert.equal(api.powCount(state), before)
        }],
        ["historical planning fixtures contain only verified public terminal observations", () => {
            const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/campaign-scenarios.json"), "utf8"))
            assert.deepEqual(fixture.scenarios.map(s => s.gameId), [73, 76, 78])
            const forbidden = new Set(["hand", "draw", "seed", "undo", "redo", "L", "offensive", "future_offensive"])
            function inspect(value) {
                if (!value || typeof value !== "object") return
                for (const [key, item] of Object.entries(value)) {
                    assert(!forbidden.has(key), `private field ${key} must not enter public fixtures`)
                    inspect(item)
                }
            }
            inspect(fixture)
            for (const scenario of fixture.scenarios) {
                assert.equal(scenario.kind, "historical-public-terminal-snapshot")
                assert.equal(scenario.useAsPlayedWinEvidence, false)
                const bytes = fs.readFileSync(path.join(root, scenario.source.stateFile))
                assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), scenario.source.stateSha256)
                const raw = JSON.parse(zlib.gunzipSync(bytes))
                assert.equal(scenario.public.turn, raw.turn)
                assert.equal(scenario.public.politicalWill, raw.political_will)
                assert.equal(scenario.public.powRequired, raw.pow)
                assert.deepEqual(scenario.public.interServiceRivalry, raw.inter_service)
                assert.equal(scenario.public.terminalLog, raw.log[raw.log.length - 1])
                for (const unit of scenario.public.alliedOnMapUnits) {
                    assert.equal(rules.pieces[unit.id].faction, C.AP)
                    assert.equal(unit.location, raw.location[unit.id])
                    assert(unit.location < C.lastBoardHex)
                    assert.equal(unit.coordinate, api.coordinate(unit.location))
                }
            }
            const state = fresh()
            for (const expected of fixture.mapProperties) {
                assert.deepEqual(JSON.parse(JSON.stringify(api.map(state, expected.coordinate))), expected)
            }
        }],
    ]
}

if (require.main === module) runCases("Campaign rule boundaries", campaignCases())
module.exports = { loadCampaignRules, runCases, campaignCases }
