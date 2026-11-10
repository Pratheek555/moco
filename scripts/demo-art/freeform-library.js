// Original series asset: Pip, a seed scientist. Pose/facing/expression are drawings,
// not kit actions. All state comes from arguments or the requested frame.
const ink = '#182e39', cream = '#fff4dc', teal = '#56b8a8', orange = '#fa9d54';
function shape(path, fill, width=9) {
  const p = new Path2D(path); ctx.fillStyle=fill;ctx.strokeStyle=ink;ctx.lineWidth=width;ctx.lineJoin='round';ctx.fill(p);ctx.stroke(p);
}
function ellipse(x,y,rx,ry,fill,stroke=true) {
  ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill();
  if(stroke){ctx.strokeStyle=ink;ctx.lineWidth=8;ctx.stroke()}
}
function pip(x,y,scale,pose='rest',facing=1,expression='smile') {
  ctx.save();ctx.translate(x,y);ctx.scale(scale*facing,scale);
  ellipse(0,445,170,28,'#143a4630',false);
  shape('M-77 300 L-22 300 L-22 414 Q-34 439 -102 426 Z',ink);
  shape('M22 300 L77 300 L103 425 Q32 439 22 414 Z',ink);
  shape('M-114 93 Q0 39 114 93 L102 320 Q0 359 -102 320 Z',teal);
  shape('M30 79 Q90 85 114 93 L102 320 Q57 336 30 333 Z','#378d86',0);
  shape('M-31 89 L0 155 L31 89 L27 44 L-27 44 Z',cream,6);
  ctx.lineCap='round';ctx.lineWidth=37;ctx.strokeStyle=ink;
  const left = pose==='wave' ? [[-100,118],[-175,42],[-159,-66]] : [[-100,118],[-140,217],[-106,263]];
  const right = pose==='point' ? [[100,118],[173,120],[235,41]] : pose==='wonder' ? [[100,118],[173,43],[112,-25]] : [[100,118],[146,218],[121,267]];
  for(const arm of [left,right]){
    ctx.strokeStyle=ink;ctx.lineWidth=37;
    ctx.beginPath();arm.forEach(([ax,ay],i)=>i?ctx.lineTo(ax,ay):ctx.moveTo(ax,ay));ctx.stroke();
    ctx.strokeStyle=teal;ctx.lineWidth=22;ctx.stroke();ctx.strokeStyle=ink;ctx.lineWidth=37;
    ellipse(...arm[2],22,24,orange);
  }
  ellipse(0,-20,112,121,cream);
  shape('M-110 -35 Q-130 -182 12 -161 Q121 -150 112 -27 L76 -51 L53 -107 L-16 -78 L-54 -109 L-79 -39 Z',ink);
  // Orange angular goggles and a single asymmetrical leaf-shaped antenna.
  shape('M21 -157 Q3 -235 75 -234 Q79 -178 21 -157 Z',teal,7);
  ctx.strokeStyle=orange;ctx.lineWidth=14;
  for(const eye of [-43,43]){ctx.beginPath();ctx.roundRect(eye-34,-42,68,57,19);ctx.stroke()}
  ctx.beginPath();ctx.moveTo(-9,-15);ctx.lineTo(9,-15);ctx.stroke();
  for(const eye of [-43,43])ellipse(eye+(pose==='point'?8:0),-12,6,10,ink,false);
  ctx.strokeStyle=ink;ctx.lineWidth=7;ctx.beginPath();
  if(expression==='surprise')ctx.ellipse(8,50,13,18,0,0,Math.PI*2);
  else{ctx.moveTo(-19,43);ctx.quadraticCurveTo(5,68,29,41)}ctx.stroke();
  ellipse(-76,28,17,9,'#efa78a',false);ellipse(78,28,17,9,'#efa78a',false);
  shape('M-26 210 L26 210 L26 266 L-26 266 Z',cream,5);
  ctx.fillStyle=orange;ctx.fillRect(-13,221,26,12);
  ctx.restore();
}
function seed(x,y,s=1) {
  ctx.save();ctx.translate(x,y);ctx.scale(s,s);shape('M0 -44 Q58 -12 28 36 Q-23 69 -40 16 Q-48 -24 0 -44 Z',orange,7);
  ctx.strokeStyle='#b55c41';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(-16,22);ctx.quadraticCurveTo(6,0,10,-21);ctx.stroke();ctx.restore();
}
function heading(kicker,title,subtitle) {
  ctx.textAlign='left';ctx.fillStyle=ink;ctx.font='28px Montserrat';ctx.fillText(kicker,86,145);
  ctx.font='92px "Lilita One"';ctx.fillText(title,80,255);
  ctx.font='30px Montserrat';ctx.fillText(subtitle,86,315);
}
function timedWord() {
  const active=scene.words.find(w=>scene.frame>=w.startFrame&&scene.frame<w.endFrame);
  if(!active)return;
  ctx.save();ctx.font='54px "Lilita One"';ctx.textAlign='center';
  const w=ctx.measureText(active.text).width+70;
  helpers.roundRect(540-w/2,1650,w,94,28,ink);
  helpers.wordText([active],540,1718,{colour:cream,activeColour:cream});ctx.restore();
}
