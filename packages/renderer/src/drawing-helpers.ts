// Trusted, self-contained helper factory, evaluated only INSIDE the drawing iframe.
// A string keeps the same implementation in Chromium and unit tests without a
// transpiler adding closed-over runtime symbols to Function#toString output.
export const drawingHelpersSource = String.raw`(ctx, scene) => {
  const clamp = (v,a=0,b=1) => Math.max(a,Math.min(b,v));
  const easeOut = p => 1-Math.pow(1-clamp(p),3);
  const overshoot = (p,amount=1.70158) => {p=clamp(p)-1;return 1+(amount+1)*p*p*p+amount*p*p};
  const random = seed => {let h=2166136261;for(const ch of String(seed)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;return (h>>>0)/4294967296};
  const words = (items=scene.words||[],frame=scene.frame) => items.map(word => ({...word,visible:frame>=word.startFrame,active:frame>=word.startFrame&&frame<word.endFrame}));
  // Low-frequency displacement along each segment's normal, not frame-by-frame jitter.
  // Endpoints stay attached; short overlapping round strokes vary the ink pressure.
  const wobblyStroke = (points,{colour='#201c1b',width=4,wobble=1,seed=1,closed=false}={}) => {
    if(points.length<2)return;
    const line=closed?[...points,points[0]]:points;
    ctx.save();ctx.strokeStyle=colour;ctx.lineCap='round';ctx.lineJoin='round';
    for(let i=1;i<line.length;i++){
      const a=line[i-1],b=line[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
      if(!length)continue;
      const count=Math.max(2,Math.ceil(length/Math.max(width*2,Math.abs(wobble)*4,0.001)));
      const phase=random(seed+':'+i)*Math.PI*2;
      let previous=a;
      for(let j=1;j<=count;j++){
        const t=j/count;
        const offset=j===count?0:wobble*Math.sin(Math.PI*t)*(0.65*Math.sin(t*6+phase)+0.35*Math.sin(t*11-phase));
        const next=[a[0]+dx*t-dy/length*offset,a[1]+dy*t+dx/length*offset];
        ctx.lineWidth=width*(0.85+0.3*random(seed+':pressure:'+i+':'+j));
        ctx.beginPath();ctx.moveTo(...previous);ctx.lineTo(...next);ctx.stroke();previous=next;
      }
    }
    ctx.restore();
  };
  // A tapered translucent paint ribbon; callers clip it to the wall/wood/rock plane.
  // Stable striations follow the stroke instead of scattering circles over the scene.
  const paintStroke = (points,{colour='#ffffff',width=30,opacity=.12,seed=1}={}) => {
    if(points.length<2)return;
    const normals=points.map((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)];const dx=b[0]-a[0],dy=b[1]-a[1],d=Math.hypot(dx,dy)||1;return [-dy/d,dx/d]});
    const sides=[-1,1].map(side=>points.map((p,i)=>{
      const taper=i===0||i===points.length-1?.12:.42+random(seed+':edge:'+i)*.15;
      return [p[0]+normals[i][0]*width*taper*side,p[1]+normals[i][1]*width*taper*side];
    }));
    ctx.save();const alpha=ctx.globalAlpha;ctx.globalAlpha=alpha*clamp(opacity);ctx.fillStyle=colour;
    ctx.beginPath();const outline=[...sides[0],...sides[1].reverse()];outline.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fill();
    ctx.globalAlpha=alpha*clamp(opacity)*.3;
    for(let i=0;i<3;i++){
      const offset=(random(seed+':bristle:'+i)-.5)*width*.6;
      const strand=points.map((p,j)=>{const shift=offset+(random(seed+':'+i+':'+j)-.5)*width*.04;return [p[0]+normals[j][0]*shift,p[1]+normals[j][1]*shift]});
      // One path per bristle: fine paint streaks do not need hundreds of pressure subsegments.
      ctx.strokeStyle=colour;ctx.lineWidth=Math.max(.1,width*(.02+random(seed+':weight:'+i)*.015));ctx.lineCap='round';
      ctx.beginPath();strand.forEach((p,j)=>j?ctx.lineTo(...p):ctx.moveTo(...p));ctx.stroke();
    }
    ctx.restore();
  };
  // Original single-line block alphabet. Coordinates are pen paths, never system-font outlines.
  // Lowercase input deliberately becomes capitals; unsupported glyphs visibly become '?'.
  const glyphs={
    A:[[[0,0],[.27,-.98],[.6,0]],[[.12,-.4],[.47,-.42]]],
    B:[[[0,0],[.02,-1],[.36,-.98],[.56,-.83],[.53,-.64],[.07,-.53],[.4,-.53],[.59,-.34],[.53,-.1],[.31,0],[0,0]]],
    C:[[[.58,-.88],[.43,-1],[.17,-.94],[.02,-.68],[0,-.3],[.18,-.03],[.43,0],[.61,-.16]]],
    D:[[[0,0],[.01,-1],[.3,-.98],[.55,-.79],[.62,-.48],[.53,-.16],[.29,0],[0,0]]],
    E:[[[.6,-.98],[.02,-1],[0,0],[.6,-.02]],[[.02,-.52],[.47,-.54]]],
    F:[[[0,0],[.02,-1],[.6,-.98]],[[.02,-.54],[.48,-.56]]],
    G:[[[.59,-.88],[.42,-1],[.16,-.94],[.01,-.69],[0,-.28],[.19,-.03],[.44,0],[.6,-.16],[.58,-.49],[.35,-.49]]],
    H:[[[.01,-1],[0,0]],[[.59,-1],[.61,0]],[[.01,-.5],[.6,-.52]]],
    I:[[[.05,-1],[.55,-.99]],[[.31,-.99],[.29,0]],[[.04,0],[.55,-.01]]],
    J:[[[.18,-1],[.6,-.99],[.57,-.22],[.45,-.02],[.18,0],[0,-.17]]],
    K:[[[.02,-1],[0,0]],[[.58,-1],[.04,-.46],[.61,0]]],
    L:[[[.02,-1],[0,0],[.6,-.02]]],
    M:[[[0,0],[.01,-1],[.31,-.48],[.61,-1],[.63,0]]],
    N:[[[0,0],[.01,-1],[.61,0],[.59,-1]]],
    O:[[[.3,-1],[.08,-.88],[0,-.55],[.07,-.16],[.28,0],[.51,-.1],[.61,-.43],[.56,-.82],[.3,-1]]],
    P:[[[0,0],[.02,-1],[.36,-.98],[.58,-.83],[.56,-.6],[.36,-.48],[.02,-.5]]],
    Q:[[[.3,-1],[.08,-.88],[0,-.55],[.07,-.16],[.28,0],[.51,-.1],[.61,-.43],[.56,-.82],[.3,-1]],[[.36,-.3],[.65,.1]]],
    R:[[[0,0],[.02,-1],[.36,-.98],[.58,-.83],[.56,-.6],[.36,-.48],[.02,-.5]],[[.32,-.49],[.62,0]]],
    S:[[[.59,-.88],[.41,-1],[.15,-.94],[.01,-.74],[.1,-.56],[.45,-.43],[.6,-.25],[.49,-.04],[.19,0],[0,-.13]]],
    T:[[[0,-.98],[.63,-1]],[[.32,-.99],[.29,0]]],
    U:[[[0,-1],[.02,-.24],[.16,-.03],[.4,0],[.58,-.19],[.6,-1]]],
    V:[[[0,-1],[.28,0],[.61,-1]]],
    W:[[[0,-1],[.1,0],[.32,-.55],[.54,0],[.67,-1]]],
    X:[[[0,-1],[.61,0]],[[.59,-1],[0,0]]],
    Y:[[[0,-1],[.3,-.49],[.61,-1]],[[.3,-.49],[.29,0]]],
    Z:[[[0,-1],[.59,-.98],[0,0],[.62,-.02]]],
    '0':[[[.3,-1],[.08,-.87],[0,-.51],[.07,-.12],[.3,0],[.52,-.14],[.59,-.52],[.51,-.9],[.3,-1]],[[.1,-.18],[.5,-.83]]],
    '1':[[[.1,-.77],[.33,-1],[.3,0]],[[.06,0],[.56,-.01]]],
    '2':[[[0,-.82],[.15,-1],[.42,-.98],[.59,-.77],[.51,-.56],[.03,0],[.61,-.02]]],
    '3':[[[0,-.91],[.27,-1],[.54,-.86],[.48,-.62],[.27,-.51],[.5,-.43],[.6,-.21],[.43,0],[.14,0],[0,-.13]]],
    '4':[[[.43,0],[.45,-1],[0,-.3],[.61,-.32]]],
    '5':[[[.59,-1],[.05,-.98],[.02,-.52],[.37,-.57],[.59,-.37],[.53,-.1],[.3,0],[0,-.1]]],
    '6':[[[.54,-.96],[.27,-1],[.05,-.7],[0,-.28],[.16,-.02],[.43,0],[.59,-.23],[.5,-.5],[.27,-.56],[.02,-.4]]],
    '7':[[[0,-.99],[.6,-1],[.17,0]]],
    '8':[[[.29,-.54],[.04,-.73],[.09,-.93],[.34,-1],[.55,-.86],[.52,-.67],[.29,-.54],[.03,-.31],[.1,-.06],[.35,0],[.6,-.17],[.54,-.4],[.29,-.54]]],
    '9':[[[.57,-.58],[.3,-.48],[.05,-.62],[0,-.84],[.19,-1],[.44,-.98],[.6,-.73],[.54,-.27],[.31,0],[.05,-.04]]],
    '?':[[[0,-.81],[.15,-1],[.43,-.97],[.58,-.76],[.5,-.55],[.29,-.39],[.29,-.25]],[[.29,-.03],[.3,0]]],
    '!':[[[.3,-1],[.28,-.27]],[[.28,-.03],[.29,0]]],
    '.':[[[.28,-.03],[.29,0]]], ',':[[[.3,-.03],[.22,.15]]],
    ':':[[[.29,-.68],[.3,-.65]],[[.28,-.03],[.29,0]]],
    '-':[[[.04,-.47],[.55,-.49]]], '/':[[[0,0],[.6,-1]]],
    '+':[[[.02,-.48],[.59,-.5]],[[.3,-.82],[.29,-.17]]],
    '=':[[[.02,-.65],[.59,-.67]],[[.02,-.3],[.59,-.32]]],
    '%':[[[0,0],[.6,-1]],[[.1,-1],[0,-.88],[.1,-.75],[.22,-.88],[.1,-1]],[[.5,-.25],[.38,-.12],[.5,0],[.61,-.12],[.5,-.25]]],
    "'":[[[.3,-1],[.24,-.8]]], '(': [[[.45,-1],[.2,-.8],[.12,-.48],[.22,-.14],[.43,0]]],
    ')': [[[.16,-1],[.4,-.8],[.48,-.48],[.38,-.14],[.18,0]]],
  };
  const letterAdvance=(ch,size,tracking)=>(ch===' '?.42:.72)*size+tracking;
  const handLetterWidth=(text,{size=48,tracking=size*.12}={})=>{
    const chars=Array.from(String(text).toUpperCase());
    return chars.length?chars.reduce((sum,ch)=>sum+letterAdvance(ch,size,tracking),0)-tracking:0;
  };
  const handLetter=(text,x,y,{size=48,colour='#eee7d4',weight=size*.075,seed=1,tracking=size*.12,align='left'}={})=>{
    const width=handLetterWidth(text,{size,tracking});
    let offset=align==='center'?-width/2:align==='right'?-width:0;
    for(const [i,ch] of Array.from(String(text).toUpperCase()).entries()){
      if(ch!==' '){
        const key=seed+':letter:'+i;
        ctx.save();ctx.translate(x+offset,y+(random(key)-.5)*size*.06);
        ctx.rotate((random(key+':angle')-.5)*.07);ctx.scale(size*(.96+random(key+':scale')*.08),size);
        for(const [j,stroke] of (glyphs[ch]||glyphs['?']).entries())wobblyStroke(stroke,{colour,width:weight/size,wobble:.009,seed:key+':'+j});
        ctx.restore();
      }
      offset+=letterAdvance(ch,size,tracking);
    }
    return width;
  };
  return {
    wobblyStroke, paintStroke, handLetter, handLetterWidth,
    easeOut, overshoot, pop:p=>overshoot(p,2.2),
    snap:(frame,at,frames=1)=>clamp((frame-at+1)/Math.max(1,frames)),
    hold:(value,frame,until,after=value)=>frame<until?value:after,
    stagger:(frame,index,delay=3,duration=5)=>clamp((frame-index*delay)/Math.max(1,duration)),
    step:(frame,every=2)=>Math.floor(frame/Math.max(1,every))*Math.max(1,every),
    seededRandom:random,
    gravityArc:(from,to,p,height=100)=>{p=clamp(p);return [from[0]+(to[0]-from[0])*p,from[1]+(to[1]-from[1])*p-4*height*p*(1-p)]},
    camera:(p,{x=0,y=0,push=0}={})=>({x:x*clamp(p),y:y*clamp(p),scale:1+push*clamp(p)}),
    words,
    wordText:(items,x,y,{frame=scene.frame,gap=12,activeColour='#ffd166',colour='#ffffff',mode='reveal'}={})=>{
      let offset=0;
      for(const word of words(items,frame)){
        if(mode!=='reveal'||word.visible){ctx.fillStyle=word.active?activeColour:colour;ctx.fillText(word.text,x+offset,y)}
        offset+=ctx.measureText(word.text).width+gap;
      }
      return offset;
    },
    palette:(tokens,name,fallback='#000000')=>tokens[name]??fallback,
    grade:(colour,alpha=0.12,blend='soft-light')=>{ctx.save();ctx.globalCompositeOperation=blend;ctx.globalAlpha=alpha;ctx.fillStyle=colour;ctx.fillRect(0,0,scene.width,scene.height);ctx.restore()},
    vignette:(strength=0.35,colour='0,0,0')=>{const w=scene.width,h=scene.height;const g=ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*0.15,w/2,h/2,Math.hypot(w,h)/2);g.addColorStop(0,'rgba('+colour+',0)');g.addColorStop(1,'rgba('+colour+','+strength+')');ctx.save();ctx.fillStyle=g;ctx.fillRect(0,0,w,h);ctx.restore()},
    paper:(seed=1,amount=0.04,spacing=8)=>{ctx.save();ctx.fillStyle='#000000';for(let y=0;y<scene.height;y+=Math.max(1,spacing))for(let x=0;x<scene.width;x+=Math.max(1,spacing)){ctx.globalAlpha=random(seed+':'+x+':'+y)*amount;ctx.fillRect(x,y,1+random(x+':'+y)*2,1)}ctx.restore()},
    rimLight:(draw,colour='#fff1b8',width=5)=>{ctx.save();ctx.shadowColor=colour;ctx.shadowBlur=width;ctx.shadowOffsetX=width;draw(ctx);ctx.restore()},
    layer:(width=scene.width,height=scene.height)=>{const layer=document.createElement('canvas');layer.width=width;layer.height=height;return layer},
  };
}`;
