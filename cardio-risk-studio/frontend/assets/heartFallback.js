/* Offline-safe vector schematic fallback. The primary renderer is WebGL/Three.js. */
const SCORE_RGB = [[72,217,189],[240,191,109],[255,113,131]];
function scoreRGB(score) {
  const s = Math.max(0, Math.min(1, Number(score ?? 0.34)));
  const a = s < .5 ? SCORE_RGB[0] : SCORE_RGB[1];
  const b = s < .5 ? SCORE_RGB[1] : SCORE_RGB[2];
  const t = s < .5 ? s * 2 : (s - .5) * 2;
  return a.map((v,i) => Math.round(v * (1-t) + b[i] * t));
}
function rgba(rgb, a=1) { return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`; }

export function initFallbackHeart(canvas, onSelect = () => {}) {
  const ctx = canvas.getContext('2d');
  const state = { scores: {}, selected: 'LAD', yaw: 0, pitch: 0, zoom: 1, drag: null, width: 0, height: 0, dpr: 1 };
  const paths = {
    LAD: [[-0.08,-0.42],[-0.07,-0.2],[-0.105,0.02],[-0.10,0.29],[-0.15,0.52],[-0.19,0.82],[-0.24,1.08]],
    LCX: [[-0.08,-0.42],[-0.31,-0.45],[-0.53,-0.35],[-0.72,-0.16],[-0.70,0.05],[-0.55,0.20]],
    RCA: [[0.12,-0.42],[0.35,-0.4],[0.58,-0.25],[0.68,-0.03],[0.64,0.18],[0.47,0.4],[0.24,0.63]],
  };
  function fit() {
    const r = canvas.getBoundingClientRect();
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.width = Math.max(1, r.width); state.height = Math.max(1, r.height);
    canvas.width = Math.round(state.width * state.dpr); canvas.height = Math.round(state.height * state.dpr);
    draw();
  }
  function proj(p) {
    const [x,y] = p;
    const yaw = state.yaw, pitch = state.pitch;
    const xx = x * Math.cos(yaw) - (0.16 + 0.1*y) * Math.sin(yaw);
    const yy = y * Math.cos(pitch) + x * Math.sin(pitch) * 0.32;
    return [state.width/2 + xx * Math.min(state.width/2.9, state.height/2.55) * state.zoom,
      state.height/2 + yy * Math.min(state.width/2.9, state.height/2.55) * state.zoom];
  }
  function strokeCurve(points, color, width, glow=false) {
    const pp = points.map(proj);
    ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle=color; ctx.lineWidth=width;
    if (glow) { ctx.shadowColor=color; ctx.shadowBlur=16; }
    ctx.beginPath();
    pp.forEach((p,i)=> { if (!i) ctx.moveTo(...p); else ctx.lineTo(...p); });
    ctx.stroke(); ctx.restore();
  }
  function draw() {
    if (!ctx) return;
    const w=state.width,h=state.height,d=state.dpr;
    ctx.setTransform(d,0,0,d,0,0); ctx.clearRect(0,0,w,h);
    // faint orbit rings
    ctx.save(); ctx.translate(w/2,h*.49); ctx.strokeStyle='rgba(116,160,198,.13)'; ctx.lineWidth=1;
    [0.68,0.82,0.97].forEach(r=>{ctx.beginPath();ctx.ellipse(0,0,Math.min(w,h)*r*.46,Math.min(w,h)*r*.38,-.12,0,Math.PI*2);ctx.stroke();}); ctx.restore();
    // vessel roots behind the myocardium
    strokeCurve([[-.01,-1.12],[.04,-.91],[.04,-.72],[-.01,-.51],[-.3,-.44],[-.63,-.47],[-.72,-.24]],'#ba6475',Math.max(9,w/48));
    strokeCurve([[.35,-.45],[.39,-.7],[.39,-.96],[.38,-1.18]],'#5b80b8',Math.max(8,w/53));
    strokeCurve([[-.1,-.4],[-.22,-.65],[-.45,-.79],[-.62,-.82]],'#617fad',Math.max(7,w/58));
    // organ path, rendered with a soft volume and specular wash
    const center = proj([0,0]);
    const scale = Math.min(w/2.9,h/2.55)*state.zoom;
    ctx.save(); ctx.translate(w/2,h/2); ctx.scale(scale,scale);
    ctx.shadowColor='rgba(6,10,18,.48)'; ctx.shadowBlur=24; ctx.shadowOffsetY=10;
    const grad=ctx.createRadialGradient(-.25,-.48,.08,.05,.05,1.6);
    grad.addColorStop(0,'#ca7a84');grad.addColorStop(.32,'#9d4659');grad.addColorStop(.75,'#713246');grad.addColorStop(1,'#4c2639');
    ctx.fillStyle=grad;ctx.strokeStyle='rgba(241,167,167,.28)';ctx.lineWidth=.018;
    ctx.beginPath();
    ctx.moveTo(-.08,-1.25);
    ctx.bezierCurveTo(-.42,-1.47,-.92,-1.10,-.94,-.55);
    ctx.bezierCurveTo(-1.03,-.08,-.88,.27,-.60,.52);
    ctx.bezierCurveTo(-.40,.76,-.26,.98,-.23,1.18);
    ctx.bezierCurveTo(-.08,1.31,.18,1.11,.39,.86);
    ctx.bezierCurveTo(.66,.61,.94,.28,.94,-.15);
    ctx.bezierCurveTo(.97,-.57,.80,-.99,.50,-1.07);
    ctx.bezierCurveTo(.24,-1.15,.16,-1.13,-.08,-1.25);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.shadowColor='transparent';
    const sheen=ctx.createRadialGradient(-.32,-.48,.02,-.25,-.4,.75);sheen.addColorStop(0,'rgba(255,205,193,.2)');sheen.addColorStop(1,'rgba(255,205,193,0)');
    ctx.fillStyle=sheen;ctx.fill();
    // gentle myocardial seams
    ctx.lineWidth=.018;ctx.strokeStyle='rgba(57,22,40,.34)';ctx.beginPath();ctx.moveTo(-.72,-.28);ctx.bezierCurveTo(-.5,.06,-.28,.36,-.12,.68);ctx.stroke();
    ctx.beginPath();ctx.moveTo(.52,-.25);ctx.bezierCurveTo(.48,.1,.27,.48,.09,.72);ctx.stroke();
    ctx.restore();
    // score-coded vessel branches in front of the organ
    const canvasWidth = Math.max(3.2,w/145);
    Object.entries(paths).forEach(([key,pts])=>{
      const rgb=state.scores[key] == null ? [125,147,167] : scoreRGB(state.scores[key]);const color=rgba(rgb,.98);
      strokeCurve(pts,color,canvasWidth*(key===state.selected?1.1:1),true);
      strokeCurve(pts,'rgba(255,236,224,.42)',Math.max(1.1,canvasWidth*.22),false);
      const head=proj(pts[0]);ctx.beginPath();ctx.fillStyle=color;ctx.arc(head[0],head[1],key===state.selected?4.7:3.4,0,Math.PI*2);ctx.fill();
    });
  }
  function distanceToSegment(px,py,a,b) {
    const dx=b[0]-a[0],dy=b[1]-a[1];const den=dx*dx+dy*dy||1;
    const t=Math.max(0,Math.min(1,((px-a[0])*dx+(py-a[1])*dy)/den));
    return Math.hypot(px-(a[0]+t*dx),py-(a[1]+t*dy));
  }
  const down = e => { state.drag={x:e.clientX,y:e.clientY,yaw:state.yaw,pitch:state.pitch,moved:false}; };
  const move = e => { if(!state.drag)return;const dx=e.clientX-state.drag.x,dy=e.clientY-state.drag.y;if(Math.hypot(dx,dy)>3)state.drag.moved=true;state.yaw=state.drag.yaw+dx*.009;state.pitch=Math.max(-.55,Math.min(.55,state.drag.pitch+dy*.006));draw(); };
  const up = e => {
    if(!state.drag)return;const moved=state.drag.moved;state.drag=null;
    if(moved)return;
    const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
    let best=null,bestDist=Infinity;
    Object.entries(paths).forEach(([k,p])=>{const pp=p.map(proj);for(let i=0;i<pp.length-1;i++){const dist=distanceToSegment(x,y,pp[i],pp[i+1]);if(dist<bestDist){bestDist=dist;best=k;}}});
    if(best&&bestDist<Math.max(16,state.width*.045)){state.selected=best;draw();onSelect(best);}
  };
  const wheel = e => { e.preventDefault(); state.zoom=Math.max(.78,Math.min(1.45,state.zoom*(e.deltaY>0?.94:1.06)));draw(); };
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointerleave',()=>{state.drag=null;});canvas.addEventListener('wheel',wheel,{passive:false});
  const observer=new ResizeObserver(fit);observer.observe(canvas.parentElement||canvas);fit();
  return {
    updateScores(predictions){state.scores=Object.fromEntries(['LAD','LCX','RCA'].map(k=>[k,predictions?.[k]?.score??null]));draw();},
    setSelectedVessel(key,fire=true){state.selected=key;draw();if(fire)onSelect(key);},
    resetView(){state.yaw=0;state.pitch=0;state.zoom=1;draw();},
    dispose(){observer.disconnect();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('wheel',wheel);}
  };
}
