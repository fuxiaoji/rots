"use strict"
// AI-CAMPAIGN-03: bounded, idempotent correction of existing PvE seat validation.
const fs=require("node:fs"),path=require("node:path")
const runtime=path.resolve(process.argv[2]||"../rots-runtime-pve"),file=path.join(runtime,"server.js"),original=fs.readFileSync(file,"utf8")
const normalized=original.replace(/\r\n/g,"\n")
const from='\t\tif (!bot || !bot.scenarios.includes(scenario) || !bot.roles.includes(human_role) || roles.length !== 2)\n\t\t\treturn res.status(400).send("Invalid PvE configuration.")\n\t\tconst bot_role = roles.find(role => role !== human_role)'
const to='\t\t// AI-CAMPAIGN-03: validate the bot seat, including faction-specific campaign bots.\n\t\tconst bot_role = roles.find(role => role !== human_role)\n\t\tif (!bot || roles.length !== 2 || !roles.includes(human_role) || !bot.scenarios.includes(scenario) || !bot.roles.includes(bot_role))\n\t\t\treturn res.status(400).send("Invalid PvE configuration.")'
if(normalized.includes(to)){console.log("campaign PvE seat validation: already installed");process.exit(0)}
if(normalized.split(from).length!==2)throw Error("Missing or ambiguous PvE seat validation anchor")
fs.writeFileSync(file+".before-campaign-v3",original,{flag:"wx"})
fs.writeFileSync(file,normalized.replace(from,to));console.log("campaign PvE seat validation: installed")
