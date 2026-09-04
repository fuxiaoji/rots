"use strict"
const rules=require("../rules.js"), bot=rules.bots["erasmus-v2"]
const fs=require("fs"),path=require("path"),charts=JSON.parse(fs.readFileSync(path.join(__dirname,"..","data","erasmus","charts.json"),"utf8"))
const known=new Map(charts.charts.map(c=>[c.id,new Set(c.nodes.map(n=>n.id))])),missing=[]
const scenario=process.argv[2]||"1942-1945 (The Shortened Campaign)", baseSeed=Number(process.argv[3]||20260903),games=Number(process.argv[4]||1)
let rows=[],nodeCounts={},totalActions=0,complete=0
const roleOf=s=>Array.isArray(s.active)?s.active.slice().sort()[0]:s.active
for(let game=0;game<games;game++){
 const seed=baseSeed+game
 let state=rules.setup(seed,scenario,{headless_moves:true}),ordinal=0
 while(state.active!=="None"&&ordinal<60000){
  const role=roleOf(state),view=rules.view(state,role),d=bot.decide(view,{role,seed,actionOrdinal:ordinal+1})
  if(d.publicTrace?.node)nodeCounts[d.publicTrace.node]=(nodeCounts[d.publicTrace.node]||0)+1
  const ks=known.get(d.publicTrace?.chart),np=d.publicTrace?.nodePath||[]
  if(!ks||np.some(n=>!ks.has(n)))missing.push({seed,ordinal:ordinal+1,chart:d.publicTrace?.chart,node:d.publicTrace?.node,nodePath:np,prompt:String(view.prompt||"").slice(0,100)})
  if(d.publicTrace?.fallback)rows.push({ordinal:ordinal+1,turn:view.turn,role,chart:d.publicTrace.chart,node:d.publicTrace.node,
    strategy:d.publicTrace.strategy,action:d.action,prompt:String(view.prompt||"").slice(0,120),legal:Object.keys(view.actions||{})})
  state=rules.action(state,role,d.action,d.argument);ordinal++
 }
 totalActions+=ordinal;if(state.active==="None")complete++
}
const groups={};for(const r of rows){const k=`${r.chart}|${r.prompt}|${r.action}`;groups[k]=(groups[k]||0)+1}
console.log(JSON.stringify({complete,games,actions:totalActions,fallbacks:rows.length,missingCount:missing.length,missingExamples:missing.slice(0,20),pbmNodes:Object.fromEntries(Object.entries(nodeCounts).filter(([k])=>/06-S-PBM|12-S-PBM/.test(k))),groups,
  examples:rows.filter((r,i)=>rows.findIndex(x=>x.chart===r.chart&&x.prompt===r.prompt&&x.action===r.action)===i)},null,2))
