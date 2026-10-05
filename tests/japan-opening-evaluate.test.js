"use strict"
const test=require("node:test"),assert=require("node:assert/strict")
const {gate,report,RANGES}=require("./japan-opening-evaluate")
const game=(i,both,dei,verified=true)=>({seed:RANGES.develop.first+i,verified,validNatural:true,status:"complete",natural:true,
    winner:"Japan",opening:{bothByThirdRound:both,philippinesByThirdRound:both,malayaByThirdRound:both,deiByFifthRound:dei}})
test("Japanese holdout gate requires 32 verified early successes and 16 DEI successes",()=>{
    const groups={baseline:[],campaign:Array.from({length:32},(_,i)=>game(i,true,i<16))}
    assert.doesNotThrow(()=>gate(groups))
    groups.campaign[0].verified=false;assert.throws(()=>gate(groups),/verified/)
    groups.campaign[0].verified=true;groups.campaign[31].opening.bothByThirdRound=false
    assert.throws(()=>gate(groups),/32\/32/)
    groups.campaign[31].opening.bothByThirdRound=true;groups.campaign[0].opening.deiByFifthRound=false
    assert.throws(()=>gate(groups),/16\/32/)
})
test("unfinished or unverified games remain in national-objective denominators",()=>{
    const r=report({baseline:[game(0,false,false),game(1,false,false)],campaign:[game(0,true,true),game(1,true,true,false)]},"develop")
    assert.equal(r.campaign.metrics.bothByThirdRound.n,2)
    assert.equal(r.campaign.metrics.bothByThirdRound.successes,1)
    assert.equal(r.campaign.unverified,1)
    assert.equal(r.paired.bothByThirdRound.estimate,.5)
})
