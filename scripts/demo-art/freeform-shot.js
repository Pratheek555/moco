const f=scene.frame,p=f/(scene.fps*4),W=scene.width,H=scene.height;
ctx.fillStyle=['#f6dba6','#c6e6d9','#c9deef'][mode];ctx.fillRect(0,0,W,H);
// Overscanned linear camera drift; all physical artwork follows the same transform.
const cam=helpers.camera(p,{x:-13,y:-9,push:.025});
ctx.save();ctx.translate(cam.x,cam.y);ctx.scale(cam.scale,cam.scale);
if(mode===0){
  heading('PIP’S FIELD NOTES  /  01','Small seed.','A whole world, waiting to unfold.');
  ctx.fillStyle='#e2bb7a';ctx.fillRect(-50,1320,1180,700);
  for(let i=0;i<7;i++){ctx.strokeStyle='#d7a866';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-30,1400+i*70);ctx.lineTo(1120,1390+i*70);ctx.stroke()}
  // Bespoke terrarium, shelf, shadows, plant chart and pinned notes.
  helpers.roundRect(610,550,330,415,36,'#fff4dc');
  ctx.strokeStyle=ink;ctx.lineWidth=7;ctx.strokeRect(640,604,260,298);
  ctx.font='27px Montserrat';ctx.fillStyle=ink;ctx.fillText('SEED No. 07',646,647);
  for(let i=0;i<3;i++){ctx.fillStyle=[teal,orange,'#e9cd69'][i];ctx.fillRect(660,704+i*55,90+i*35,25)}
  ellipse(700,1327,247,40,'#62462f25',false);
  ctx.fillStyle='#eaf9ef95';ctx.strokeStyle=ink;ctx.lineWidth=9;ctx.beginPath();ctx.roundRect(490,985,410,335,78);ctx.fill();ctx.stroke();
  shape('M492 1215 Q690 1170 898 1215 L898 1285 Q700 1360 492 1285 Z','#b47d53',7);
  const entry=helpers.pop(Math.min(1,f/5));
  ctx.save();ctx.translate(306,1330);ctx.scale(entry,entry);pip(0,-440,1, f<45?'rest':'point',1,f<45?'smile':'surprise');ctx.restore();
  seed(690,1190,1.05);
  // One-frame swap (then hold), tied to the reveal cue.
  if(helpers.snap(f,45)>0){ctx.font='72px "Lilita One"';ctx.fillStyle=ink;ctx.fillText('!',572,886)}
}else if(mode===1){
  heading('PIP’S FIELD NOTES  /  02','Built to grow.','Root first. Then reach for the light.');
  ctx.fillStyle='#83b4a0';ctx.fillRect(-50,1140,1180,750);
  ctx.fillStyle='#568f7d';ctx.fillRect(-50,1190,1180,650);
  for(let i=0;i<40;i++){const x=helpers.seededRandom('soil-x'+i)*1150,y=1200+helpers.seededRandom('soil-y'+i)*600;ellipse(x,y,4,3,'#284c4c30',false)}
  const root=helpers.easeOut(Math.max(0,Math.min(1,(f-10)/22)));
  ctx.strokeStyle=cream;ctx.lineWidth=22;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(540,1030);ctx.bezierCurveTo(585,1180,430,1290,540,1450*root+1030*(1-root));ctx.stroke();
  if(f>40){ctx.lineWidth=12;ctx.beginPath();ctx.moveTo(517,1270);ctx.lineTo(390,1330);ctx.moveTo(526,1350);ctx.lineTo(660,1420);ctx.stroke()}
  ctx.strokeStyle=ink;ctx.lineWidth=25;ctx.beginPath();ctx.moveTo(540,1030);ctx.quadraticCurveTo(485,860,550,770);ctx.stroke();
  ctx.strokeStyle=teal;ctx.lineWidth=14;ctx.stroke();
  shape('M542 855 Q361 857 357 706 Q522 692 542 855 Z',teal);
  shape('M538 797 Q559 626 744 651 Q751 798 538 797 Z','#80c6a2');
  seed(540,1035,1.8);
  for(const [i,label] of ['ROOT','SHOOT','LEAF'].entries()){
    const start=[15,40,70][i];if(f<start)continue;
    const y=[1415,994,700][i];ctx.fillStyle=ink;ctx.font='38px Montserrat';ctx.fillText(label,92,y);
    ctx.strokeStyle=ink;ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(240,y-12);ctx.lineTo(380,y-12);ctx.stroke();
  }
  if(f>65){ctx.font='44px "Lilita One"';ctx.fillStyle=cream;ctx.fillText('An engine powered by light.',155,1570)}
}else{
  heading('PIP’S FIELD NOTES  /  03','Big possibility.','Give small things room to become.');
  ctx.strokeStyle='#9bb7cc';ctx.lineWidth=12;
  for(let i=0;i<5;i++){ctx.beginPath();ctx.moveTo(70+i*250,380);ctx.lineTo(70+i*250,1420);ctx.stroke()}
  ctx.beginPath();ctx.arc(540,1040,600,Math.PI,Math.PI*2);ctx.stroke();
  helpers.circle(800,555,100,'#f8d879');
  for(let i=0;i<6;i++){const x=90+i*170;ctx.fillStyle='#a4c6bc';ctx.fillRect(x,1250,120,130)}
  ctx.fillStyle='#7ba194';ctx.fillRect(-50,1370,1180,600);
  // Pip is the exact same published character used by the first shot.
  pip(315,950,1.02, f<40?'rest':'wave',1,'smile');
  shape('M637 1100 L905 1100 L867 1350 L675 1350 Z',orange);
  shape('M637 1100 L905 1100 L899 1140 L643 1140 Z','#e47f44',6);
  ctx.strokeStyle=ink;ctx.lineWidth=28;ctx.beginPath();ctx.moveTo(770,1100);ctx.quadraticCurveTo(720,900,790,725);ctx.stroke();
  ctx.strokeStyle=teal;ctx.lineWidth=17;ctx.stroke();
  shape('M765 975 Q592 964 586 825 Q736 819 765 975 Z',teal);
  shape('M774 855 Q774 684 950 691 Q942 846 774 855 Z','#80c6a2');
  const event=helpers.stagger(f,1,18,5);
  ctx.save();ctx.translate(776,746);ctx.scale(helpers.pop(event),helpers.pop(event));
  for(let i=0;i<6;i++){const a=i*Math.PI/3;ellipse(Math.cos(a)*39,Math.sin(a)*39,27,35,'#f3c958')}
  ellipse(0,0,30,30,orange);ctx.restore();
  if(f>68){ctx.font='48px "Lilita One"';ctx.fillStyle=ink;ctx.fillText('START SMALL. GROW BOLD.',120,1538)}
}
ctx.restore();
helpers.paper(73,.035,12);helpers.vignette(.12);timedWord();
