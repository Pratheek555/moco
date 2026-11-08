import { imageToAsciiFrame, DEFAULT_OPTIONS } from "asciify-engine";

export function createAsciiScene(canvas: HTMLCanvasElement) {
// Original shaded source illustrations. The converter samples these raster frames;
// it never receives hand-written text silhouettes.
const source = document.createElement('canvas');
source.width = 640; source.height = 600;
const g = source.getContext('2d', { willReadFrequently: true })!;
const W = 640, H = 600;

let lastStage=-1, transitionStart=0;
const previousSource=document.createElement('canvas');previousSource.width=640;previousSource.height=600;
const blendSource=document.createElement('canvas');blendSource.width=640;blendSource.height=600;
const pg=previousSource.getContext('2d')!,bg=blendSource.getContext('2d')!;
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
const grad = (x1: number,y1: number,x2: number,y2: number, stops: [number,string][]) => {
  const a = g.createLinearGradient(x1,y1,x2,y2);
  stops.forEach(([s,c]) => a.addColorStop(s,c)); return a;
};
function path(d: string,fill?: string | CanvasGradient | null,stroke?: string,width=2) {
  const p = new Path2D(d); if(fill){g.fillStyle=fill;g.fill(p);}
  if(stroke){g.strokeStyle=stroke;g.lineWidth=width;g.stroke(p);}
}
function ellipse(x: number,y: number,rx: number,ry: number,fill?: string | CanvasGradient,stroke?: string,width=2){
  g.beginPath();g.ellipse(x,y,rx,ry,0,0,Math.PI*2);
  if(fill){g.fillStyle=fill;g.fill();}if(stroke){g.strokeStyle=stroke;g.lineWidth=width;g.stroke();}
}
function shadow(x=320,y=508,rx=145){
  const a=g.createRadialGradient(x,y,0,x,y,rx);a.addColorStop(0,'#88888855');a.addColorStop(1,'#ffffff00');
  ellipse(x,y,rx,22,a);
}
function particles(t: number){
  for(let i=0;i<75;i++){
    const a=i*2.39996+t*.045,r=175+(i*31%95),x=320+Math.cos(a)*r,y=295+Math.sin(a)*r*.83;
    g.globalAlpha=.15+(i%5)*.06;ellipse(x,y,i%9===0?1.8:.9,i%9===0?1.8:.9,'#333');
  }g.globalAlpha=1;
}
function bulb(t: number){
  shadow(320,516,125);g.save();g.translate(0,Math.sin(t*.8)*4);
  const glass=grad(218,150,405,330,[[0,'#f6f6f6'],[.25,'#b8b8b8'],[.65,'#606060'],[1,'#232323']]);
  path('M269 395 C269 355 211 323 210 255 C208 182 257 133 321 133 C391 133 433 190 431 253 C430 315 373 359 372 395 Z',glass,'#555',2);
  // Glass rim, specular streak, internal filament and electrode stems.
  path('M265 332 C215 267 232 191 292 168',null,'#ededed',12);
  path('M286 387 L290 311 L272 280 L293 294 L307 277 L321 296 L336 278 L353 294 L369 280 L349 313 L350 387',null,'#e4e4e4',4);
  path('M300 391 L303 317 M335 391 L333 317',null,'#2b2b2b',3);
  path('M267 393 L373 393 L365 446 Q321 466 275 445 Z',grad(267,0,374,0,[[0,'#999'],[.25,'#e5e5e5'],[.55,'#777'],[1,'#222']]),'#444');
  for(let y=401;y<449;y+=10)path(`M272 ${y} Q320 ${y+13} 369 ${y-1}`,null,'#333',4);
  path('M293 452 Q320 479 347 452', '#333');
  for(let i=0;i<7;i++){const a=Math.PI+i*Math.PI/6;const x=320+Math.cos(a)*159,y=255+Math.sin(a)*159;path(`M${x} ${y} l${Math.cos(a)*19} ${Math.sin(a)*19}`,null,'#999',3);}
  g.restore();
}
function cast(t: number){
  shadow(320,512,170);g.save();g.translate(-26,Math.sin(t*.6)*2);
  // Keeper's coat: a broad, sculpted silhouette with layered lapels.
  path('M160 489 L178 394 Q190 369 249 353 L318 353 Q370 369 387 407 L407 489 Z',grad(170,370,400,470,[[0,'#aaa'],[.32,'#606060'],[.65,'#353535'],[1,'#161616']]),'#333');
  path('M235 354 L268 440 L207 407 L218 379 Z','#bbb');
  path('M314 355 L280 440 L342 405 L332 379 Z','#666');
  path('M251 340 L253 376 Q277 401 304 375 L307 340 Z',grad(250,0,309,0,[[0,'#bbb'],[1,'#555']]));
  ellipse(277,269,65,88,grad(216,230,340,290,[[0,'#d9d9d9'],[.5,'#aaa'],[.8,'#666'],[1,'#303030']]));
  ellipse(217,281,10,20,'#999');ellipse(337,281,9,20,'#555');
  path('M221 295 Q228 356 277 378 Q329 349 334 295 Q319 330 300 324 L277 339 L255 324 Q234 330 221 295 Z',grad(220,295,330,355,[[0,'#e5e5e5'],[.45,'#b5b5b5'],[1,'#555']]));
  for(let i=0;i<14;i++){let x=233+i*6;path(`M${x} 323 Q${x-1} 342 277 ${366-Math.abs(x-277)*.25}`,null,i%2?'#777':'#e1e1e1',2);}
  path('M236 270 Q250 262 261 269 M292 269 Q305 260 318 269',null,'#3a3a3a',4);
  ellipse(251,274,3,3,'#222');ellipse(306,274,3,3,'#222');
  path('M278 269 L269 301 L285 303',null,'#555',3);
  path('M204 241 Q206 189 243 177 L312 177 Q346 193 350 240 Z',grad(208,180,351,230,[[0,'#c5c5c5'],[.35,'#777'],[1,'#222']]),'#444');
  ellipse(277,241,87,14,grad(190,0,367,0,[[0,'#999'],[.5,'#383838'],[1,'#141414']]));
  for(let x=217;x<342;x+=9)path(`M${x} 211 L${x+1} 231`,null,'#aaa',2);
  // A serpent rises beside the keeper, with a shaded body and pale underside.
  path('M414 484 C502 464 460 421 442 392 C424 365 450 340 467 327 C489 310 504 281 487 257 C474 238 442 244 431 263 C415 292 429 312 451 314 C435 330 405 359 413 390 C422 425 456 450 405 466 Z',grad(410,290,489,410,[[0,'#c6c6c6'],[.4,'#727272'],[1,'#242424']]),'#454545');
  path('M450 277 Q459 259 475 265 L474 290 Q466 309 450 305', '#ddd');
  ellipse(459,275,4,4,'#222');path('M438 255 L437 237 L455 249 M474 247 L484 231 L485 258','#555');
  for(let i=0;i<8;i++)ellipse(438+Math.sin(i*.7)*12,335+i*14,3,2,'#d7d7d7');
  g.restore();
}
function lighthouse(t: number){
  shadow(320,515,193);
  // A volumetric beam and ocean sit behind the tower.
  g.save();g.globalAlpha=.32;
  const sweep=18*Math.sin(t*.65);
  path(`M342 194 L574 ${120+sweep} L574 ${261+sweep} Z`,grad(340,190,574,190,[[0,'#777'],[1,'#e9e9e9']]));g.restore();
  for(let j=0;j<7;j++){
    g.beginPath();for(let x=103;x<548;x+=3){const y=486+j*8+Math.sin(x*.04+t*.7+j)*3;if(x===103)g.moveTo(x,y);else g.lineTo(x,y);}g.strokeStyle=j%2?'#bbb':'#777';g.lineWidth=1.4;g.stroke();
  }
  path('M160 490 L187 464 L225 472 L249 448 L284 458 L323 442 L352 465 L389 454 L420 478 L462 486 L449 506 L189 506 Z',grad(230,450,350,513,[[0,'#bbb'],[.45,'#777'],[1,'#333']]),'#666');
  path('M283 255 L350 255 L376 465 Q324 488 259 465 Z',grad(259,0,376,0,[[0,'#bababa'],[.22,'#e8e8e8'],[.46,'#a5a5a5'],[.75,'#636363'],[1,'#252525']]),'#666',2);
  for(let y=284;y<460;y+=16){const left=283-(y-255)*.115,right=350+(y-255)*.125;path(`M${left} ${y} Q320 ${y+10} ${right} ${y}`,null,'#8f8f8f',1);}
  path('M304 465 L304 424 Q317 408 330 424 L330 471 Z','#262626','#bcbcbc',3);
  for(const y of [288,349])path(`M309 ${y} Q317 ${y-10} 324 ${y} L325 ${y+21} L309 ${y+20} Z`,'#262626','#bdbdbd',3);
  ellipse(317,252,56,12,'#555','#333',2);
  path('M273 171 L359 171 L359 235 L273 235 Z',grad(273,0,359,0,[[0,'#dadada'],[.4,'#9b9b9b'],[1,'#333']]),'#555');
  for(let x=281;x<=352;x+=17)path(`M${x} 176 L${x} 232`,null,'#444',4);
  const lantern=g.createRadialGradient(318,203,1,318,203,25);lantern.addColorStop(0,'#fff');lantern.addColorStop(.4,'#ddd');lantern.addColorStop(1,'#888');ellipse(318,202,16,25,lantern);
  path('M257 171 L317 113 L377 171 Z',grad(260,130,371,180,[[0,'#ccc'],[.4,'#777'],[1,'#252525']]),'#444',3);
  path('M317 112 L317 99',null,'#444',4);ellipse(317,98,4,4,'#555');
  path('M255 243 L255 225 M379 243 L379 225 M255 226 Q317 245 379 226 M255 243 Q317 263 379 243',null,'#444',3);
  for(let x=269;x<375;x+=15)path(`M${x} 231 L${x} 247`,null,'#666',2);
  // Gulls give scale without competing with the central silhouette.
  const flap=3*Math.sin(t*1.6);path(`M145 225 q9 ${-8+flap} 18 0 q9 ${-8+flap} 18 0 M450 310 q7 -6 14 0 q7 -6 14 0`,null,'#888',2);
}
function film(t: number){
  shadow(320,513,160);g.save();g.translate(320,300);g.rotate(Math.sin(t*.3)*.035);g.translate(-320,-300);
  path('M177 258 L465 258 L465 470 Q465 481 454 481 L188 481 Q177 481 177 470 Z',grad(177,260,465,460,[[0,'#acacac'],[.25,'#686868'],[.6,'#3a3a3a'],[1,'#181818']]),'#444',3);
  path('M177 249 L452 181 L463 224 L187 292 Z',grad(180,200,460,240,[[0,'#aaa'],[1,'#353535']]),'#333',3);
  for(let i=0;i<5;i++){const x=189+i*54;path(`M${x} ${246-i*13.2} l24 -6 l27 38 l-24 6 Z`,'#dedede');}
  path('M177 291 L465 291',null,'#c6c6c6',4);
  g.strokeStyle='#a3a3a3';g.lineWidth=2;g.strokeRect(202,319,237,137);
  path('M202 363 L439 363 M202 408 L439 408 M285 320 L285 408 M363 320 L363 408',null,'#aaa',2);
  g.fillStyle='#ddd';g.font='600 21px monospace';g.fillText('MOCO',218,347);g.font='16px monospace';g.fillText('SCENE',214,389);g.fillText('01',307,389);g.fillText('06',385,389);g.fillText('THE LIGHT BETWEEN US',214,437);
  ellipse(188,274,5,5,'#ddd');g.restore();
}
const scenes=[bulb,cast,lighthouse,film];

  const output=canvas, context=canvas.getContext('2d')!;
  output.width=W;output.height=H;
  return (stage: number,t: number) => {
    if(lastStage!==stage){pg.clearRect(0,0,W,H);pg.drawImage(source,0,0);transitionStart=lastStage<0?t-1:t;lastStage=stage;}
    g.clearRect(0,0,W,H);particles(t);scenes[stage]?.(t);
    const p=reduceMotion.matches?1:Math.min(1,Math.max(0,(t-transitionStart)/.6)),ease=p*p*(3-2*p);
    if(p<1){bg.clearRect(0,0,W,H);bg.globalAlpha=1-ease;bg.drawImage(previousSource,0,0);bg.globalAlpha=ease;bg.drawImage(source,0,0);bg.globalAlpha=1;g.clearRect(0,0,W,H);g.drawImage(blendSource,0,0);}
    context.clearRect(0,0,W,H);
    const {frame,cols,rows}=imageToAsciiFrame(source,{...DEFAULT_OPTIONS,fontSize:6,charSpacing:1,charAspect:.59,charset:' .,:;irsXA253hMHGS#9B&@',invert:true,contrast:.12,normalize:false},W,H);
    const cw=W/cols,ch=H/rows;context.fillStyle='#e4e4e7';context.textBaseline='middle';context.textAlign='center';context.font=`${ch*.94}px monospace`;
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const cell=frame[y][x];if(cell.a<35||cell.char===' ')continue;
      context.globalAlpha=cell.a/255;context.fillText(cell.char,(x+.5)*cw,(y+.5)*ch);
    }context.globalAlpha=1;
  };
}
