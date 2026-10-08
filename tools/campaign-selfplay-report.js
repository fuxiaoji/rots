"use strict"
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{fileSha}=require('../tests/match-run'),folder=path.resolve('research/ai-campaign-eval-50-01'),s=JSON.parse(fs.readFileSync(path.join(folder,'summary.json'))),freeze=JSON.parse(fs.readFileSync(path.join(folder,'freeze.json'))),p=x=>(100*x).toFixed(1)+'%',r=x=>x.d?`${x.n}/${x.d}（${p(x.rate)}）`:'不适用',a=s.scenarios['1942'],b=s.scenarios['1943'],name={Tainan:'台南',Taihoku:'台北',Okinawa:'冲绳','Iwo Jima':'硫磺岛',Saipan:'塞班',Guam:'关岛',Palau:'帕劳',Truk:'特鲁克',Eniwetok:'埃尼威托克',Kwajalein:'夸贾林',Seoul:'首尔',Pusan:'釜山',Manila:'马尼拉',Davao:'达沃'},nation={philippines:'菲律宾',malaya:'马来亚',dei:'荷属东印度',burma:'缅甸'},route=e=>/mainland/.test(e)?'本土占领':/atomic/.test(e)?'原子弹':/blockade/.test(e)?'封锁':e;
const table=(heads,rows)=>'| '+heads.join(' | ')+' |\n| '+heads.map(()=>'---').join(' | ')+' |\n'+rows.map(row=>'| '+row.join(' | ')+' |').join('\n');
const report=`# 改进双方战役AI：1942 / 1943各50局

任务 AI-CAMPAIGN-EVAL-50-01 · 2026-10-07 · 冻结新种子100局，本地评测完成。

## 结果

${table(['剧本 / 盟军配置','盟军严格有效胜 / 全部尝试','日军严格有效胜','未达研究验收门槛','盟军95% Wilson区间'],[['1942 / 2.1',r({n:18,d:50,rate:.36}),32,0,'24.1%–49.9%'],['1943 / 2.2-dev5',r({n:3,d:50,rate:.06}),46,1,'2.1%–16.2%']])}

两个剧本都没有达到本批观察胜率40%。日军均为2.1。100局均自然结束，100局逐动作合法性与完整终态哈希回放通过。1943种子20263931的日军动作972触发JP05-FALLBACK并执行合法stop一次，故排除其正式胜局；它是未达严格策略验收门槛的样本，不能称非法棋局，也没有替换重打。各剧本分母始终50。行为诊断使用100局完整验证回放，包含这1局并明确标记。

双方同时改进、盟军两剧本配置不同，不能将本批与旧日军2.0的17/32、6/32直接作因果比较，也不能合并两剧本声称达到40%。

## 盟军都如何获胜

${table(['剧本','本土占领','封锁','原子弹','本土胜回合'],[['1942',18,0,0,'T8×1、T9×3、T10×6、T11×4、T12×4'],['1943',2,0,1,'T11×2；原子弹T12']])}

1942日军32胜中，30局拖到T12日本未投降，2局条约谈判胜。1943日军46个正式胜局全部日本未投降；另1局同样日本未投降但有fallback，单列。

1943两场本土胜为20263907、20263917，均没有对有陆军的中央7点实际登陆。说明绕过强点能形成合法胜路，不能强制每局攻打所有中央岛。原子弹胜20263921在T12日本仅剩首尔1个资源格，T9起连续战略轰炸、B29在东京范围，正式原子弹条件满足；该局T7解放缅甸、T8马来亚、T11荷属东印度。

### 全部21场盟军正式胜局

${table(['种子','终局','胜法','日军资源格','中央7点登陆 / 有守军登陆'],[...a.winners,...b.winners].map(w=>[w.seed,'T'+w.turn,route(w.end),w.resources,w.centralLandings+' / '+w.guardedCentralLandings]))}

## 日军守备：能持续驻军，早期帕劳仍漏防

固定观察14格，每回合双方各自首次选牌窗采样一次；“友控缺军率”分母只含日控窗口，“控制率”另列，避免失去岛屿后缺军率虚假变好。实兵不包含城市固有守军。格×窗口高度相关，不能当独立样本计算对局置信区间。

${table(['观察','1942','1943'],[['T5以后日控率',r(a.guardsT5Plus.japanControl),r(b.guardsT5Plus.japanControl)],['T5以后日控但无实兵',r(a.guardsT5Plus.friendlyEmpty),r(b.guardsT5Plus.friendlyEmpty)],['T6以后日控率',r(a.guardsT6Plus.japanControl),r(b.guardsT6Plus.japanControl)],['T6以后日控但无实兵',r(a.guardsT6Plus.friendlyEmpty),r(b.guardsT6Plus.friendlyEmpty)]])}

1943 T5是初始部署窗，不能把初始空岛当整局持续不防。T6后总体缺军很少；但1942帕劳35次被夺，进攻前全部无实体守军，T6以后帕劳日控窗口仅28.9%，是早期守备时机问题。1942埃尼威托克22次被夺中16次攻击前空实兵。不能只看到后期剩余岛都驻军就宣布漏防完全解决。

${table(['地点','1942 T6+日控率 / 日控缺军率','1943 T6+日控率 / 日控缺军率','被盟军夺取次数 1942 / 1943'],a.guardsT6Plus.bySite.map((t,i)=>[name[t.name],p(t.control.rate)+' / '+p(t.friendlyEmpty.rate),p(b.guardsT6Plus.bySite[i].control.rate)+' / '+p(b.guardsT6Plus.bySite[i].friendlyEmpty.rate),a.guardCaptures.bySite[i].captures+' / '+b.guardCaptures.bySite[i].captures]))}

1942日军使菲律宾、马来亚各50局正式投降，但荷属东印度仅3/50、缅甸0/50。后期驻防做到了，南征完成度仍不足；是否由守备资源挤占导致，必须另作冻结对手下的单项对照，当前批次不能证明因果。

## 盟军中央攻势：会攻坚，但1943启动不足

中央固定7处：帕劳、乌利西、塞班、关岛、特鲁克、埃尼威托克、夸贾林。硫磺岛、冲绳在守备表但不在这一攻势集合。一次“攻势×目标”去重；实际登陆必须真实陆军路径到达敌控目标，纯海空宣战和空岛登陆分别计数。“曾夺取”指该攻势中控制翻转，不等于终局持有或整局获胜。

${table(['指标','1942','1943'],[['全部中央攻势记录',190,84],['实际敌控登陆（含空岛）',189,66],['其中有地面守军的实际登陆',71,'18（16规则查询、2实体快照）'],['有守军登陆曾夺取',r(a.central.guardedCaptured),r(b.central.guardedCaptured)],['至少一次有守军登陆的局数','35/50','14/50'],['有守军目标仅海空宣战、未登陆',1,18],['两来源合流实际登陆',0,6],['专门GROUND_SOFTEN实际宣战',0,1]])}

${table(['地点','1942 有守军登陆 / 曾夺取','1943 有守军登陆 / 曾夺取'],a.central.bySite.map((t,i)=>[({712:'帕劳',769:'乌利西',825:'塞班',826:'关岛',887:'特鲁克',1001:'埃尼威托克',1088:'夸贾林'})[t.hex],t.guardedLandings+' / '+t.guardedCaptured,b.central.bySite[i].guardedLandings+' / '+b.central.bySite[i].guardedCaptured]))}

1943特鲁克零攻势，帕劳只有1次纯海空宣战、无登陆；埃尼威托克17次宣战仅2次有守军登陆。已选攻坚14/18曾拿下，但不能推导被放弃的攻击同样容易。两条塞班登陆20263906动作1237、20263950动作757无规则查询快照，公开实体守军66、CF9、1级军力明确，均未夺取，未按空岛计数。

唯一专门软化：20263904 T11马尼拉，动作1395守军CF18→9、仍日控。该执行路径确实有效，全批使用仅1次，尚未成为反复使用的准备—软化—登陆计划。

## 封锁：5局启动，尚无独立封锁胜路

按引擎国家状态段返回的精确时点记录真实资源trace与正式已结算段数；本土胜提前return不算封锁检查。1942有4局启动、最高1段；1943有1局启动、最高2段。全批正式封锁胜0。

${table(['种子','正式封锁进度','最终结局 / 原因'],[[20263802,'T9：1段','T10本土胜，提前结束'],[20263821,'T10：1段','T11重新连通并重置，随后条约败'],[20263843,'T12：1段','启动太晚，T12日本未投降'],[20263848,'T11：1段','T12本土胜，提前结束'],[20263907,'T9：1段、T10：2段','T11本土胜，提前结束']])}

3个本土胜不能说成封锁维持失败。其余95局从未在正式裁定时点启动封锁。1943首尔在394/396次正式检查仍为日控且连通，马尼拉384/396，仍连通端点是更有价值的规划目标；这些是相关检查次数，不是失败对局次数。

## 国家关键点与正式解放

${table(['剧本','菲律宾','马来亚','荷属东印度','缅甸'],[['1942：本局被日军迫降局数',50,50,3,0],['1942：曾投降局中的解放','5/50','19/50','0/3','不适用（未曾投降）'],['1943：初始已投降局数',50,50,50,50],['1943：正式解放局数','0/50','10/50','18/50','30/50']])}

1943终局：达沃50局仍日控，马尼拉47局仍日控；新加坡40局、Bangka23局仍未拿下。这比泛称“不懂规则”更具体：国家状态裁定按规则运行，后续关键点任务没有完成。国家解放本身不是最终胜利，也不能为解放拆散已形成的本土攻势。

## 其他重要数据

${table(['指标','1942','1943'],[['PoW实际检查达标',r(a.pow),r(b.pow)],['终局PW均值',a.pwFinal.mean,b.pwFinal.mean],['每局最低PW均值',a.pwMin.mean,b.pwMin.mean],['终局日军资源格均值',a.resourcesFinal.mean,b.resourcesFinal.mean],['盟军地面进攻胜 / 已裁定进攻',r(a.groundAttackAllied),r(b.groundAttackAllied)],['盟军两栖成功 / 已裁定（含无对抗）',r(a.amphibiousAllied.success),r(b.amphibiousAllied.success)],['平均动作',a.actions.mean,b.actions.mean],['平均本机并发耗时（秒）',(a.elapsedMs.mean/1000).toFixed(1),(b.elapsedMs.mean/1000).toFixed(1)]])}

首次选牌窗盟军ASP：1942均值5.72、1943均值7.48，均未采到0。只说明这些窗口不缺总ASP，不能否定攻势后预算、HQ国籍、船运来源或护航约束。1943日军191/398个窗口原始ASP高于规则合法ASP，观察器已改为queryAspRemaining，原始额度不用于战术结论。

计划任务与planBlockers是有截断的诊断计数，不能当实际执行次数或完整瓶颈发生率。当前执行瓶颈需对代表局逐窗口建立候选—HQ/军种—运输/ASP—战斗评估—排序—执行链，而不能根据计划条数下结论。

## 建议的下一轮顺序

1. 先诊断1943准备未转成决定性攻势的环节：特鲁克、帕劳和本土候选是否生成、可达、可集结、被谁挤掉；支持合法绕过强点。
2. 建立“剩最后关键点”的持续任务，优先达沃；保留后续兵力与护航，保护已成形本土胜路。
3. 日军提前低机会成本补防1942帕劳，同时定位DEI/Java南征停滞，避免继续堆后期岛屿驻军。
4. 封锁围绕真实仍连通资源端点与正式期限，执行部署/清机/补给维持；先复查这5局，区分胜路提前结束、重置、启动过晚。
5. 定点修复20263931动作972兜底，使用新开发种子；策略变动后另冻结新验证种子，不把本批再调参后当独立验收。

本轮只完成冻结评测与观察器修正，没有改AI策略、共享LLM/半LLM目录、RTT数据库或线上服务。

## 证据与验证

- [冻结配置](freeze.json)、[逐项统计](summary.json)、[观察器更正](metrics-erratum.md)、[v2观察协议](observation-spec-v2.json)。全部50份逐两局v2报告在audit-v2/，summary绑定各报告SHA256、原对局与回放SHA256、规则包与观察层哈希。
- AI源1c3709e；冻结规则包SHA256：${freeze.bundleSha256}。两方frozen=true、环境覆盖{}，种子1942：20263801–50，1943：20263901–50，maxActions12000 / repeat32 / headless。
- 新观察层只在本地离线回放加载，精确包裹原国家状态处理返回点；没有改原规则包字节，100局终态哈希一致。受影响观察全100局重审，比赛未重打。旧独立封锁胜1657动作回放在原T7/T8/T9检查分别为1/2/3段，作为规则时点回归证据，不计入本批胜率。
- 定点回归通过：正式国家状态回合、legal ASP、非中央软化、3段封锁时点、敌控实际有守军登陆、固定分母与fallback排除。此前32项源码验收输入未变，复用成功结果，未重跑云端CI。
- 运行时模型/API请求0、外部API费用0；原生Codex开发协作成本/服务实际模型ID未由工具暴露，记unknown，未假称GLM/DeepSeek审查。策略统计与本地只读规则审查意见已归档。
`;
fs.writeFileSync(path.join(folder,'results.md'),report);
const oldDir=path.join(folder,'audit'),old=fs.readdirSync(oldDir).filter(n=>n.endsWith('.json')).sort().map(n=>({file:'audit/'+n,sha256:fileSha(path.join(oldDir,n))}));fs.writeFileSync(path.join(oldDir,'.gitignore'),'*.json\n*.lock\n');fs.writeFileSync(path.join(folder,'superseded-v1-manifest.json'),JSON.stringify({task:freeze.task,status:'superseded observations; replay proofs still valid',localPreservation:'audit/*.json preserved locally, omitted from git; authoritative audit-v2 tracked',files:old},null,2)+'\n');
fs.writeFileSync(path.join(folder,'observation-spec-v2.json'),JSON.stringify({task:freeze.task,schemaVersion:2,...s.observationHashes,scope:'offline public board and public legal queries only; exact native national-status exit; no hands, PRNG, policy changes',behaviorDenominator:s.behaviorScope,fixes:['native national turn and exact phase snapshots','legal ISR-adjusted ASP','all declared ground softening targets','actual unit location equals amphibious path endpoint'],legacyFieldExcluded:'tests/match-run surrender.japan indexes China12; final victory from result/won_text and full replay',regression:'tests/campaign-selfplay-observer-regression.test.js',sourceUnchanged:true,cost:{runtimeModelRequests:0,externalApiCost:0,nativeCodexCost:null}},null,2)+'\n');
const erratum=`# ERRATUM：本批v1观察指标被v2替代

原始100局和冻结AI/规则不变；v1、v2全量合法回放终态哈希一致。v1报告本地保留，哈希在superseded-v1-manifest.json。最终统计只用audit-v2与summary.json。

1. 动作可能同步跨越国家状态段和换回合。v1用动作后turn把20263802菲律宾投降T2写成T3、马来亚T3写成T4，20263904缅甸解放T7写成T8。v2在原national_status_segment返回、后续流程前观察，以上正确记T2/T3/T7；封锁正式phase状态也按此原生时点查询。
2. v1原始ASP忽略ISR：20263901首个日军卡窗rawRemaining7，合法queryAspRemaining为4。v2同时保留raw与legal，结论只用legal。
3. v1只在中央集合检查GROUND_SOFTEN，遗漏非中央马尼拉；v2记录20263904 T11 CF18→9、敌控不变。
4. v1只检查两栖路径声明；v2额外要求实体当前位置等于路径终点，确保实际登陆，不把计划当动作。
5. firstKeys与正式国家状态分开；首批/原始1943已降国家不算本局新迫降。旧runner surrender.japan误用索引12（China，Japan为11），本报告不使用该字段判日本是否投降。

统计摘要口误亦更正：1943启动封锁的是20263907（T9/T10两段，T11本土胜），不是原子弹胜20263921。5个启动案例中3个本土胜提前结束，1个重置后条约败，1个启动太晚；不能把3个本土胜称为封锁维持失败。

本轮重跑的是100局的受影响离线观察回放，没有重打比赛、换种子或调整策略。
`;fs.writeFileSync(path.join(folder,'metrics-erratum.md'),erratum);
const proto=path.join(folder,'protocol.md');let text=fs.readFileSync(proto,'utf8');text=text.replace('第一条Political phase日志对应已同步执行国家状态段的快照；','v2在原P.national_status_segment返回、后续流程前采样；').replace('保存在research/ai-campaign-eval-50-01/audit，','v1本地保留且由v2替代；最终保存在research/ai-campaign-eval-50-01/audit-v2，');text+='\n## 验收收口\n\n100局全自然结束且完整状态哈希回放通过；1943 seed20263931有1次合法stop fallback，排除正式胜局但保留分母50与行为诊断。受影响观察v2全100局重审；旧封锁1657动作原生时点1/2/3与真实国家状态/ASP/Manila软化定点通过。源码32项未变成功验收复用，API0。结果与局级绑定见results.md、summary.json、observation-spec-v2.json；v1指标错误见metrics-erratum.md。\n';fs.writeFileSync(proto,text);console.log('report, observation protocol, v1 manifest and ERRATUM saved');