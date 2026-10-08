"use strict"
// AI-ALLIES-40-01: every recorded game remains in denominator; verify complete legal replay.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto")
const {verifyReplay,fileSha}=require("../tests/match-run"),{wilson}=require("../tests/campaign-metrics")
const [root,prefix,output]=process.argv.slice(2);if(!output)throw Error("root directory-prefix output required")
const games=[];for(const dir of fs.readdirSync(root).filter(d=>d.startsWith(prefix)&&fs.statSync(path.join(root,d)).isDirectory())){
 for(const name of fs.readdirSync(path.join(root,dir)).filter(f=>f.startsWith("game-")&&f.endsWith(".json")&&!f.endsWith(".replay.json"))){
  const file=path.join(root,dir,name),g=JSON.parse(fs.readFileSync(file)),replayPath=file.replace(/\.json$/,".replay.json");let verification=null,error=null
  try{verification=verifyReplay(JSON.parse(fs.readFileSync(replayPath)),{replayPath})}catch(e){error=e.message}
  games.push({seed:g.seed,scenario:g.scenario,status:g.status,winner:g.winner,end:g.won_text,validNatural:g.validNatural,verified:!!verification?.verified,verification,error,turn:g.turn,actions:g.actions,jpResources:g.jpResources,politicalWill:g.politicalWill,elapsedMs:g.elapsedMs,gamePath:file,replayPath,replaySha256:fs.existsSync(replayPath)?fileSha(replayPath):null,metadata:g.metadata})
  console.log(JSON.stringify({seed:g.seed,winner:g.winner,verified:!!verification?.verified,error}))
 }
}
const summaries=["1942","1943"].map(year=>{const gs=games.filter(g=>g.scenario.startsWith(year)),valid=gs.filter(g=>g.validNatural&&g.verified),wins=valid.filter(g=>g.winner==="Allies");const n=gs.length,k=wins.length,z=1.959963984540054,p=n?k/n:0,c=n?(p+z*z/(2*n))/(1+z*z/n):null,h=n?z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/(1+z*z/n):null;return {scenario:year,n,valid:valid.length,wins:k,rate:n?k/n:null,wilson95:n?[c-h,c+h]:null,endings:Object.fromEntries([...new Set(gs.map(g=>g.end))].map(e=>[e,gs.filter(g=>g.end===e).length])),meanElapsedMs:n?gs.reduce((a,g)=>a+g.elapsedMs,0)/n:null}})
const report={task:"AI-ALLIES-40-01",prefix,auditSha256:fileSha(__filename),runnerSha256:fileSha(require.resolve("../tests/match-run")),summaries,games,runtimeModelRequests:0,externalApiCost:0};fs.writeFileSync(output,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(summaries))
