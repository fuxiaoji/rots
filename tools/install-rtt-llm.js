"use strict"
// Surgical, idempotent installation into a separate RTT runtime. Never replace its other local patches.
const fs = require("node:fs"), path = require("node:path")
const runtime = path.resolve(process.argv[2] || "../rots-runtime-pve")
function patch(file, edit) {
    const filename = path.join(runtime, file), original = fs.readFileSync(filename, "utf8")
    if (original.includes("RTT-LLM-01")) { console.log(file + ": already installed"); return }
    let source = original.replace(/\r\n/g, "\n")
    const replace = (from, to) => {
        if (source.split(from).length !== 2) throw new Error(file + ": missing or ambiguous anchor: " + from.slice(0, 90))
        source = source.replace(from, to)
    }
    edit(replace)
    fs.writeFileSync(filename + ".before-rtt-llm", original)
    fs.writeFileSync(filename, source)
    console.log(file + ": installed")
}
patch("server.js", r => {
    r('let RULES = {}', 'let RULES = {}\n// RTT-LLM-01: asynchronous native bots and private accounting.\nconst RTT_LLM = require("./public/empire-of-the-sun/js/server/llm/rtt").createBridge(db)')
    r('const bot = RULES[title_id] && RULES[title_id].bots && RULES[title_id].bots[bot_id]', 'const bot = RTT_LLM.bots(RULES[title_id], title_id)[bot_id]')
    r('\t\trules: RULES[title_id],\n', '\t\trules: RULES[title_id],\n\t\taivai_bots: RTT_LLM.bots(RULES[title_id], title_id),\n')
    r('const bots = RULES[title_id].bots || {}', 'const bots = RTT_LLM.bots(RULES[title_id], title_id)')
    r('app.get("/api/ai-trace/:game_id", must_be_logged_in, function (req, res) {', `app.get("/api/llm-status/:game_id", must_be_logged_in, function (req, res) {
    const id = req.params.game_id | 0, game = SQL_SELECT_GAME.get(id)
    if (!game) return res.status(404).send("Invalid game ID.")
    if (!RTT_LLM.creatorAllowed(game, req.user, SQL_SELECT_BOT_PLAYER.all(id))) return res.status(403).send("Not authorized.")
    const ctx = RTT_LLM.get(id)
    res.set("Cache-Control", "no-store")
    return res.json(ctx ? { stats: ctx.stats, limits: ctx.limits, error: ctx.error, pending: !!ctx.pending } : null)
})

app.get("/api/ai-trace/:game_id", must_be_logged_in, function (req, res) {`)
    r('\t\tlet ai_game_id\n', '\t\tif ([bot_id_jp, bot_id_ap].some(RTT_LLM.isLLM)) {\n\t\t\ttry { RTT_LLM.limits(req.body) } catch (_) { return res.status(400).send("Invalid LLM budget.") }\n\t\t}\n\t\tlet ai_game_id\n')
    r('\t\t\tSQL_COMMIT.run()\n\t\t} finally {\n\t\t\tif (db.inTransaction) SQL_ROLLBACK.run()\n\t\t}\n\t\tstart_game(SQL_SELECT_GAME.get(ai_game_id))', '\t\t\tif ([bot_id_jp, bot_id_ap].some(RTT_LLM.isLLM)) RTT_LLM.init(ai_game_id, req.body, roles.map(role => ({ role, bot_id: role === "Allies" ? bot_id_ap : bot_id_jp })))\n\t\t\tSQL_COMMIT.run()\n\t\t} finally {\n\t\t\tif (db.inTransaction) SQL_ROLLBACK.run()\n\t\t}\n\t\tstart_game(SQL_SELECT_GAME.get(ai_game_id))')
    r('const reveal_private = game.status >= STATUS_FINISHED || req.user.user_id === 1\n\tconst rows = (reveal_private ? SQL_SELECT_AI_TRACE_PRIVATE : SQL_SELECT_AI_TRACE_PUBLIC).all(game_id)\n\treturn res.json(rows.map(row => ({ ...row, trace: JSON.parse(row.trace) })))', `const reveal_private = game.status >= STATUS_FINISHED || req.user.user_id === 1
    const creator = RTT_LLM.creatorAllowed(game, req.user, SQL_SELECT_BOT_PLAYER.all(game_id))
    const publicRows = SQL_SELECT_AI_TRACE_PUBLIC.all(game_id)
    const privateRows = SQL_SELECT_AI_TRACE_PRIVATE.all(game_id)
    res.set("Cache-Control", "no-store")
    return res.json(publicRows.map((row, i) => {
        const pub = JSON.parse(row.trace), priv = JSON.parse(privateRows[i].trace)
        const trace = pub.llm ? (creator ? RTT_LLM.summary(priv) : pub) : (reveal_private ? priv : pub)
        return { ...row, trace }
    }))`)
    r('function rewind_game_to_snap(game_id, snap_id) {', 'function rewind_game_to_snap(game_id, snap_id) {\n\tif (game_ai_locks.has(game_id)) throw new Error("AI正在请求模型，请等待本次推进暂停后回退。")')
    r('app.post("/api/rewind/:game_id", must_be_logged_in, function (req, res) {', 'app.post("/api/rewind/:game_id", must_be_logged_in, function (req, res) {\n\tif (game_ai_locks.has(req.params.game_id | 0)) return res.status(409).send("AI正在推进，请等待暂停后回退。")')
    r('app.post("/api/delete/:game_id", must_be_logged_in, function (req, res) {', 'app.post("/api/delete/:game_id", must_be_logged_in, function (req, res) {\n\tif (game_ai_locks.has(req.params.game_id | 0)) return res.status(409).send("AI正在推进，请等待暂停后删除。")')
    r('\t\tSQL_DELETE_GAME_AI_TRACE.run(game_id, snap.replay_id)', '\t\tSQL_DELETE_GAME_AI_TRACE.run(game_id, snap.replay_id)\n\t\tRTT_LLM.rewind(game_id, snap.replay_id)')
    const insertTrace = '\t\tif (ai_trace) {\n\t\t\tSQL_INSERT_AI_TRACE.run(game_id, replay_id, ai_trace.bot_id, role,\n\t\t\t\tai_trace.policy_version, JSON.stringify(ai_trace.public_trace), JSON.stringify(ai_trace.private_trace))\n\t\t}\n'
    r(insertTrace, '')
    r('\t\tput_game_state(game_id, state, old_active, is_move)\n', '\t\tput_game_state(game_id, state, old_active, is_move)\n\t\tif (ai_trace && ai_trace.commit) ai_trace.commit(replay_id, state)\n' + insertTrace + '\t\tSQL_COMMIT.run()\n')
    const publish = '\t\tif (game_clients[game_id])\n\t\t\tfor (let other of game_clients[game_id])\n\t\t\t\tsend_state(other, state)\n\n\t\tif (is_nobody_active(state.active))\n\t\t\tsend_game_finished_notification_to_offline_users(game_id, state.result)\n\t\telse\n\t\t\tsend_your_turn_notification_to_offline_users(game_id, old_active, state.active)\n\n\t\tSQL_COMMIT.run()'
    r(publish, '\t\tif (game_clients[game_id])\n\t\t\tfor (let other of game_clients[game_id])\n\t\t\t\ttry { send_state(other, state) } catch (_) { console.log("STATE DELIVERY FAILED", game_id) }\n\n\t\ttry {\n\t\t\tif (is_nobody_active(state.active)) send_game_finished_notification_to_offline_users(game_id, state.result)\n\t\t\telse send_your_turn_notification_to_offline_users(game_id, old_active, state.active)\n\t\t} catch (_) { console.log("NOTIFICATION DELIVERY FAILED", game_id) }')
    r('function run_bot_turn(title_id, game_id, phase_step) {\n\ttry {', 'async function run_bot_turn(title_id, game_id, phase_step) {\n\tlet stopped = "已暂停在下一阶段边界。"\n\ttry {')
    r('setImmediate(() => run_bot_turn(title_id, game_id, phase_step))', 'setImmediate(() => run_bot_turn(title_id, game_id, phase_step).catch(err => console.log("BOT ASYNC ERROR", game_id, err.code || "ERROR")))')
    r('const bot_player = bot_players.find(player => is_role_active(state.active, player.role))', 'const bot_player = bot_players.find(player => is_role_active(state.active, player.role)\n\t\t\t\t&& (!bot_players.some(p => RTT_LLM.isLLM(p.bot_id)) || player.role === RTT_LLM.activeRole(state)))')
    r('if (!bot_player || !rules.bots[bot_player.bot_id]) return', 'if (!bot_player || (!rules.bots[bot_player.bot_id] && !RTT_LLM.isLLM(bot_player.bot_id))) return')
    r('const bot = rules.bots[bot_player.bot_id]\n', 'const bot = rules.bots[bot_player.bot_id] || { version: "eots-rtt-llm-v1" }\n')
    r('const decision = bot.decide(bot_view, { role: bot_player.role, seed, actionOrdinal: ordinal })', `const state_text = SQL_SELECT_GAME_STATE.get(game_id)
            const decision = RTT_LLM.isLLM(bot_player.bot_id) ? await RTT_LLM.decide({
                id: game_id, rules, state, role: bot_player.role, botId: bot_player.bot_id, revision: ordinal, options, seats: bot_players,
                stillCurrent: () => SQL_SELECT_GAME_STATE.get(game_id) === state_text
                    && SQL_SELECT_REPLAY_ORDINAL.get(game_id) === ordinal && RULES[title_id] === rules
                    && SQL_SELECT_BOT_PLAYER.all(game_id).some(p => p.role === bot_player.role && p.bot_id === bot_player.bot_id),
            }) : bot.decide(bot_view, { role: bot_player.role, seed, actionOrdinal: ordinal })`)
    r('\t\t\t\t\tprivate_trace: decision.privateTrace,', '\t\t\t\t\tprivate_trace: decision.privateTrace,\n\t\t\t\t\tcommit: decision.commit,')
    r('policy_version: bot.version,', 'policy_version: decision.version || bot.version,')
    r('if (is_nobody_active(state.active)) return\n\t\t\tconst bot_player', 'if (is_nobody_active(state.active)) { stopped = "对局已结束。"; return }\n\t\t\tconst bot_player')
    r('\t\tconsole.log("BOT ERROR", game_id, err)', '\t\tstopped = "阶段未完成，AI已暂停：" + (err.code || err.message)\n\t\tRTT_LLM.pause(game_id, err.code || "ERROR")\n\t\tconsole.log("BOT ERROR", game_id, err.code || err.message)')
    r('\t\t\tif (phase_step && bot_phase_marker(state) !== phase_marker) {', '\t\t\tif (is_nobody_active(state.active)) { stopped = "对局已结束。"; return }\n\t\t\tif (phase_step && bot_phase_marker(state) !== phase_marker) {')
    r('broadcast_bot_step(game_id, false, "已暂停在下一阶段边界。")', 'broadcast_bot_step(game_id, false, stopped)')
    r('function on_action(socket, action, args, cookie) {', 'function on_action(socket, action, args, cookie) {\n\tif (game_ai_locks.has(socket.game_id)) return send_message(socket, "error", "AI正在推进，请等待暂停。")')
    r('function do_resign(game_id, role, replay_action, message) {', 'function do_resign(game_id, role, replay_action, message) {\n\tif (game_ai_locks.has(game_id)) throw new Error("AI正在推进，请等待暂停。")')
})
patch("views/create_title.pug", r => {
    r('doctype html', '//- RTT-LLM-01\ndoctype html')
    for (const name of ["bot_id_jp", "bot_id_ap"])
        r('select(name="' + name + '")\n\t\t\t\t\t\t\teach bot, id in rules.bots\n\t\t\t\t\t\t\t\toption(value=id selected=(id === "erasmus-v2"))= bot.name',
          'select(name="' + name + '")\n\t\t\t\t\t\t\teach bot, id in aivai_bots\n\t\t\t\t\t\t\t\toption(value=id data-scenarios=JSON.stringify(bot.scenarios) selected=(id === "erasmus-v2"))= bot.name')
})
