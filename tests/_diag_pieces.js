"use strict"
const rules = require("../rules.js")
const st=rules.setup(20260903,"1942-1945 (The Shortened Campaign)",{})
const v=rules.view(st,"Allies")
const units=(v.ai&&v.ai.units)||[]
for(const id of [7,79,5,84,86]){
  const u=units.find(x=>x.id===id)
  console.log(id, JSON.stringify(u))
}
// also print all AP units with id/name/class/location
console.log("--- AP units ---")
units.filter(u=>u.faction===1).slice(0,60).forEach(u=>console.log(u.id, u.class, u.type||u.name, "loc", u.location))
