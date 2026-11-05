import type { CanvasScene } from "@moco/spec";
import { actingSource } from "./acting.ts";

// Opaque-origin iframe: no same-origin, network, popups, forms or parent DOM access.
// CSP is defense in depth, not an OS sandbox. Renderer timeouts bound failed draws.
export function canvasDocument(canvas: CanvasScene, width: number, height: number): string {
  const encoded = JSON.stringify({ ...canvas, width, height }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; img-src data:; font-src data:; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;overflow:hidden}canvas{display:block}</style></head><body><canvas></canvas><script>
"use strict";
const config=${encoded};
const canvas=document.querySelector('canvas');
canvas.width=config.width; canvas.height=config.height;
const ctx=canvas.getContext('2d');
const send=(message)=>parent.postMessage(message,'*');
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=(v)=>{v=clamp(v);return v*v*(3-2*v)};
const helpers={clamp,ease,random:(seed)=>{const v=Math.sin(seed*127.1+311.7)*43758.5453;return v-Math.floor(v)},
  cue:(id)=>{const cue=config.cues.find(c=>c.id===id);if(!cue)throw Error('Unknown cue: '+id);return cue.atFrame},
  roundRect:(x,y,w,h,r,colour)=>{ctx.fillStyle=colour;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill()},
  circle:(x,y,r,colour)=>{ctx.fillStyle=colour;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill()},
  tube:(points,width,colour)=>{ctx.strokeStyle=colour;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.stroke()},
  ik:(x,y,tx,ty,a,b,bend=1)=>{const dx=tx-x,dy=ty-y,d=clamp(Math.hypot(dx,dy),Math.abs(a-b)+0.001,a+b-0.001);const angle=Math.atan2(dy,dx)+bend*Math.acos(clamp((a*a+d*d-b*b)/(2*a*d),-1,1));return [[x,y],[x+a*Math.cos(angle),y+a*Math.sin(angle)],[tx,ty]]},
  type:(text,x,y,start,t,size=48,colour='#2b2d42',rate=30)=>{ctx.font='800 '+size+'px Arial';ctx.textBaseline='alphabetic';let offset=0;for(let i=0;i<text.length;i++){const age=t-start-i/rate;if(age<0)break;const p=ease(age/0.18);ctx.save();ctx.translate(x+offset+(1-p)*size*0.7,y);ctx.scale(1+0.45*(1-p),1+0.45*(1-p));ctx.fillStyle=colour;ctx.fillText(text[i],0,0);ctx.restore();offset+=ctx.measureText(text[i]).width}}
};
helpers.acting=${actingSource};
let draw;const assets={};let ready=false;
addEventListener('message',event=>{
  if(event.source!==parent||event.data?.kind!=='moco:frame'||!ready)return;
  const {frame,fps,request}=event.data;
  try{
    // Reset ALL canvas state and pixels; frames may arrive in any order.
    canvas.width=config.width;
    draw(ctx,Object.freeze({frame,fps,t:frame/fps,width:config.width,height:config.height,assets}),helpers);
    send({kind:'moco:drawn',request});
  }catch(error){send({kind:'moco:error',request,message:String(error.message||error)})}
});
(async()=>{try{
  draw=new Function('ctx','scene','helpers','"use strict";\\n'+config.source);
  await Promise.all(Object.entries(config.fonts||{}).map(async([family,url])=>{const face=new FontFace(family,'url('+url+')');await face.load();document.fonts.add(face)}));
  await Promise.all(Object.entries(config.assets).map(([id,url])=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{assets[id]=image;resolve()};image.onerror=()=>reject(Error('Asset failed: '+id));image.src=url})));
  ready=true;send({kind:'moco:ready'});
}catch(error){send({kind:'moco:error',message:String(error.message||error)})}})();
</script></body></html>`;
}
