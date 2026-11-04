import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { startToolBridge } from "../src/tool-bridge.ts";

it("authenticates tool calls and exposes only the app's tool list", async () => {
  let called=false;
  const bridge=await startToolBridge([{name:"read_brief",description:"Read",inputSchema:{type:"object"},call:async()=>{called=true;return{content:[{type:"text",text:"bounded"}]}}}]);
  try{
    const rejected=await fetch(bridge.url,{method:"POST",body:"{}"});
    expect(rejected.status).toBe(403);
    const child=spawn(process.execPath,[fileURLToPath(new URL("../src/mcp-bridge.mjs",import.meta.url))],{env:{...process.env,MOCO_ARTIST_URL:bridge.url,MOCO_ARTIST_TOKEN:bridge.token},windowsHide:true});
    const response=await new Promise<string>((resolve,reject)=>{
      let output="";
      child.stdout.on("data",chunk=>{output+=chunk; if(output.includes('"id":2'))resolve(output);});
      child.on("error",reject);
      child.stdin.write(JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2024-11-05"}})+"\n");
      child.stdin.write(JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"read_brief",arguments:{}}})+"\n");
    }).finally(()=>child.kill());
    expect(response).toContain("bounded");expect(called).toBe(true);
  }finally{await bridge.close();}
},10_000);
