// Browser-side source, embedded with the deterministic canvas helpers. No renderer/provider dependencies.
export const actingSource = String.raw`(()=>{
  const mix=(a,b,p)=>a+(b-a)*ease(p);
  const blend=(a,b,p)=>Array.isArray(a)?a.map((v,i)=>blend(v,b[i],p)):typeof a==='number'?mix(a,b,p):p<0.5?a:b;
  const pose=(action,progress,options={})=>{
    const rest={left:[[-65,209],[-94,285],[-48,316]],right:[[65,209],[94,285],[48,316]],lean:0,look:0,headTurn:0,gaze:0,expression:'neutral',hand:'open'};
    const targets={
      supportElbow:{...rest,left:[[-65,209],[-82,267],[62,282]],right:[[65,209],[62,282],[12,218]],lean:-9,headTurn:-0.08,gaze:-0.4,expression:'wince',hand:'cup'},
      point:{...rest,right:[[65,209],[125,170],[210,130]],lean:12,look:0.7,headTurn:0.12,gaze:1,hand:'point'},
      question:{...rest,right:[[65,209],[117,250],[160,212]],headTurn:-0.1,gaze:0,expression:'question',hand:'open'},
      pull:{...rest,right:[[65,209],[119,147],[167,105]],lean:10,look:0.8,headTurn:0.12,gaze:1,hand:'fist'},
      react:{...rest,left:[[-65,209],[-119,191],[-143,135]],right:[[65,209],[119,191],[143,135]],headTurn:-0.05,expression:'surprise',hand:'open'}
    };
    if(!targets[action])throw Error('Unknown acting pose: '+action);
    const target={...targets[action],...options};
    return {...target,left:blend(rest.left,target.left,progress),right:blend(rest.right,target.right,progress),lean:mix(0,target.lean,progress),headTurn:mix(0,target.headTurn,progress),gaze:mix(0,target.gaze,progress)};
  };
  const hand=(x,y,options={})=>{
    const {shape='open',size=22,colour='#d99588',angle=0}=options;
    ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.fillStyle=colour;
    ctx.beginPath();ctx.ellipse(0,0,size*0.72,size*0.55,0,0,Math.PI*2);ctx.fill();
    const stroke=(a,b,w)=>{ctx.lineWidth=w;ctx.lineCap='round';ctx.strokeStyle=colour;ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke()};
    if(shape==='point'){stroke([size*.3,-size*.15],[size*1.65,-size*.25],size*.36);stroke([-size*.25,-size*.1],[-size*.1,-size*.65],size*.38)}
    else if(shape==='open'){for(let i=0;i<4;i++)stroke([-size*.35+i*size*.25,-size*.2],[-size*.6+i*size*.48,-size*(1.18-Math.abs(i-1.5)*.12)],size*.24);stroke([-size*.45,0],[-size*1.1,-size*.35],size*.3)}
    else if(shape==='cup'){stroke([-size*.5,0],[-size*.9,-size*.45],size*.32);stroke([size*.4,-size*.1],[size*.65,-size*.6],size*.3)}
    else if(shape!=='fist')throw Error('Unknown hand shape: '+shape);
    ctx.restore();
  };
  const face=(x,y,options={})=>{
    const {size=80,gaze=0,turn=0,expression='neutral',t=0,colour='#28394d'}=options;
    const blink=((t%3.4)+3.4)%3.4<.14;
    ctx.save();ctx.translate(x+turn*size*.12,y);ctx.scale(1-Math.abs(turn)*.18,1);ctx.fillStyle=colour;ctx.strokeStyle=colour;ctx.lineCap='round';ctx.lineWidth=size*.045;
    for(const side of [-1,1]){
      const ex=side*size*.3+gaze*size*.08;
      if(blink||expression==='wince'){ctx.beginPath();ctx.moveTo(ex-size*.06,0);ctx.lineTo(ex+size*.06,expression==='wince'?side*size*.035:0);ctx.stroke()}
      else{ctx.beginPath();ctx.ellipse(ex,0,size*.055,size*.065,0,0,Math.PI*2);ctx.fill()}
      const tilt=expression==='question'?side*.08:expression==='wince'?-side*.08:0;
      ctx.beginPath();ctx.moveTo(ex-size*.1,-size*.2+tilt*size);ctx.lineTo(ex+size*.1,-size*.2-tilt*size);ctx.stroke();
    }
    ctx.beginPath();
    if(expression==='surprise'){ctx.ellipse(0,size*.48,size*.09,size*.13,0,0,Math.PI*2);ctx.fill()}
    else{ctx.moveTo(-size*.12,size*.48);ctx.quadraticCurveTo(0,size*(expression==='wince'?.36:expression==='question'?.57:.5),size*.12,size*.48);ctx.stroke()}
    ctx.restore();
  };
  return {pose,hand,face,blend};
})()`;
