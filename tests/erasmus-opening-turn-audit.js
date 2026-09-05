"use strict"

// 只运行 1942 缩短战役的开局回合（Turn 2），用于审计日本菲律宾/东印度攻势。
// 统计的是规则日志，不以最终胜负代替开局任务部队正确性。
const rules = require("../rules.js")
const bot = rules.bots["erasmus-v2"]

const count = Number(process.argv[2] || 20)
const baseSeed = Number(process.argv[3] || 20260903)
const maxActions = Number(process.argv[4] || 5000)

function activeRole(state) {
    return Array.isArray(state.active) ? state.active.slice().sort()[0] : state.active
}

function play(seed) {
    let state = rules.setup(seed, "1942-1945 (The Shortened Campaign)", { headless_moves: true })
    let actions = 0
    let rangedAirCommitments = 0, rangedCarrierCommitments = 0
    while (state.active !== "None" && Number(state.turn || 0) <= 2 && actions < maxActions) {
        const role = activeRole(state)
        const view = rules.view(state, role)
        const decision = bot.decide(view, { role, seed, actionOrdinal: actions + 1 })
        if (!view.actions || !(decision.action in view.actions))
            throw new Error(`illegal ${decision.action} @ ${view.prompt}`)
        if (/choose attack hex|assign units to (?:battle|escort)/i.test(String(view.prompt||""))&&
            (decision.action==="action_hex"||decision.action==="hex")) {
            const byId=new Map((view.ai?.units||[]).map(u=>[u.id,u]))
            for(const id of state.active_stack||[]){
                const u=byId.get(id),source=state.location?.[id]
                if(!u||source===decision.argument)continue
                if(u.class==="air")rangedAirCommitments++
                else if(u.class==="naval"&&Number(u.br)>0)rangedCarrierCommitments++
            }
        }
        state = rules.action(state, role, decision.action, decision.argument)
        actions++
    }
    const log = state.log || []
    let side = null, lastCard = null, jpNoUnits = 0, apNoUnits = 0
    const zeroActivationCards = []
    for (const line of log) {
        if (/^#JJP Action/.test(line)) side = "Japan"
        else if (/^#AAP Action/.test(line)) side = "Allies"
        else if (/C\d+ played as (?:event|operation card)/.test(String(line))) lastCard = String(line)
        else if (/No units activated/.test(line)) {
            if (side === "Japan") jpNoUnits++
            else if (side === "Allies") apNoUnits++
            zeroActivationCards.push({ side, card: lastCard })
        }
    }
    const captured = h => log.some(line => new RegExp(`JP captured H${h}\\.$`).test(String(line)))
    const dei = [245, 277, 278, 307, 308, 309, 368, 395, 452, 480, 484, 508]
    const deiCaptures = [...new Set(dei)].filter(captured)
    return {
        seed, actions, turn: state.turn,
        manilaCaptured: captured(535),
        balikpapanCaptured: captured(452),
        tarakanCaptured: captured(480),
        deiCaptureCount: deiCaptures.length,
        amphibiousEscortFailures: log.filter(line => /Amphibious Assault failed due to lack of naval escort/.test(line)).length,
        jpNoUnits, apNoUnits, zeroActivationCards,
        rangedAirCommitments,rangedCarrierCommitments,
        manilaBattles: log.filter(line => /Battle [A-Z] declared in H535/.test(line)).length,
    }
}

const games = []
for (let i = 0; i < count; ++i) games.push(play(baseSeed + i))
const sum = key => games.reduce((n, g) => n + Number(g[key] || 0), 0)
const report = {
    policy: bot.version,
    seeds: [baseSeed, baseSeed + count - 1],
    games: count,
    manilaCapturedGames: games.filter(g => g.manilaCaptured).length,
    balikpapanCapturedGames: games.filter(g => g.balikpapanCaptured).length,
    tarakanCapturedGames: games.filter(g => g.tarakanCaptured).length,
    anyDeiCapturedGames: games.filter(g => g.deiCaptureCount > 0).length,
    amphibiousEscortFailures: sum("amphibiousEscortFailures"),
    japaneseZeroActivationOffensives: sum("jpNoUnits"),
    alliedZeroActivationOffensives: sum("apNoUnits"),
    manilaBattles: sum("manilaBattles"),
    rangedAirCommitments: sum("rangedAirCommitments"),
    rangedCarrierCommitments: sum("rangedCarrierCommitments"),
    zeroActivationCards: games.flatMap(g => g.zeroActivationCards),
    games,
}
console.log(JSON.stringify(report, null, 2))
