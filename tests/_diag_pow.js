"use strict"
const rules=require("../rules.js")
const st=rules.setup(20260903,"1942-1945 (The Shortened Campaign)",{})
console.log("turn",st.turn,"pow",st.pow,"asp",JSON.stringify(st.asp),"political_will",st.political_will)
// find where set_pow / pow changes over turns
const v=rules.view(st,"Allies")
console.log("view.turn",v.turn)
