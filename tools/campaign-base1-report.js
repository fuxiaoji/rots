"use strict"
const fs=require('fs'),path=require('path'),{fileSha}=require('../tests/match-run'),folder=path.resolve('research/ai-campaign-base1-01'),input=path.join(folder,'validation-stage1.json'),s=JSON.parse(fs.readFileSync(input)),cell=(y,side,v)=>s.cells.find(c=>c.year===y&&c.side===side&&c.version===v),percent=x=>x===null||x===undefined?'无样本':(x*100).toFixed(1)+'%',rate=c=>`${c.candidateWins.successes}/50（${percent(c.candidateWins.estimate)}）`,ratio=r=>`${r.n}/${r.d}`,table=(heads,rows)=>['| '+heads.join(' | ')+' |','| '+heads.map(()=>'---').join(' | ')+' |',...rows.map(r=>'| '+r.join(' | ')+' |')].join('\n'),sum=xs=>xs.reduce((a,b)=>a+b,0),route=end=>/blockade/i.test(end)?'封锁':/atomic/i.test(end)?'原子弹':/mainland/i.test(end)?'本土占领':/hq|headquarter/i.test(end)?'消灭HQ':end;
const comparisons=s.paired.map(p=>{const b=cell(p.year,p.side,'before'),c=cell(p.year,p.side,'candidate');return [p.year,p.side==='Allies'?'盟军':'日军',rate(b),rate(c),(p.delta>0?'+':'')+percent(p.delta),`${p.gained} / ${p.lost}`,`${percent(c.candidateWins.low)}–${percent(c.candidateWins.high)}`]}),candidates=['1942','1943'].map(y=>cell(y,'Allies','candidate')),wins=candidates.flatMap(c=>c.candidateWinDetails.map(w=>({...w,year:c.year}))),routeRows=['1942','1943'].map(y=>{const ws=wins.filter(w=>w.year===y);return [y,...['本土占领','原子弹','封锁','消灭HQ'].map(r=>ws.filter(w=>route(w.end)===r).length),ws.length]}),keyRows=s.paired.map(p=>{const b=cell(p.year,p.side,'before'),c=cell(p.year,p.side,'candidate');return [p.year,p.side==='Allies'?'盟军':'日军',`${b.central.guardedActualLandings} → ${c.central.guardedActualLandings}`,`${b.central.guardedCaptured.n} → ${c.central.guardedCaptured.n}`,`${b.koreanSupply.gamesEverSteadyOos}/${b.koreanSupply.gamesWithKoreanGround} → ${c.koreanSupply.gamesEverSteadyOos}/${c.koreanSupply.gamesWithKoreanGround}`,`${b.earlyPalauCaptures.physicalEmpty} → ${c.earlyPalauCaptures.physicalEmpty}`,`${ratio(b.pow)} → ${ratio(c.pow)}`]}),nationalRows=s.paired.flatMap(p=>{const b=cell(p.year,p.side,'before'),c=cell(p.year,p.side,'candidate');return b.nations.map(n=>{const m=c.nations.find(x=>x.name===n.name);return [p.year,p.side==='Allies'?'盟军':'日军',n.name,p.side==='Allies'?`${n.liberated.n}/${n.liberated.d} → ${m.liberated.n}/${m.liberated.d}`:`${n.newSurrenderGames}/50 → ${m.newSurrenderGames}/50`]})}),guardRows=s.paired.map(p=>{const b=cell(p.year,p.side,'before').guardsT6Plus,c=cell(p.year,p.side,'candidate').guardsT6Plus;return [p.year,p.side==='Allies'?'盟军':'日军',`${ratio(b.friendlyEmpty)} → ${ratio(c.friendlyEmpty)}`,`${percent(b.japanControl.rate)} → ${percent(c.japanControl.rate)}`]}),allMet=candidates.every(c=>c.candidateWins.successes>=20),allVerified=s.allFullHashVerified&&s.allStrictNatural;
const text=`# 双方战役 AI：冻结 1.0 配对评估

任务 AI-CAMPAIGN-BASE1-01 · 2026-10-08 · 正式400局，开发216局另列。

## 结果

${table(['剧本','候选阵营','改进前对照','改进后候选','配对胜率差','新增胜 / 丢失胜','候选95% Wilson区间'],comparisons)}

每行改进前后各50局对同一冻结1.0对手，共400局。${allVerified?'全部自然合法终局、逐动作合法性与完整终态哈希回放通过。':`完整回放通过${s.games.filter(g=>g.verified&&!g.error).length}/400，严格自然有效${s.games.filter(g=>g.validNatural&&g.verified&&!g.error).length}/400；失败/未结束仍保留50分母，不能计胜。`}

盟军两个剧本的候选观察胜率${allMet?'均达到40%，但样本区间不能证明真实胜率下界达到40%。':'尚未同时达到40%，长期胜率目标保持待改进。'} 开发种子曾重复调试，正式预留种子冻结后一次运行，策略未按验证结果追改。配对新增/丢失胜包含无效样本的非胜转换；各配对的有效标记、双方均有效时胜负转换与含无效配对数另存JSON，不把无效样本称战败。固定种子保证初始条件配对，不保证不同策略消费相同后续随机事件。

**1943日军1.0不在原允许剧本中。** AP1943仅本地headless直接调用原ID；旧campaign planner在非1942旁路，运行其原Erasmus profile。该行是实验性对照，不能称官方支持的日军1.0战役规划器。JP1943对手盟军1.0则原本支持该剧本。

## 盟军候选怎么赢

${table(['剧本','本土占领','原子弹','封锁','消灭HQ','合计'],routeRows)}

${table(['剧本','种子','回合','正式胜法','日军剩余资源','PW'],wins.map(w=>[w.year,w.seed,w.turn,route(w.end),w.resources,w.pw]))}

## 关键行为数据

${table(['剧本','候选阵营','中央7点有守军实际登陆','这些登陆曾夺取','韩国稳态OOS局 / 有韩国驻軍局','截至T5（含T5）帕劳空驻军失守事件','PoW达标检查'],keyRows)}

每项都是同一冻结1.0对手下的改进前→后。中央登陆、韩国OOS、PoW均为盟军行为；守军与控制率均为日军行为。候选阵营为日军时，前者描述其冻结盟军对手。中央登陆以引擎AA路径及实际位置确认，守军含规则生成城市守备；纯海空宣战不计登陆。韩国OOS按原完整补给函数、取消临时激活补给独立重算，分母为出现韩国己方实驻军的已验证局；这是“逐动作公开局面取消临时供应后曾出现断补风险”的局数，包含攻势中的中间局面，不能称攻势结束后的持续断补或实际耗损，不能当逐单位逐回合率。未去韩国的局不能当韩国供给成功。

${table(['剧本','候选阵营','T6+日控地点无实驻军 / 日控地点快照','日军控制率'],guardRows)}

14关键地点、每阵营首选牌窗口快照；同局快照相关，不能当独立样本。控制率下降与空驻军减少必须分开解释，敌控地点不要求日本驻军。T6+不能掩盖早期帕劳问题。

${table(['剧本','候选阵营','国家','盟军正式解放 / 曾投降局；日军新迫降 / 50局'],nationalRows)}

国家结果取正式national-status退出及标记变化；控制全部要求格不是提前改写投降。1943初始已投降不计日本新迫降；盟军解放分母为该国家初始或后来确已投降的局数。行为观察局数/严格有效数/非严格数：${s.cells.map(c=>`${c.year}/${c.side}/${c.version}=${c.fullHashVerified}/${c.observedStrictValidGames}/${c.observedNonStrictGames}`).join("；")}。各格缺口、正式事件、中央地点、封锁计时/重置、计划与截断阻断、ASP和胜局详情见[validation.json](validation-stage1.json)。

## 修改与定点验收

- AP2.3：真实下一张己方牌/HQ验证分港陆军舰队的两卡集结；单HQ自动选择后保留原计划；轰击实际减员后优先同目标登陆；仅当前保持PoW额度足够时有限释放资源守軍，不降低战斗概率门槛。
- JP2.2：1942 T4前空帕劳、来源还有其他地面军时优先低成本补防，早期帕劳公开敌军观察半径14，其余地点/回合仍8；特定已到目标的GROUND调防用合法stop收尾。
- 韩国登陆前移除临时激活供应，调用原完整native补给函数。失败编队不登陆，委托headless/cruise同门；stage1 的 PBM wrapper 因原始棋子字符串ID跳过，不能声称本批已验证攻后支援保护；补漏版本与独立新种子结果另列。
- 准备飞机必须在当前合法落点独立有补给，并确能改善条件性后续登陆，避免靠未来夺韩国才能补给的循环。AP新空军screen显式native重算后检查原日本资源trace；旧调用、默认快缓存及游戏裁定不变。

真实旧63927 T11澳军205登陆釜山，旧缓存未标OOS，完整稳态重算却OOS；附近美军HQ补给类型不兼容、英/联合HQ太远，即使舰队仍在港也无效。63812三个保存点未先取台湾/冲绳仍供给，证明两岛不是规则硬前置。原构造CV测试人工赋数字ID掩盖生产漏检；修正版改用raw实际接口，7韩国检查通过，构造检查不计胜。

条件性攻占预测假设目标守军已离开，不模拟其实际撤退后的ZOI或未来敌方动作；成功投影不保证持续安全。未新增完整英国HQ迁移规划器。40项相关本地JS检查通过，原1.0 116决策窗口/3478历史动作兼容与完整终态哈希一致。此前开发版真实Manila反事实续打244动作夺取Manila、最终仍日本胜，按其保存代码哈希单列，不能混算本批独立胜局。

## 冻结、成本与范围

源码提交3890b15。固定1.0包3de6cbed，候选JP425b0e8a/APcc048d56；实际每角色包/版本/配置/规则哈希/种子/自然结束原因和回放完整性均归档。1942种子20264201–50，1943 20264301–50；改进前JP2.1，AP1942 2.1/AP1943 2.2-dev5；正式400局各cell分母50。开发216局合法全哈希；中断dev3无完成局，记录保留，不补造胜率。

运行时模型/外部API请求0、外部API费用0。各cell游戏程序耗时${s.cells.map(c=>`${c.year}/${c.side}/${c.version}中位${c.elapsedMs.median===null?'无样本':(c.elapsedMs.median/1000).toFixed(1)+'s'}`).join('；')}。并发12且低优先级，程序耗时含本地竞争，不据此声称性能优化。原生Astra high/Sol high只读审查，实际模型/用量/成本未暴露记unknown，用户local-only偏好持续。

本轮隔离分支改进与评测；共享LLM/半LLM、RTT/线上服务未动，未部署/推送。完整原始动作及离线详细审计保存在忽略的tmp，仓库记录哈希与固定路径；摘要工具SHA256 ${fileSha(__filename)}，验证JSON SHA256 ${fileSha(input)}。
`;
fs.writeFileSync(path.join(folder,'results-stage1.md'),text);console.log(JSON.stringify({allVerified,alliesBothObserved40:allMet,rows:comparisons,wins:wins.length}));
