// Body of a moco CanvasScene draw function; no imports or persistent state.
const { t, width: W, height: H, fps } = scene;
const { roundRect: box, circle, tube, ease, clamp, ik, type } = helpers;
const navy = '#2b2d42', teal = '#4d797d', beige = '#e9dfcf', pink = '#e3a296';
const at = id => helpers.cue(id) / fps;
const text = (s,x,y,size=35,colour=navy) => { ctx.font=`800 ${size}px Arial`;ctx.fillStyle=colour;ctx.fillText(s,x,y); };
const ellipse = (x,y,rx,ry,c) => {ctx.fillStyle=c;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();};
const pill = (x,y,angle=0,scale=1) => {
  ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.scale(scale,scale);
  box(-55,-25,110,50,25,'#faf7ee');ctx.save();ctx.beginPath();ctx.rect(0,-26,60,52);ctx.clip();box(-55,-25,110,50,25,'#d88c7c');ctx.restore();ctx.restore();
};
const plant = (x,y,s=1) => {
  ctx.save();ctx.translate(x,y);ctx.scale(s,s);box(-35,-10,70,80,8,'#bd8b76');
  tube([[0,0],[0,-110]],8,'#51756b');
  for(let i=0;i<4;i++){ctx.save();ctx.translate(0,-30-i*22);ctx.rotate((i%2?1:-1)*0.85);ellipse(0,-25,13,36,i%2?'#709084':'#577c70');ctx.restore();}
  ctx.restore();
};
const person = (x,y,scale,gesture=0,react=0) => {
  ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
  const sway=Math.sin(t*2.5)*3;ctx.translate(sway,-react*24);
  ellipse(0,12,85,14,'#c0b6aa');
  tube([[-35,-160],[-42,-80],[-45,0]],34,navy);tube([[35,-160],[45,-80],[50,0]],34,navy);
  box(-78,-8,63,25,12,'#20283a');box(25,-8,67,25,12,'#20283a');
  box(-70,-335,140,200,32,teal);box(15,-320,55,160,22,'#426a71');
  const target=[-95-gesture*155,-230-gesture*125];
  const arm=ik(-66,-300,target[0],target[1],95,90,-1);
  tube(arm,36,teal);circle(...target,22,pink);
  if(gesture>0.4) tube([[target[0]-4,target[1]],[target[0]-43,target[1]-13]],13,pink);
  tube([[65,-300],[95,-228],[95+react*20,-175-react*125]],34,teal);circle(95+react*20,-175-react*125,22,pink);
  box(-22,-380,44,66,15,pink);
  ctx.save();ctx.translate(0,-400);ctx.rotate(Math.sin(t*2)*0.025-react*0.06);
  circle(0,-27,91,pink);ellipse(53,-21,30,66,'#d58f85');circle(-86,-20,14,pink);circle(86,-20,14,pink);
  ctx.fillStyle=navy;ctx.beginPath();ctx.arc(0,-48,86,Math.PI,Math.PI*2);ctx.lineTo(82,-55);ctx.quadraticCurveTo(20,-72,-68,-35);ctx.closePath();ctx.fill();
  const blink=(t%3.15)>2.99;ellipse(-30,-30,7,blink?2:9,navy);ellipse(29,-30,7,blink?2:9,navy);
  if(react>0.2)ellipse(0,13,9,12,navy);else tube([[-14,11],[0,15],[15,8]],5,navy);
  ctx.restore();
  if(react>0.2){ctx.save();ctx.translate(120,-510);ctx.rotate(-0.1);text('!',0,0,68,'#e2552f');ctx.restore();}
  ctx.restore();
};

// All artwork and board text share this camera transform. Overscan avoids black edges.
ctx.fillStyle=beige;ctx.fillRect(0,0,W,H);
ctx.save();ctx.translate(W/2,H/2);const zoom=1.025+0.012*Math.sin(t*0.6);ctx.scale(zoom,zoom);ctx.translate(-W/2-8*Math.sin(t*0.35),-H/2);
ctx.scale(W/1920,H/1080);

if(mode===0){
  // Full illustrated street and pharmacy, with a real blank fascia for the typed statement.
  box(-100,-100,2150,970,0,'#c6d2d1');
  box(-20,120,270,720,0,'#b3c2c0');box(1540,40,450,810,0,'#aebfc0');
  for(let i=0;i<5;i++){box(1600+i%2*145,170+Math.floor(i/2)*205,100,140,8,'#8ba5a8');}
  box(180,175,1110,690,20,'#f3ebdd');box(180,175,1110,44,0,'#d7c8b6');
  box(240,265,990,135,12,'#fcf9f0');
  type('IT DOES NOTHING',330,356,at('sign'),t,75,navy,30);
  box(240,450,570,365,5,'#739497');box(268,478,514,305,2,'#a2b9b5');
  for(let i=0;i<3;i++){box(280,530+i*85,490,12,0,'#5c8083');for(let j=0;j<6;j++){box(305+j*76,495+i*85,34,35,5,j%2?'#d1ad90':'#e7d9b9');box(311+j*76,488+i*85,22,10,2,navy);}}
  box(860,449,300,416,7,teal);box(885,478,250,260,3,'#a5bcba');box(1110,758,12,45,6,beige);
  box(195,408,1080,24,0,teal);for(let i=0;i<12;i++)box(195+i*90,408,45,52,0,'#e6b19d');
  box(-100,865,2150,250,0,'#d1c7b9');box(-100,865,2150,16,0,'#bab7ac');
  plant(150,804,0.95);plant(1230,810,0.9);
  person(1515,924,1.1,ease(t/0.8),ease((t-at('deny'))/0.3));
  pill(1320,575,-0.48+Math.sin(t*2)*0.08,1.35);
  if(t>=at('deny')){
    const p=clamp((t-at('deny'))/0.13),q=clamp((t-at('deny')-0.13)/0.13);
    tube([[287,280],[287+870*p,280+105*p]],26,'#d62828');
    if(q>0)tube([[1157,280],[1157-870*q,280+105*q]],26,'#d62828');
  }
}else if(mode===1){
  // A demonstration room: a large physical teaching board, a seated patient and a clinician.
  box(-100,-100,2150,975,0,'#b7c8c7');box(90,80,1730,720,22,'#f5efe4');
  box(150,145,970,565,15,'#42676e');box(180,175,910,505,7,'#f8f4e9');
  type('EXPECTATION',245,270,at('sign'),t,65,navy,30);
  // The custom mechanism has no preset: pill -> neural signal -> gentler pain marker.
  pill(335,425,-0.45,1.25);
  const p=ease((t-0.35)/1.4);
  tube([[445,420],[445+430*p,420]],10,'#9eaba3');
  for(let i=0;i<4;i++){const x=450+((t*220+i*104)%405);circle(x,420,10,'#e7ad75');}
  for(let i=0;i<9;i++)circle(877+Math.cos(i*2.4)*53,407+Math.sin(i*2.4)*45,27,i%2?'#a696ba':'#8977a4');
  tube([[900,480],[900,520],[800,545]],10,'#8977a4');
  type('PAIN CAN FEEL DIFFERENT',245,610,at('explain'),t,43,navy,28);
  box(1240,625,380,75,22,teal);box(1235,690,45,200,8,navy);box(1565,690,45,200,8,navy);
  box(-100,880,2150,250,0,'#d6cbbb');
  person(1395,925,1.08,0.3+0.5*Math.sin(t*0.8)**2,0);
  plant(1740,825,1.3);
}else{
  // Subject reveal on a real theatre sign, with a spotlight and a responding character.
  box(-100,-100,2150,1200,0,'#6a5a88');
  for(let i=0;i<8;i++){box(-30+i*285,-50,120,1030,55,i%2?'#60517d':'#74638e');}
  ctx.fillStyle='#81739b';ctx.beginPath();ctx.moveTo(960,-60);ctx.lineTo(370,940);ctx.lineTo(1540,940);ctx.closePath();ctx.fill();
  box(-100,925,2150,200,0,'#45465f');ellipse(960,922,610,62,'#a090ad');
  tube([[460,-20],[460,220]],12,navy);tube([[1460,-20],[1460,220]],12,navy);
  box(360,205,1200,250,20,'#f5efdf');
  type('THE PLACEBO EFFECT',440,365,at('sign'),t,82,navy,30);
  person(1120,920,0.88,0.8,ease((t-0.2)/0.4)*0.3);
  pill(690,678,-0.6+Math.sin(t*1.7)*0.1,2.5);
  for(let i=0;i<3;i++){const x=565+i*115,y=808+Math.sin(t*3+i)*9;circle(x,y,6,'#d9c5ad');}
}
ctx.restore();
