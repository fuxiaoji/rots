"use strict"
const rules=require("../rules.js")
const scenario="1942-1945 (The Shortened Campaign)"
let st=rules.setup(20260903,scenario,{headless_moves:true})
const G=rules._G?rules._G():null
// try to access internals
const names={}
for(let h=0;h<=5000;h++){try{const md=rules.get_map_data&&rules.get_map_data(h);if(md&&md.name)names[h]=md.name}catch(e){break}}
for(const h of [891,657,1001,712,769,1400,535,237,669,670,672,421,3302,3303,597]){
  console.log(h, names[h], "res?", rules.get_map_data&&rules.get_map_data(h)?.resource, "port?", rules.get_map_data&&rules.get_map_data(h)?.port, "air?", rules.get_map_data&&rules.get_map_data(h)?.airfield)
}
