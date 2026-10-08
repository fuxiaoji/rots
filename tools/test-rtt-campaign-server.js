"use strict"
// Isolated loopback RTT integration. No private model file or production database.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),cp=require("node:child_process")
const runtime=path.resolve(process.env.RTT_RUNTIME_ROOT||"D:/desktop/rots-runtime-pve"),Database=require(runtime+"/node_modules/better-sqlite3"),WebSocket=require(runtime+"/node_modules/ws"),port=8183
const dir=fs.mkdtempSync(path.resolve("tmp/campaign-v3-")),filename=path.join(dir,"db"),db=new Database(filename)
db.exec(fs.readFileSync(runtime+"/schema.sql","utf8"));db.exec("INSERT INTO users(user_id,name,mail) VALUES(2,'CampaignReleaseTest','campaign@invalid.test');INSERT INTO titles(title_id,title_name) VALUES('empire-of-the-sun','Empire of the Sun')")
const sid=db.prepare("INSERT INTO logins VALUES(abs(random())%(1<<48),2,julianday()+1) RETURNING sid").pluck().get()
let child;const call=(url,options={})=>fetch("http://localhost:"+port+url,{...options,headers:{cookie:"login="+sid},redirect:"manual"})
async function create(scenario,mode="aivai",human="Allies"){
 const form=new URLSearchParams({mode,scenario,human_role:human,bot_id:human==="Allies"?"erasmus-japan-campaign-v3":"erasmus-campaign-v3",bot_id_jp:"erasmus-japan-campaign-v3",bot_id_ap:"erasmus-campaign-v3",pace:"0"})
 const res=await call("/create/empire-of-the-sun",{method:"POST",body:form});assert.equal(res.status,302,await res.text());return Number(new URL(res.headers.get("location"),"http://localhost:"+port).searchParams.get("game"))
}
async function phase(id){const start=db.prepare("select count(*) n from game_replay where game_id=?").get(id).n,ws=new WebSocket(`ws://localhost:${port}/play-socket?title=empire-of-the-sun&game=${id}&role=Observer`,{headers:{cookie:"login="+sid}});let sent=false,detail
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.close();reject(Error("phase timeout"))},90000);ws.on("error",reject);ws.on("message",raw=>{const [type,value]=JSON.parse(String(raw));if(type==="state"&&!sent){sent=true;ws.send('["botstep"]')}if(type==="botstep"&&value.running===false){detail=value.detail;clearTimeout(timer);ws.close();resolve()}})})
 assert(detail.includes("阶段边界"),detail);const end=db.prepare("select count(*) n from game_replay where game_id=?").get(id).n;assert(end>start);const trace=db.prepare("select bot_id,policy_version from game_ai_trace where game_id=?").all(id);assert(trace.length);assert(trace.every(t=>["erasmus-japan-campaign-v3","erasmus-campaign-v3"].includes(t.bot_id)&&t.policy_version.endsWith(".3.0")));return {id,actions:end-start,traceRows:trace.length,detail}
}
async function main(){const probe=require("node:net").createServer();await new Promise((resolve,reject)=>{probe.once("error",reject);probe.listen(port,"localhost",()=>probe.close(resolve))});const env={...process.env,DATABASE:filename,HTTP_PORT:String(port),EOTS_LLM_ENV_FILE:""};for(const k of Object.keys(env))if(/API_KEY|EOTS_OPT_(PROFILE|PARAMS)/.test(k))delete env[k]
 child=cp.spawn(process.execPath,["server.js"],{cwd:runtime,env,windowsHide:true,stdio:"ignore"});for(let n=0;n<100;n++){try{if((await call("/")).status===200)break}catch{}await new Promise(r=>setTimeout(r,50))}
 const page=await call("/create/empire-of-the-sun"),html=await page.text();assert(html.includes("盟军战役 AI 3.0")&&html.includes("日军战役 AI 3.0"));const reports=[];for(const scenario of ["1942-1945 (The Shortened Campaign)","1943-1945 (The Even Shorter Campaign)"]){reports.push({scenario,...await phase(await create(scenario))})}
 const pve=[];for(const role of ["Japan","Allies"])pve.push({role,id:await create("1943-1945 (The Even Shorter Campaign)","pve",role)})
 const report={isolatedDatabase:true,actualRTTServer:true,port,phases:reports,pve,runtimeModelRequests:0,rulesSha256:require("node:crypto").createHash("sha256").update(fs.readFileSync(runtime+"/public/empire-of-the-sun/rules.js")).digest("hex")};fs.writeFileSync(path.resolve("research/ai-campaign-03/rtt-integration.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report))
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{if(child)child.kill();db.close()})
