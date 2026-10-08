"use strict"
const fs=require('fs'),path=require('path'),assert=require('assert'),{fileSha}=require('../tests/match-run');
const folder=path.resolve('research/ai-campaign-base1-01'),p1=path.join(folder,'validation-stage1.json'),p2=path.join(folder,'validation-stage2.json'),s1=JSON.parse(fs.readFileSync(p1)),s2=JSON.parse(fs.readFileSync(p2));
assert.equal(s1.totalGames,400);assert.equal(s2.totalGames,200);
for(const [s,name,expectedSides] of [[s1,'freeze-candidate.json',['Japan','Allies']],[s2,'freeze-stage2.json',['Allies']]]) {
    assert.equal(s.freezeSha256,fileSha(path.join(folder,name)),'stage freeze binding');
    assert.equal(s.cells.length,expectedSides.length*4);assert.equal(s.paired.length,expectedSides.length*2);
    assert.equal(new Set(s.cells.map(c=>[c.year,c.side,c.version].join(':'))).size,s.cells.length);
    assert.equal(new Set(s.paired.map(c=>[c.year,c.side].join(':'))).size,s.paired.length);
    assert(s.games.every(g=>expectedSides.includes(g.side)));assert.equal(s.games.length,s.totalGames);
    assert.equal(new Set(s.games.map(g=>[g.year,g.side,g.version,g.seed].join(':'))).size,s.totalGames);
    assert(s.cells.every(c=>c.candidateWins.n===50));assert(s.paired.every(p=>p.pairs.length===50));
}
const oldSeeds=new Set(s1.games.map(g=>g.seed));assert(s2.games.every(g=>!oldSeeds.has(g.seed)),'independent stages must have disjoint seeds');
for(const key of ['auditSha256','observerSha256','verifierOverlaySha256','supplyObserverSha256','nativeSupplySourceSha256','nativeSupplyFunctionSha256','combinedInstrumentationSha256']) {
    const values=[...s1.audits,...s2.audits].map(a=>a[key]);assert(values.every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)));assert.equal(new Set(values).size,1,'measurement inputs differ across stages');
}
const cells=[...s1.cells.filter(c=>c.side==='Japan').map(c=>({...c,stage:'stage1'})),...s2.cells.map(c=>({...c,stage:'stage2'}))],paired=[...s1.paired.filter(p=>p.side==='Japan').map(p=>({...p,stage:'stage1'})),...s2.paired.map(p=>({...p,stage:'stage2'}))],games=[...s1.games.map(g=>({...g,stage:'stage1'})),...s2.games.map(g=>({...g,stage:'stage2'}))];
const publicMapPath=path.resolve('js/common/data_map.js'),publicNames=new Map([...fs.readFileSync(publicMapPath,'utf8').matchAll(/\{\s*id:\s*(\d+),\s*name:\s*"([^"]+)"/g)].map(m=>[(Math.floor(Number(m[1])/100)-10)*29+Number(m[1])%100,{name:m[2],coordinate:Number(m[1])}])),keyName=hex=>{const m=publicNames.get(Number(hex));return m?m.name+' ['+m.coordinate+']':String(hex)};
const invalidDetails=games.filter(g=>!g.validNatural||!g.verified||g.error).map(g=>{
    let raw=null;
    if(g.auditPath) {assert.equal(fileSha(g.auditPath),g.auditSha256);const a=JSON.parse(fs.readFileSync(g.auditPath)),r=a.games.find(x=>x.seed===g.seed);if(r?.gamePath){assert.equal(fileSha(r.gamePath),g.gameSha256);raw=JSON.parse(fs.readFileSync(r.gamePath));}}
    const reason=String(raw?.error || g.error || 'Fallback or nonnatural termination');
    return {stage:g.stage,year:g.year,side:g.side,version:g.version,seed:g.seed,status:raw?.status || 'missing',validNatural:g.validNatural,verified:g.verified&&!g.error,reason:reason.split('\n')[0],caller:reason.includes('baseline-1c3709e.js:33819:40')?'frozen Japan1.0':reason.includes('candidate-korean-pbm-dev6.js')?'candidate bundle':'unclassified',errorTextSha256:require('crypto').createHash('sha256').update(reason).digest('hex')};
});
const errataPath=path.join(folder,'freeze-stage2-errata.json'),errata=JSON.parse(fs.readFileSync(errataPath));assert.equal(errata.freezeStage2Sha256,fileSha(path.join(folder,'freeze-stage2.json')));
const summary={invalidDetails,koreanEnemyCutDiagnosisSha256:fileSha(path.join(folder,'korean-enemy-cut-diagnosis.json')),stage2FreezeErrataSha256:fileSha(errataPath),publicMapSourceSha256:fileSha(publicMapPath),task:s1.task,generatedAt:new Date().toISOString(),totalGames:600,stages:[{stage:'stage1',totalGames:400,path:p1,sha256:fileSha(p1),sourceCommit:'3890b15',alliesPBMImplementationGap:true},{stage:'stage2',totalGames:200,path:p2,sha256:fileSha(p2),sourceCommit:'580d36c',alliesPBMImplementationGap:false}],selection:'latest Allies stage2 N50, unchanged Japan stage1 N50; no pooling stages; all600 attempts retained',allFullHashVerified:games.every(g=>g.verified&&!g.error),strictNaturalVerified:games.filter(g=>g.validNatural&&g.verified&&!g.error).length,runtimeModelRequests:0,runtimeModelLatencyMs:0,externalApiCost:0,nativeCodexCost:'unknown',cells,paired,games};
const out=path.join(folder,'validation.json');fs.writeFileSync(out,JSON.stringify(summary,null,2)+'\n');
const pct=x=>x===null||x===undefined?'无样本':(x*100).toFixed(1)+'%',cell=(y,side,v)=>cells.find(c=>c.year===y&&c.side===side&&c.version===v),tab=(heads,rows)=>['| '+heads.join(' | ')+' |','| '+heads.map(()=>'---').join(' | ')+' |',...rows.map(r=>'| '+r.join(' | ')+' |')].join('\n'),ratio=r=>`${r.n}/${r.d}`,route=end=>/blockade/i.test(end)?'封锁':/atomic/i.test(end)?'原子弹':/mainland/i.test(end)?'本土占领':/hq|headquarter/i.test(end)?'消灭HQ':end;
const rows=paired.map(p=>{const b=cell(p.year,p.side,'before'),c=cell(p.year,p.side,'candidate');return [p.year,p.side==='Allies'?'盟军':'日军',p.stage,`${b.candidateWins.successes}/50（${pct(b.candidateWins.estimate)}）`,`${c.candidateWins.successes}/50（${pct(c.candidateWins.estimate)}）`,(p.delta>0?'+':'')+pct(p.delta),`${p.gained}/${p.lost}`,`${pct(c.candidateWins.low)}–${pct(c.candidateWins.high)}`]}),ap=['1942','1943'].map(y=>cell(y,'Allies','candidate')),wins=ap.flatMap(c=>c.candidateWinDetails.map(w=>({...w,year:c.year}))),met=ap.every(c=>c.candidateWins.successes>=20),invalid=games.filter(g=>!g.validNatural||!g.verified||g.error),nationName={philippines:'菲律宾',malaya:'马来亚',dei:'荷属东印度',burma:'缅甸'};
const behaviors=paired.map(p=>{const b=cell(p.year,p.side,'before'),c=cell(p.year,p.side,'candidate');return [p.year,p.side==='Allies'?'盟军':'日军',p.stage,`${b.central.guardedActualLandings}→${c.central.guardedActualLandings}`,`${b.central.guardedCaptured.n}→${c.central.guardedCaptured.n}`,`${b.koreanSupply.gamesEverSteadyOos}/${b.koreanSupply.gamesWithKoreanGround}→${c.koreanSupply.gamesEverSteadyOos}/${c.koreanSupply.gamesWithKoreanGround}`,`${b.earlyPalauCaptures.physicalEmpty}→${c.earlyPalauCaptures.physicalEmpty}`,`${ratio(b.pow)}→${ratio(c.pow)}`]}),nations=paired.flatMap(p=>{const b=cell(p.year,p.side,'before'),c=cell(p.year,p.side,'candidate');return b.nations.map(n=>{const after=c.nations.find(x=>x.name===n.name);return [p.year,p.side==='Allies'?'盟军':'日军',nationName[n.name]||n.name,p.side==='Allies'?`${ratio(n.liberated)}→${ratio(after.liberated)}`:`${n.newSurrenderGames}/50→${after.newSurrenderGames}/50`,Object.entries(after.missingAlliedKeyFrequency).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([hex,n])=>`${keyName(hex)}:${n}局`).join('；')]})});
const report=`# 双方战役 AI 改进：对冻结 1.0 的评估

AI-CAMPAIGN-BASE1-01 · 2026-10-08 · 累计600正式尝试，开发220局另列。

## 最新结果

${tab(['剧本','候选阵营','阶段','改进前对同一1.0对手','最新候选对同一1.0对手','配对差','新增胜/丢失胜','最新95% Wilson区间'],rows)}

每格分母固定50。盟军主结论来自修补后stage2；日军策略和对手均未变，采用stage1。各阵营在独立的比赛中对另一阵营原1.0，不能相加为同一场互打胜率。改进前盟军为1942 2.1/1943 2.2-dev5，日军2.1；最新盟军2.3-dev5，日军2.2。

完整动作和终态哈希回放 ${games.filter(g=>g.verified&&!g.error).length}/600；严格自然有效 ${summary.strictNaturalVerified}/600。原日军1.0无合法出口的异常按种子/阶段单列，不能静默更换冻结对手。失败/未结束/fallback/回放失败保留分母且不计胜。${met?'两个剧本盟军观察胜率均达到40%，但样本区间不能证明真实胜率下界达到40%。':'盟军两个剧本尚未同时达到40%，长期胜率目标仍待改进。'} 配对新增/丢失胜包括含无效局的非胜转换，JSON另列严格有效配对和无效对数。相同初始种子不保证不同策略消费相同未来随机事件。

**1943日军1.0超出原声明剧本。** 该对手在headless直接调用原ID，旧战役规划器旁路，运行原Erasmus profile；1943盟军行属于实验性对照，不能称原1.0南征规划器正式支持1943。1943日军候选对原盟军1.0则原本支持该剧本。

## 最新盟军怎么赢

${tab(['剧本','本土占领','原子弹','封锁','消灭HQ','合计'],ap.map(c=>{const ws=wins.filter(w=>w.year===c.year);return [c.year,...['本土占领','原子弹','封锁','消灭HQ'].map(r=>ws.filter(w=>route(w.end)===r).length),ws.length]}))}

${tab(['剧本','种子','回合','正式胜法','日军剩余资源','PW'],wins.map(w=>[w.year,w.seed,w.turn,route(w.end),w.resources,w.pw]))}

## 关键行为

${tab(['剧本','候选阵营','阶段','中央有守軍实际登陆','这些登陆曾夺取','韩国取消临时供给后曾有OOS局/韩国驻军局','截至T5（含T5）帕劳空实驻军失守事件','PoW达标检查'],behaviors)}

中央为7点、真实AA路径和实际地面位置，守军含虚拟城市守备。韩国分母只包括实际韩国己方驻军的已完整回放局；指标是逐动作取消临时激活供给的断补风险，包含攻势中间状态，不能称战后持续OOS或实际损耗。未去韩国不能算供给成功。候选阵营为日本时，中央/韩国/PoW描述冻结盟军对手；帕劳/下表守备描述日本。含非自然局的合法已回放前缀可参与行为统计，其观察完成/严格自然数在JSON单列。

${tab(['剧本','候选阵营','T6起（含T6）日控无实驻軍/日控地点快照','日军控制率'],paired.map(p=>{const b=cell(p.year,p.side,'before').guardsT6Plus,c=cell(p.year,p.side,'candidate').guardsT6Plus;return [p.year,p.side==='Allies'?'盟军':'日军',`${ratio(b.friendlyEmpty)}→${ratio(c.friendlyEmpty)}`,`${pct(b.japanControl.rate)}→${pct(c.japanControl.rate)}`]}))}

14地点在首选牌窗抽样，同局快照相关。敌控格不要求日本驻军；空驻军率与控制率分别看，T6起数据不能掩盖早期漏防。

${tab(['剧本','候选阵营','国家','盟军正式解放/曾投降局；日军新迫降/50','盟军在记录结束时未控（含异常前缀；地点:局数）'],nations)}

候选为日军时，末记录盟军未控格描述冻结盟军对手；候选为盟军时描述候选本身。国家事件来自原native national-status正式返回与标记变化，控制全部要求格不等于提前宣布投降。1943初始投降不算日军新迫降，盟军解放分母为确曾投降局。关键格统计所有已观察局，原始名称/地图ID和其他国家细节见JSON。

## 韩国问题与修改

- 登陆前检查整支登陆地面军，移除临时激活供应，调用原完整补给函数；失败就拒绝该登陆，headless委托和巡航走同一门。
- 自动战后移动及合法支援定位使用真实棋子数字u/id，实际编组和HQ定位进入公开局面投影；优先不新增韩国驻军OOS。所有落点有风险时仍选合法最小风险动作，不越过引擎候选。
- 支援准备飞机必须在当前己方落点独立有供给，不能依靠未来占韩国给自身供给。台湾/冲绳不是规则硬前置；目标是兼容HQ范围与中性化海上补给线。
- 两卡集结以实际后续己方牌/HQ与合法STRAT验证；单HQ自动选择保留计划；真实轰击减员后续同目标登陆；当前保持PoW额度足够才有限释放守軍。早期帕劳缺驻军且来源有余兵时低成本补防，已抵达GROUND调防以合法stop结束。

真实旧63927 T11澳军205登陆釜山，快缓存未标OOS而稳态重算OOS：附近美军HQ不兼容，英/联合HQ太远。旧63812三个点未先取台湾/冲绳仍能供给，说明两岛不是硬性规则。

42产品+2离线检查通过；1.0再次116窗口/3478历史动作决定及完整哈希兼容。修补新开发4局全部自然合法完整回放，构造raw接口、两CV同时撤离、HQ/air/BB领队、多风险出口仅为行为检查，不计独立胜率。默认海军PBM逐舰，多舰测试不是多舰自然对局证明。

条件性占领投影假设目标守军已离开，未模拟敌军实际退却后的ZOI或未来行动；可供给不保证持续安全。未新增完整英国HQ迁移规划器，正常攻势支援单位离位的更广泛保护仍是后续检查范围。

最新1943四个首次风险（20264508/10/16/23）均在日本advance动作发生：翔鹤到首尔、4th Air Division到首尔、10th Air Division到京都、51st Air Flotilla到佐世保。合法前缀重建和只读native查询证实每次立即之前有供给、之后断线；不是这些四例的初始无供给登陆或己方PBM撤走。不能据此证明所有己方离位都已受保护，也不证明未来敌军切线已被防住。见[公开前缀诊断](korean-enemy-cut-diagnosis.json)。

1942条约败由1局增至7局，PoW达标检查253/353→238/347；1943软化宣战22→57、目标守军CF下降16→46，但中央有守军仅2次登陆、0次夺取，封锁胜0、仅4局启动且最多完成2段。胜率与这些行为指标需要一起看，当前没有消融证据把得失归因单一机制。

## 阶段与追溯

stage1共400：规则包reference3de6cbed、JP425b0e8a/APcc048d56，源码3890b15，种子20264201–50/20264301–50。其盟军1942观察胜率70%→58%，1943为14%→16%；其AP PBM原始字符串ID漏接导致保护跳过，旧人工数字ID测试掩盖；结果全部保留在[第一阶段报告](results-stage1.md)与[数据](validation-stage1.json)，不能称修补后效果。

stage2共200：原1.0包不变，APe58b21a2、源码580d36c，种子20264401–50/20264501–50；新种子在实际接口修补、行为/兼容/开发验收后冻结，策略未根据该批结果追改。改进后出现局部行为提升或超过40%，也不等于整体优于改进前；胜率下降要与行为指标一起保留。主结论不合并不同阶段AP为N100，不能用不同种子stage1候选→stage2候选的差归因PBM修补。两个冻结文件与各角色实际包/版本/profile/环境/哈希均归档。stage2原冻结文件中两项继承stage1的附属时间/开发摘要字段，已用[元数据勘误](freeze-stage2-errata.json)明确实际stage2证据；原冻结hash保持不改。

${invalidDetails.length?tab(['阶段','剧本','候选阵营','版本','种子','原因','出错调用方','回放通过'],invalidDetails.map(g=>[g.stage,g.year,g.side,g.version,g.seed,g.reason,g.caller,g.verified])):'600局全部严格自然有效。'}

${tab(['剧本','候选阵营','含无效局配对数','双方均有效配对：新增胜/丢失胜'],paired.map(p=>[p.year,p.side,p.invalidInPair,`${p.strictValidGained}/${p.strictValidLost}`]))}

运行时LLM/外部API请求0、模型请求等待0ms、外部API费用0；原生Astra high/Sol high只读审查实际模型/用量/成本未暴露记unknown。12进程低优先级，本地竞争下程序耗时按cell记录，不据此称性能改善。

${tab(['剧本','候选阵营','版本','阶段','每局程序耗时中位秒'],cells.map(c=>[c.year,c.side,c.version,c.stage,c.elapsedMs.median===null?'无样本':(c.elapsedMs.median/1000).toFixed(1)]))}
开发220局另列，中断dev3未完成不算胜。共享LLM/半LLM、RTT与线上未修改、未发布。

[最终数据](validation.json)包含完整种子、各阶段/角色哈希、结束原因、配对与重要指标；详细原始回放和观察存tmp固定路径并绑定SHA。报告工具SHA256 ${fileSha(__filename)}，最终JSON SHA256 ${fileSha(out)}。
`;
fs.writeFileSync(path.join(folder,'results.md'),report);console.log(JSON.stringify({total:600,fullHash:summary.allFullHashVerified,strictNatural:summary.strictNaturalVerified,alliesBothObserved40:met,comparisons:rows}));
