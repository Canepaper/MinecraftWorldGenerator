"use strict";
(function(){

/* =====================================================
   CONSTANTS & DEFAULTS
===================================================== */
var CHUNK_SIZES = [16,32,64,96,128,256,512,1024];
var TILE = 64; // sub-tile size for streaming mesh build

var DEFAULTS = {
  chunkIdx:5, waterLvl:36, maxHeight:128, seed:9043158,
  noiseType:'simplex',
  scale:0.2, oct:3, lac:2.15, gain:0.60,
  dscale:3.0, dmix:0, rscale:0.35, rmix:0.52, basemix:0.54, exp:1.96,
  snowPct:59, treeline:52, pineline:41, sandPct:108,
  showWater:true, wireframe:false, autoRotate:true, useWorkers:true, surfaceOnly:false,
  tSpacing:4, sparseDens:20,
  treeOak:40, treePine:35, treeAutumn:12, treeMystic:6, treeGolden:6, treeTropical:0,
  cloudH:120, cloudSpeed:0.3, cloudAmt:5, cloudSize:37, cloudOpa:0.88,
  tod:12,
};
var cfg = Object.assign({}, DEFAULTS);
var currentSeed = cfg.seed;
var renderTimeMs = 0;
var fps = 0;

/* =====================================================
   HELPERS
===================================================== */
function $e(id){ return document.getElementById(id); }
function sleep(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }

/* =====================================================
   PRNG
===================================================== */
function PRNG(seed){
  var s = ((seed ^ 0xdeadbeef) >>> 0) || 1;
  return function(){ s^=s<<13; s^=s>>>17; s^=s<<5; return (s>>>0)/4294967296; };
}

/* =====================================================
   PERLIN NOISE
===================================================== */
function makePerlin(seed){
  var rng=PRNG(seed), perm=new Uint8Array(512), i,j,tmp;
  for(i=0;i<256;i++) perm[i]=i;
  for(i=255;i>0;i--){ j=Math.floor(rng()*(i+1)); tmp=perm[i]; perm[i]=perm[j]; perm[j]=tmp; }
  for(i=0;i<256;i++) perm[i+256]=perm[i];
  function grad(h,x,y){ h&=3; var u=h<2?x:y, v=h<2?y:x; return ((h&1)?-u:u)+((h&2)?-v:v); }
  function fade(t){ return t*t*t*(t*(t*6-15)+10); }
  function lerp(a,b,t){ return a+t*(b-a); }
  return function(x,y){
    var xi=Math.floor(x)&255, yi=Math.floor(y)&255;
    var xf=x-Math.floor(x), yf=y-Math.floor(y);
    var u=fade(xf), v=fade(yf);
    var aa=perm[perm[xi]+yi], ab=perm[perm[xi]+yi+1];
    var ba=perm[perm[xi+1]+yi], bb=perm[perm[xi+1]+yi+1];
    return lerp(lerp(grad(aa,xf,yf),grad(ba,xf-1,yf),u),
                lerp(grad(ab,xf,yf-1),grad(bb,xf-1,yf-1),u),v)*0.5+0.5;
  };
}

/* =====================================================
   SIMPLEX NOISE
===================================================== */
function makeSimplex(seed){
  var rng=PRNG(seed), perm=new Uint8Array(512), i,j,tmp;
  for(i=0;i<256;i++) perm[i]=i;
  for(i=255;i>0;i--){ j=Math.floor(rng()*(i+1)); tmp=perm[i]; perm[i]=perm[j]; perm[j]=tmp; }
  for(i=0;i<256;i++) perm[i+256]=perm[i];
  var F2=0.5*(Math.sqrt(3)-1), G2=(3-Math.sqrt(3))/6;
  var GR=[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  function dot(g,x,y){ return g[0]*x+g[1]*y; }
  return function(xin,yin){
    var s=(xin+yin)*F2, ii=Math.floor(xin+s), jj=Math.floor(yin+s);
    var t=(ii+jj)*G2, x0=xin-(ii-t), y0=yin-(jj-t);
    var i1,j1; if(x0>y0){i1=1;j1=0;}else{i1=0;j1=1;}
    var x1=x0-i1+G2, y1=y0-j1+G2, x2=x0-1+2*G2, y2=y0-1+2*G2;
    var ia=ii&255, ja=jj&255;
    var g0=perm[ia+perm[ja]]%8, g1=perm[ia+i1+perm[ja+j1]]%8, g2=perm[ia+1+perm[ja+1]]%8;
    var n0=0,n1=0,n2=0;
    var t0=0.5-x0*x0-y0*y0; if(t0>=0){t0*=t0; n0=t0*t0*dot(GR[g0],x0,y0);}
    var t1=0.5-x1*x1-y1*y1; if(t1>=0){t1*=t1; n1=t1*t1*dot(GR[g1],x1,y1);}
    var t2=0.5-x2*x2-y2*y2; if(t2>=0){t2*=t2; n2=t2*t2*dot(GR[g2],x2,y2);}
    return (70*(n0+n1+n2))*0.5+0.5;
  };
}

function makeNoise(seed){
  return cfg.noiseType==='simplex' ? makeSimplex(seed) : makePerlin(seed);
}
function fbm(p,x,y,oct,lac,gain){
  var v=0,a=0.5,f=1,mx=0;
  for(var i=0;i<oct;i++){ v+=a*p(x*f,y*f); mx+=a; a*=gain; f*=lac; }
  return v/mx;
}

/* =====================================================
   TEXTURES
===================================================== */
var TEX_SIZE=64, TEXTURES={};

function makeCanv(s){ var c=document.createElement('canvas'); c.width=c.height=s; return c; }
function texRng(n){ var s=((n^0x5f3759df)>>>0)||1; return function(){ s^=s<<13; s^=s>>>17; s^=s<<5; return (s>>>0)/4294967296; }; }
function mkTex(cv){ var t=new THREE.CanvasTexture(cv); t.magFilter=t.minFilter=THREE.NearestFilter; return t; }

function buildTextures(){
  var T=TEX_SIZE;

  // Grass top
  (function(){ var cv=makeCanv(T),ctx=cv.getContext('2d'),rng=texRng(1);
    ctx.fillStyle='#5d9e3f'; ctx.fillRect(0,0,T,T);
    for(var i=0;i<140;i++){ var x=rng()*T,y=rng()*T,r=1+rng()*3;
      ctx.fillStyle='rgba('+Math.floor(60+rng()*60)+','+Math.floor(110+rng()*50)+','+Math.floor(20+rng()*40)+',0.55)'; ctx.fillRect(x,y,r,r); }
    for(var i=0;i<60;i++){ ctx.fillStyle='rgba(130,210,60,'+(0.25+rng()*0.3)+')'; ctx.fillRect(rng()*T,rng()*T,1,2+rng()*2); }
    TEXTURES.grassTop=mkTex(cv); })();

  // Grass side
  (function(){ var cv=makeCanv(T),ctx=cv.getContext('2d'),rng=texRng(2),sh=Math.ceil(T*0.18);
    ctx.fillStyle='#8B5E3C'; ctx.fillRect(0,0,T,T);
    for(var i=0;i<200;i++){ var x=rng()*T,y=T*0.18+rng()*T*0.82,v=Math.floor(100+rng()*60);
      ctx.fillStyle='rgba('+v+','+Math.floor(v*0.62)+','+Math.floor(v*0.35)+',0.5)'; ctx.fillRect(x,y,1+rng()*2,1+rng()*2); }
    ctx.fillStyle='#5d9e3f'; ctx.fillRect(0,0,T,sh);
    for(var i=0;i<30;i++){ ctx.fillStyle='rgba(80,170,30,'+(0.3+rng()*0.4)+')'; ctx.fillRect(rng()*T,0,1,sh); }
    TEXTURES.grassSide=mkTex(cv); })();

  // Dirt
  (function(){ var cv=makeCanv(T),ctx=cv.getContext('2d'),rng=texRng(3);
    ctx.fillStyle='#8B5E3C'; ctx.fillRect(0,0,T,T);
    for(var i=0;i<280;i++){ var v=Math.floor(90+rng()*80);
      ctx.fillStyle='rgba('+Math.floor(v*(0.9+rng()*0.2))+','+Math.floor(v*(0.55+rng()*0.15))+','+Math.floor(v*(0.28+rng()*0.12))+','+(0.35+rng()*0.45)+')';
      ctx.fillRect(rng()*T,rng()*T,1+Math.floor(rng()*3),1+Math.floor(rng()*3)); }
    TEXTURES.dirt=mkTex(cv); })();

  // Stone (world UV tiling)
  (function(){ var cv=makeCanv(T),ctx=cv.getContext('2d'),rng=texRng(4);
    ctx.fillStyle='#888'; ctx.fillRect(0,0,T,T);
    for(var c=0;c<8;c++){ var x=rng()*T,y=rng()*T; ctx.beginPath(); ctx.moveTo(x,y);
      for(var s=0;s<6;s++){ x+=(rng()-0.5)*14; y+=(rng()-0.5)*14; ctx.lineTo(x,y); }
      ctx.strokeStyle='rgba(48,48,48,'+(0.3+rng()*0.35)+')'; ctx.lineWidth=0.5+rng(); ctx.stroke(); }
    for(var i=0;i<320;i++){ var v=Math.floor(100+rng()*80);
      ctx.fillStyle='rgba('+v+','+v+','+(v-5)+','+(0.25+rng()*0.4)+')';
      ctx.fillRect(rng()*T,rng()*T,1+Math.floor(rng()*2),1+Math.floor(rng()*2)); }
    var t=mkTex(cv); t.wrapS=t.wrapT=THREE.RepeatWrapping; TEXTURES.stone=t; })();

  // Deep stone
  (function(){ var cv=makeCanv(T),ctx=cv.getContext('2d'),rng=texRng(10);
    ctx.fillStyle='#555'; ctx.fillRect(0,0,T,T);
    for(var i=0;i<200;i++){ var v=Math.floor(55+rng()*50);
      ctx.fillStyle='rgba('+v+','+v+','+(v-3)+','+(0.3+rng()*0.4)+')';
      ctx.fillRect(rng()*T,rng()*T,1+Math.floor(rng()*2),1+Math.floor(rng()*2)); }
    var t=mkTex(cv); t.wrapS=t.wrapT=THREE.RepeatWrapping; TEXTURES.deepStone=t; })();

  // Sand
  (function(){ var cv=makeCanv(T),ctx=cv.getContext('2d'),rng=texRng(5);
    ctx.fillStyle='#d4b483'; ctx.fillRect(0,0,T,T);
    for(var i=0;i<300;i++){ var v=Math.floor(190+rng()*50);
      ctx.fillStyle='rgba('+v+','+Math.floor(v*0.82)+','+Math.floor(v*0.52)+','+(0.2+rng()*0.4)+')';
      ctx.fillRect(rng()*T,rng()*T,1,1); }
    TEXTURES.sand=mkTex(cv); })();

  // Water
  (function(){ var cv=makeCanv(T),ctx=cv.getContext('2d'),rng=texRng(6);
    var grd=ctx.createLinearGradient(0,0,T,T); grd.addColorStop(0,'#2d7dd2'); grd.addColorStop(1,'#1a5fa0');
    ctx.fillStyle=grd; ctx.fillRect(0,0,T,T);
    for(var i=0;i<40;i++){ ctx.fillStyle='rgba(150,220,255,'+(0.08+rng()*0.12)+')'; ctx.fillRect(rng()*T,rng()*T,4+rng()*10,1); }
    TEXTURES.water=mkTex(cv); })();

  // Log side
  (function(){ var cv=makeCanv(T),ctx=cv.getContext('2d'),rng=texRng(7);
    ctx.fillStyle='#6b4c2a'; ctx.fillRect(0,0,T,T);
    for(var i=0;i<T;i+=2+Math.floor(rng()*3)){
      ctx.fillStyle='rgba('+Math.floor(60+rng()*50)+','+Math.floor(30+rng()*30)+',10,'+(0.2+rng()*0.35)+')'; ctx.fillRect(i,0,1,T); }
    TEXTURES.log=mkTex(cv); })();

  // Log top (rings)
  (function(){ var cv=makeCanv(T),ctx=cv.getContext('2d'),rng=texRng(17);
    ctx.fillStyle='#5a3e22'; ctx.fillRect(0,0,T,T);
    var cx=T/2, cy=T/2;
    for(var r=4;r<T/2;r+=4+Math.floor(rng()*3)){
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
      ctx.strokeStyle='rgba('+(50+Math.floor(rng()*40))+','+(25+Math.floor(rng()*25))+',8,'+(0.3+rng()*0.4)+')';
      ctx.lineWidth=1+rng(); ctx.stroke(); }
    TEXTURES.logTop=mkTex(cv); })();

  // Snow
  (function(){ var cv=makeCanv(T),ctx=cv.getContext('2d'),rng=texRng(9);
    ctx.fillStyle='#eef4f7'; ctx.fillRect(0,0,T,T);
    for(var i=0;i<80;i++){ ctx.fillStyle='rgba(200,220,240,'+(0.15+rng()*0.25)+')'; ctx.fillRect(rng()*T,rng()*T,2+rng()*4,1); }
    TEXTURES.snow=mkTex(cv); })();

  // Pine needle texture
  (function(){ var cv=makeCanv(T),ctx=cv.getContext('2d'),rng=texRng(20);
    ctx.fillStyle='#1e5c18'; ctx.fillRect(0,0,T,T);
    for(var i=0;i<200;i++){ var v=Math.floor(30+rng()*60);
      ctx.fillStyle='rgba('+v+','+(v+40)+','+v+','+(0.4+rng()*0.4)+')';
      ctx.fillRect(rng()*T,rng()*T,1,3+rng()*5); }
    TEXTURES.pine=mkTex(cv); })();

  // Leaf variants
  mkLeafTex('leavesOak',     11, [45,158,30]);
  mkLeafTex('leavesPine',    12, [30,100,25]);
  mkLeafTex('leavesAutumn',  13, [190,55,30]);
  mkLeafTex('leavesMystic',  14, [140,50,210]);
  mkLeafTex('leavesGolden',  15, [210,170,20]);
  mkLeafTex('leavesTropical',16, [30,170,120]);

  Object.keys(TEXTURES).forEach(function(k){ TEXTURES[k].magFilter=TEXTURES[k].minFilter=THREE.NearestFilter; });
}

function mkLeafTex(key, sn, base){
  var cv=makeCanv(TEX_SIZE), ctx=cv.getContext('2d'), rng=texRng(sn), T=TEX_SIZE;
  ctx.fillStyle='rgb('+base[0]+','+base[1]+','+base[2]+')'; ctx.fillRect(0,0,T,T);
  for(var i=0;i<140;i++){
    var r=Math.floor(base[0]*(0.6+rng()*0.6)), g=Math.floor(base[1]*(0.6+rng()*0.6)), b=Math.floor(base[2]*(0.6+rng()*0.6));
    ctx.fillStyle='rgba('+r+','+g+','+b+','+(0.35+rng()*0.45)+')';
    ctx.fillRect(rng()*T,rng()*T,2+rng()*5,2+rng()*5); }
  TEXTURES[key]=mkTex(cv);
}

/* =====================================================
   MATERIALS
===================================================== */
var matCache={};
function getMat(texKey, opts){
  var k=texKey+(opts||'');
  if(matCache[k]) return matCache[k];
  var m=new THREE.MeshLambertMaterial({
    map: TEXTURES[texKey],
    transparent: !!(opts&&opts.t),
    opacity: opts&&opts.o!=null ? opts.o : 1,
    side: opts&&opts.d ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: !(opts&&opts.t),
    wireframe: cfg.wireframe
  });
  matCache[k]=m; return m;
}

function getTexKey(type, fi){
  if(type.indexOf(':')!==-1){ return type.split(':')[1]; }
  switch(type){
    case 'grass': return fi===2?'grassTop':fi===3?'dirt':'grassSide';
    case 'dirt':  return 'dirt';
    case 'stone': return 'stone';
    case 'deep':  return 'deepStone';
    case 'sand':  return 'sand';
    case 'water': return 'water';
    case 'log':   return fi===2||fi===3?'logTop':'log';
    case 'pinelog': return fi===2||fi===3?'logTop':'log';
    case 'snow':  return fi===2?'snow':fi===3?'dirt':'grassSide';
    default:      return 'stone';
  }
}
function isLeafBlock(t){ return t.indexOf('leaves')!==-1; }

/* =====================================================
   FACE DEFS
===================================================== */
var FACE_DEF=[
  {d:[1,0,0],  fi:0,v:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]],n:[1,0,0]},
  {d:[-1,0,0], fi:1,v:[[0,0,1],[0,1,1],[0,1,0],[0,0,0]],n:[-1,0,0]},
  {d:[0,1,0],  fi:2,v:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]],n:[0,1,0]},
  {d:[0,-1,0], fi:3,v:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]],n:[0,-1,0]},
  {d:[0,0,1],  fi:4,v:[[1,0,1],[1,1,1],[0,1,1],[0,0,1]],n:[0,0,1]},
  {d:[0,0,-1], fi:5,v:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]],n:[0,0,-1]},
];
var QUAD_UV=[[0,0],[0,1],[1,1],[1,0]];
var STONE_SCALE=1/4;
function stoneUV(bx,by,bz,fi,vi){
  var ov=FACE_DEF[fi].v[vi], wx=bx+ov[0], wy=by+ov[1], wz=bz+ov[2];
  var u,v;
  if(fi===2||fi===3){u=wx;v=wz;} else if(fi===0||fi===1){u=wz;v=wy;} else{u=wx;v=wy;}
  return [u*STONE_SCALE, v*STONE_SCALE];
}

/* =====================================================
   TREE BUILDERS
===================================================== */
function treeOak(rng, leafKey){
  var blocks=[], th=4+Math.floor(rng()*3), lr=2+(rng()>0.4?1:0);
  for(var y=1;y<=th;y++) blocks.push({dx:0,dy:y,dz:0,type:'log'});
  var top=th;
  for(var ly=top-1;ly<=top+2;ly++){
    var r=(ly>=top)?Math.max(1,lr-1):lr;
    for(var lx=-r;lx<=r;lx++) for(var lz=-r;lz<=r;lz++){
      if(lx===0&&lz===0&&ly<top) continue;
      if(Math.abs(lx)+Math.abs(lz)<=r&&rng()>0.1) blocks.push({dx:lx,dy:ly,dz:lz,type:'leaves:'+leafKey});
    }
  }
  return blocks;
}

function treePine(rng){
  var blocks=[], th=8+Math.floor(rng()*7);
  for(var y=1;y<=th;y++) blocks.push({dx:0,dy:y,dz:0,type:'pinelog'});
  blocks.push({dx:0,dy:th+1,dz:0,type:'leaves:pine'});
  for(var tier=0;tier<Math.floor(th*0.7);tier+=2){
    var y=th-tier, r=Math.max(0,Math.floor(tier*0.5));
    for(var lx=-r;lx<=r;lx++) for(var lz=-r;lz<=r;lz++){
      if(lx===0&&lz===0) continue;
      if(Math.abs(lx)+Math.abs(lz)<=r+1) blocks.push({dx:lx,dy:y,dz:lz,type:'leaves:pine'});
    }
  }
  return blocks;
}

function treeAutumn(rng){ return treeOak(rng,'leavesAutumn'); }
function treeMystic(rng){ return treeOak(rng,'leavesMystic'); }
function treeGolden(rng){ return treeOak(rng,'leavesGolden'); }
function treeTropical(rng){
  var blocks=[], th=7+Math.floor(rng()*5);
  for(var y=1;y<=th;y++) blocks.push({dx:0,dy:y,dz:0,type:'log'});
  var dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
  for(var di=0;di<dirs.length;di++){
    var dx=dirs[di][0], dz=dirs[di][1];
    for(var r=1;r<=4;r++){
      var drop=Math.floor(r*0.6);
      if(rng()>0.15) blocks.push({dx:dx*r,dy:th-drop,dz:dz*r,type:'leaves:leavesTropical'});
    }
  }
  blocks.push({dx:0,dy:th+1,dz:0,type:'leaves:leavesTropical'});
  return blocks;
}

var TREE_BUILDERS = {
  oak:     function(rng){ return treeOak(rng,'leavesOak'); },
  pine:    treePine,
  autumn:  treeAutumn,
  mystic:  treeMystic,
  golden:  treeGolden,
  tropical:treeTropical,
};

/* =====================================================
   WORLD GEN  — returns colMap (column-indexed block store)
   colMap[x][z] = array of {y, type} sorted ascending
   This lets each tile mesh only its own columns in O(tile) time.
===================================================== */
function genWorld(seed){
  var CHUNK  = CHUNK_SIZES[cfg.chunkIdx];
  var WATER  = cfg.waterLvl;
  var MAXH   = cfg.maxHeight;

  var pBase   = makeNoise(seed);
  var pDetail = makeNoise(seed+7331);
  var pRidge  = makeNoise(seed+31337);

  /* --- Height map --- */
  var heights = new Int32Array(CHUNK*CHUNK);
  for(var z=0;z<CHUNK;z++) for(var x=0;x<CHUNK;x++){
    var nx=x/CHUNK, nz=z/CHUNK;
    var base   = fbm(pBase,  nx*cfg.scale+10, nz*cfg.scale+7,  cfg.oct,cfg.lac,cfg.gain);
    var detail = fbm(pDetail,nx*cfg.dscale+30,nz*cfg.dscale+20,Math.min(4,cfg.oct),2.0,0.5)*cfg.dmix;
    var ridge  = (1-Math.abs(fbm(pRidge,nx*cfg.rscale+60,nz*cfg.rscale+50,3,2.0,0.5)*2-1));
    ridge = Math.pow(ridge,2)*cfg.rmix;
    var h = base*cfg.basemix + detail + ridge;
    h = Math.pow(Math.max(0,h), cfg.exp);
    heights[z*CHUNK+x] = Math.max(1, Math.min(MAXH, Math.round(h*(MAXH-2)+2)));
  }

  /* --- Thresholds --- */
  var snowLine = Math.round(MAXH * (cfg.snowPct  / 100));
  var treeLine = Math.round(MAXH * (cfg.treeline / 100));
  var pineLine = Math.round(MAXH * (cfg.pineline / 100));
  var sandLine = Math.round(WATER * (cfg.sandPct / 100));

  /* --- Tree placement --- */
  var fullPool=[];
  var nonPineCounts={oak:cfg.treeOak,autumn:cfg.treeAutumn,mystic:cfg.treeMystic,golden:cfg.treeGolden,tropical:cfg.treeTropical};
  var npKeys=Object.keys(nonPineCounts);
  for(var ti=0;ti<npKeys.length;ti++){
    for(var tc=0;tc<nonPineCounts[npKeys[ti]];tc++) fullPool.push(npKeys[ti]);
  }
  for(var tc=0;tc<cfg.treePine;tc++) fullPool.push('pine');

  var srng=PRNG(seed+1234);
  for(var i=fullPool.length-1;i>0;i--){ var j=Math.floor(srng()*(i+1)); var tmp=fullPool[i]; fullPool[i]=fullPool[j]; fullPool[j]=tmp; }

  var totalTrees=fullPool.length, placed=[], trng=PRNG(seed+8888);
  var attempts=0, poolIdx=0, sp=cfg.tSpacing;

  while(poolIdx<totalTrees && attempts<totalTrees*10){
    attempts++;
    var tx=2+Math.floor(trng()*(CHUNK-4)), tz=2+Math.floor(trng()*(CHUNK-4));
    var th=heights[tz*CHUNK+tx];
    if(th>=snowLine||th<=sandLine||th<=WATER||th>MAXH-6) continue;

    var zone = (th>=treeLine)?'sparse':(th>=pineLine)?'pine':'all';
    var ttype;
    if(zone==='sparse'){
      if(trng()*100>cfg.sparseDens) continue;
      ttype='pine';
    } else if(zone==='pine'){
      ttype='pine';
    } else {
      if(poolIdx>=fullPool.length) break;
      ttype=fullPool[poolIdx];
    }

    var ok=true;
    for(var k=0;k<placed.length;k++){
      if(Math.abs(placed[k].tx-tx)<sp&&Math.abs(placed[k].tz-tz)<sp){ ok=false; break; }
    }
    if(!ok) continue;
    placed.push({tx:tx,tz:tz,th:th,ttype:ttype});
    if(zone==='all') poolIdx++;
  }

  /* --- Column-indexed block store ---
     colMap is a flat array indexed [x + z*CHUNK], each cell is
     a typed array of alternating [y0,typeId0, y1,typeId1, ...]
     We use integer typeIds for compactness; lookups via typeNames[].
  */
  // Type registry: string → int
  var typeNames=[];  // int → string
  var typeIds=Object.create(null); // string → int
  function getTypeId(s){
    if(typeIds[s]!=null) return typeIds[s];
    var id=typeNames.length; typeNames.push(s); typeIds[s]=id; return id;
  }

  // colMap[col] = Int16Array of [y, typeId, y, typeId, ...]  sorted ascending y
  var colMap=new Array(CHUNK*CHUNK);

  var surfaceOnly = !!cfg.surfaceOnly;
  for(var z=0;z<CHUNK;z++) for(var x=0;x<CHUNK;x++){
    var h=heights[z*CHUNK+x];
    var col=[];
    if(surfaceOnly){
      var type;
      if(h<=sandLine)      type='sand';
      else if(h>=snowLine) type='snow';
      else                 type='grass';
      col.push(h, getTypeId(type));
      if(cfg.showWater && h<WATER) col.push(WATER, getTypeId('water'));
    } else {
      for(var y=0;y<=h;y++){
        var type;
        if(y===h){
          if(h<=sandLine)      type='sand';
          else if(h>=snowLine) type='snow';
          else                 type='grass';
        } else if(y>=h-3){    type=(h<=sandLine+1)?'sand':'dirt'; }
        else if(y>=h-10){     type='stone'; }
        else{                 type='deep'; }
        col.push(y, getTypeId(type));
      }
      if(cfg.showWater && h<WATER){
        for(var y=h+1;y<=WATER;y++) col.push(y, getTypeId('water'));
      }
    }
    colMap[x+z*CHUNK]=col;
  }

  // Place trees into colMap
  var lrng=PRNG(seed+555);
  for(var pi=0;pi<placed.length;pi++){
    var p=placed[pi];
    var builder=TREE_BUILDERS[p.ttype]||TREE_BUILDERS.oak;
    var tblocks=builder(lrng);
    for(var bi=0;bi<tblocks.length;bi++){
      var tb=tblocks[bi];
      var bx=p.tx+tb.dx, bz=p.tz+tb.dz, by=p.th+tb.dy;
      if(bx<0||bx>=CHUNK||bz<0||bz>=CHUNK||by<0) continue;
      var col2=colMap[bx+bz*CHUNK];
      // Insert or overwrite y entry (trees overwrite terrain)
      var found=false;
      for(var ci=0;ci<col2.length;ci+=2){ if(col2[ci]===by){ col2[ci+1]=getTypeId(tb.type); found=true; break; } }
      if(!found) col2.push(by, getTypeId(tb.type));
    }
  }

  return { colMap:colMap, typeNames:typeNames, CHUNK:CHUNK };
}

/* =====================================================
   TILE BLOCK LOOKUP  — O(1) given colMap
===================================================== */
// Build a fast lookup function from colMap for a given world
function makeLookup(colMap, typeNames, CHUNK){
  // Returns type string at (x,y,z) or null
  return function getBlock(x,y,z){
    if(x<0||x>=CHUNK||z<0||z>=CHUNK||y<0) return null;
    var col=colMap[x+z*CHUNK];
    for(var ci=0;ci<col.length;ci+=2){
      if(col[ci]===y) return typeNames[col[ci+1]];
    }
    return null;
  };
}

/* =====================================================
   MESH BUILD — O(tile columns * max_height) not O(whole world)
===================================================== */
function buildTileMesh(colMap, typeNames, getBlock, CHUNK, tileX, tileZ, tileW, tileH){
  var buckets=Object.create(null);
  function bkt(k){
    if(!buckets[k]) buckets[k]={pos:[],nor:[],uv:[],idx:[],isStone:k==='stone'||k==='deepStone'};
    return buckets[k];
  }

  // Only iterate columns within this tile
  for(var bz=tileZ;bz<tileZ+tileH;bz++){
    for(var bx=tileX;bx<tileX+tileW;bx++){
      var col=colMap[bx+bz*CHUNK];
      for(var ci=0;ci<col.length;ci+=2){
        var by=col[ci];
        var type=typeNames[col[ci+1]];
        var isW=type==='water', isL=isLeafBlock(type);

        for(var fi=0;fi<6;fi++){
          var fd=FACE_DEF[fi];
          var nb=getBlock(bx+fd.d[0], by+fd.d[1], bz+fd.d[2]);
          if(nb){
            if(isW){ if(nb==='water') continue; if(fi!==2) continue; }
            else if(isL){ if(isLeafBlock(nb)) continue; }
            else{ if(!isLeafBlock(nb)&&nb!=='water') continue; }
          }

          var tk=getTexKey(type,fi);
          if(!TEXTURES[tk]) tk='stone';
          var b=bkt(tk), base=b.pos.length/3;
          for(var vi=0;vi<4;vi++){
            var ov=fd.v[vi];
            b.pos.push(bx+ov[0],by+ov[1],bz+ov[2]);
            b.nor.push(fd.n[0],fd.n[1],fd.n[2]);
            var uv=b.isStone?stoneUV(bx,by,bz,fi,vi):QUAD_UV[vi];
            b.uv.push(uv[0],uv[1]);
          }
          b.idx.push(base,base+1,base+2,base,base+2,base+3);
        }
      }
    }
  }

  return bucketsToGroup(buckets);
}

function bucketsToGroup(buckets){
  var group=new THREE.Group();
  Object.keys(buckets).forEach(function(tk){
    var b=buckets[tk]; if(!b.pos.length) return;
    var geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(b.pos,3));
    geo.setAttribute('normal',  new THREE.Float32BufferAttribute(b.nor,3));
    geo.setAttribute('uv',      new THREE.Float32BufferAttribute(b.uv,2));
    geo.setIndex(b.idx); geo.computeBoundingSphere();
    var isLeafTk=tk.indexOf('leaves')!==-1||tk==='pine';
    var transp=tk==='water'||isLeafTk;
    var mat=getMat(tk, transp?{t:true,o:tk==='water'?0.80:0.87,d:true}:null);
    var mesh=new THREE.Mesh(geo,mat);
    mesh.castShadow=tk!=='water'; mesh.receiveShadow=true;
    group.add(mesh);
  });
  return group;
}

/* =====================================================
   THREE.JS  SETUP
===================================================== */
var cv=$e('cv');
var renderer=new THREE.WebGLRenderer({canvas:cv, antialias:false, alpha:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.setClearColor(0x000000, 0); // transparent — sky canvas shows through
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;

var scene=new THREE.Scene();
// Fog colour is updated dynamically with time of day
scene.fog=new THREE.Fog(0x87CEEB, 180, 900);

var camera=new THREE.PerspectiveCamera(58,1,0.1,2000);

function onResize(){
  renderer.setSize(window.innerWidth,window.innerHeight);
  camera.aspect=window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  // also resize sky canvas
  var sc=$e('sky-canvas');
  sc.width=window.innerWidth; sc.height=window.innerHeight;
  drawSky();
}
window.addEventListener('resize',onResize);

/* =====================================================
   TIME OF DAY  —  sky, light, stars, sun/moon sprite
===================================================== */

// Ambient + directional + hemisphere lights — updated by applyTOD()
var ambLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambLight);

var sunLight = new THREE.DirectionalLight(0xfffde7, 1.2);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.left = -300; sunLight.shadow.camera.right = 300;
sunLight.shadow.camera.top  = 300;  sunLight.shadow.camera.bottom = -300;
sunLight.shadow.camera.near = 1;    sunLight.shadow.camera.far = 1000;
scene.add(sunLight);

// Separate moon light — cool white, no shadows, active at night
var moonLight = new THREE.DirectionalLight(0xb8c8e8, 0.0);
moonLight.castShadow = false;
scene.add(moonLight);

var hemiLight = new THREE.HemisphereLight(0x8ec8f0, 0x3e6e30, 0.5);
scene.add(hemiLight);

// Lerp helper for colours
function lerpColor(a,b,t){
  var ar=(a>>16)&0xff, ag=(a>>8)&0xff, ab=a&0xff;
  var br=(b>>16)&0xff, bg=(b>>8)&0xff, bb=b&0xff;
  return (Math.round(ar+(br-ar)*t)<<16)|(Math.round(ag+(bg-ag)*t)<<8)|Math.round(ab+(bb-ab)*t);
}
function hexToRGB(h){ return [(h>>16)&0xff,(h>>8)&0xff,h&0xff]; }
function RGBToCSS(r,g,b){ return 'rgb('+r+','+g+','+b+')'; }

// Sky colour palette keyed by hour (0-24)
var SKY_KEYS = [
  // hr   top        bot        amb   sun   moon  hemiSky    fog        sunCol
  { h:0,  top:0x04040e, bot:0x08091c, amb:0.12, sun:0.0,  moon:0.55, hs:0x0c0e22, fog:0x08091c, sc:0xe8eeff }, // midnight
  { h:4,  top:0x06071a, bot:0x0d0e2a, amb:0.12, sun:0.0,  moon:0.50, hs:0x10122a, fog:0x0a0b22, sc:0xe0e8ff }, // 4am
  { h:5,  top:0x1a0a20, bot:0x3a1a18, amb:0.16, sun:0.05, moon:0.20, hs:0x201028, fog:0x2a1518, sc:0xff8c40 }, // pre-dawn
  { h:6,  top:0x3a1a0a, bot:0xd4602a, amb:0.28, sun:0.55, moon:0.0,  hs:0x402010, fog:0xb04818, sc:0xffcc44 }, // sunrise
  { h:7,  top:0x6a8ab0, bot:0xffa040, amb:0.38, sun:0.85, moon:0.0,  hs:0x6070a0, fog:0xe88030, sc:0xffe060 }, // 7am
  { h:8,  top:0x82aad0, bot:0xc8d8f0, amb:0.44, sun:1.05, moon:0.0,  hs:0x78a0c8, fog:0xb0cce0, sc:0xfffbe0 }, // 8am
  { h:12, top:0x5fa8d8, bot:0xc8e8f8, amb:0.48, sun:1.30, moon:0.0,  hs:0x88c0e8, fog:0x87CEEB, sc:0xfffbe0 }, // noon
  { h:16, top:0x5fa8d8, bot:0xc8e8f8, amb:0.44, sun:1.15, moon:0.0,  hs:0x80b8e0, fog:0x8ac8e8, sc:0xfffbe0 }, // 4pm
  { h:18, top:0x5a3818, bot:0xf08030, amb:0.30, sun:0.65, moon:0.0,  hs:0x503020, fog:0xd06820, sc:0xffcc44 }, // sunset
  { h:19, top:0x28180a, bot:0x7a2808, amb:0.18, sun:0.10, moon:0.10, hs:0x201010, fog:0x4a1808, sc:0xff9020 }, // dusk
  { h:20, top:0x06060f, bot:0x10101e, amb:0.13, sun:0.0,  moon:0.45, hs:0x0a0a1a, fog:0x0d0d1c, sc:0xe0e8ff }, // night
  { h:24, top:0x04040e, bot:0x08091c, amb:0.12, sun:0.0,  moon:0.55, hs:0x0c0e22, fog:0x08091c, sc:0xe8eeff }, // midnight
];

function sampleSky(hour){
  var lo=SKY_KEYS[0], hi=SKY_KEYS[SKY_KEYS.length-1];
  for(var i=0;i<SKY_KEYS.length-1;i++){
    if(hour>=SKY_KEYS[i].h && hour<=SKY_KEYS[i+1].h){ lo=SKY_KEYS[i]; hi=SKY_KEYS[i+1]; break; }
  }
  var t=(lo.h===hi.h)?0:(hour-lo.h)/(hi.h-lo.h);
  // star visibility: bright at midnight, fade by 7am, fade back in after 7pm
  var starA=0;
  if(hour<6)       starA=0.6+0.3*(1-hour/6);
  else if(hour<8)  starA=0.6*(1-(hour-6)/2);
  else if(hour<18) starA=0;
  else if(hour<20) starA=0.4*(hour-18)/2;
  else             starA=0.4+0.5*(hour-20)/4;
  return {
    top:  lerpColor(lo.top, hi.top, t),
    bot:  lerpColor(lo.bot, hi.bot, t),
    amb:  lo.amb+(hi.amb-lo.amb)*t,
    sun:  lo.sun+(hi.sun-lo.sun)*t,
    moon: lo.moon+(hi.moon-lo.moon)*t,
    hs:   lerpColor(lo.hs, hi.hs, t),
    fog:  lerpColor(lo.fog, hi.fog, t),
    sc:   lerpColor(lo.sc, hi.sc, t),
    stars:Math.max(0,Math.min(1,starA))
  };
}

// Draw the 2D sky gradient on the background canvas
function drawSky(){
  var sc=$e('sky-canvas');
  if(!sc) return;
  var ctx=sc.getContext('2d');
  var W=sc.width||window.innerWidth, H=sc.height||window.innerHeight;
  var s=sampleSky(cfg.tod);
  var topRGB=hexToRGB(s.top), botRGB=hexToRGB(s.bot);
  var grd=ctx.createLinearGradient(0,0,0,H);
  grd.addColorStop(0, RGBToCSS(topRGB[0],topRGB[1],topRGB[2]));
  grd.addColorStop(1, RGBToCSS(botRGB[0],botRGB[1],botRGB[2]));
  ctx.fillStyle=grd; ctx.fillRect(0,0,W,H);

  // Stars — drawn per-pixel on sky canvas with stable PRNG positions
  if(s.stars>0.01){
    var starRng=PRNG(777);
    for(var i=0;i<500;i++){
      var sx=starRng()*W, sy=starRng()*H*0.72;
      var brightness=0.5+starRng()*0.5;
      var sr=0.4+starRng()*1.0;
      var alpha=s.stars*brightness;
      ctx.fillStyle='rgba(220,230,255,'+alpha.toFixed(3)+')';
      ctx.beginPath(); ctx.arc(sx,sy,sr,0,Math.PI*2); ctx.fill();
    }
  }

  // Sun arc in 2D sky:
  // The sun travels a SEMICIRCLE across the TOP half of the screen.
  // angle=0 → left horizon (6am), angle=PI/2 → top-centre (noon), angle=PI → right horizon (6pm)
  // Moon travels the BOTTOM half (night arc, below horizon)
  var sunAngle  = Math.max(0, Math.min(Math.PI, ((cfg.tod - 6) / 12) * Math.PI));
  var moonAngle = Math.max(0, Math.min(Math.PI, ((cfg.tod - 18 + 24) % 24 / 12) * Math.PI));

  // Arc: centre at horizon line (H*0.78), radius stretches to top
  var horizY = H * 0.78;
  var arcRX2  = W * 0.42;
  var arcRY2  = H * 0.75; // tall arc so noon sun is high up

  function arcPos(angle){
    // angle 0 = LEFT  (cos=1 → x=left side)
    // angle PI= RIGHT (cos=-1 → x=right side)
    // We want: angle 0 → LEFT, angle PI → RIGHT, so use cos(PI-angle)
    return {
      x: W*0.5 + arcRX2 * Math.cos(Math.PI - angle),
      y: horizY  - arcRY2 * Math.sin(angle)   // sin>0 moves UP
    };
  }

  var sunPos  = arcPos(sunAngle);
  var moonPos = arcPos(moonAngle);

  var isDay = (cfg.tod>=5.5 && cfg.tod<=18.5);

  // Draw sun
  if(cfg.tod>=5.5 && cfg.tod<=18.5){
    var sunCol=hexToRGB(s.sc);
    var grd2=ctx.createRadialGradient(sunPos.x,sunPos.y,0,sunPos.x,sunPos.y,48);
    grd2.addColorStop(0,'rgba('+sunCol[0]+','+sunCol[1]+','+sunCol[2]+',0.85)');
    grd2.addColorStop(0.25,'rgba('+sunCol[0]+','+sunCol[1]+','+sunCol[2]+',0.25)');
    grd2.addColorStop(1,'rgba('+sunCol[0]+','+sunCol[1]+','+sunCol[2]+',0)');
    ctx.fillStyle=grd2; ctx.beginPath(); ctx.arc(sunPos.x,sunPos.y,48,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgb('+sunCol[0]+','+sunCol[1]+','+sunCol[2]+')';
    ctx.beginPath(); ctx.arc(sunPos.x,sunPos.y,15,0,Math.PI*2); ctx.fill();
  }

  // Draw moon (visible at night)
  if(cfg.tod<6 || cfg.tod>18){
    var moonAlpha=Math.min(1, s.stars*1.5+0.3);
    // Moon glow
    ctx.fillStyle='rgba(200,215,245,'+Math.min(1,moonAlpha*0.4)+')';
    ctx.beginPath(); ctx.arc(moonPos.x,moonPos.y,28,0,Math.PI*2); ctx.fill();
    // Moon disc
    ctx.fillStyle='rgba(215,225,248,'+moonAlpha+')';
    ctx.beginPath(); ctx.arc(moonPos.x,moonPos.y,11,0,Math.PI*2); ctx.fill();
  }
}

// Apply time-of-day to 3D lights and fog
function applyTOD(){
  var s=sampleSky(cfg.tod);
  var CHUNK=CHUNK_SIZES[cfg.chunkIdx];
  var cx=CHUNK/2, cz=CHUNK/2;

  // Sun position: arc from east (6am) OVERHEAD (12pm) to west (18pm)
  // sunAngle: 0 at 6am (east horizon), PI/2 at noon (zenith), PI at 6pm (west horizon)
  var sunAngle3d = Math.max(0, Math.min(Math.PI, ((cfg.tod-6)/12)*Math.PI));
  var sunDist=800;
  // sin(sunAngle3d): 0 at horizon, 1 at noon — drives Y height
  // cos: 1 at 6am (east), 0 at noon, -1 at 6pm (west) → negate to get east→west travel
  sunLight.position.set(
    cx - sunDist*Math.cos(sunAngle3d),  // east at 6am (-x side), west at 6pm (+x side)
    Math.max(20, sunDist*Math.sin(sunAngle3d)), // Y: high at noon, horizon at dawn/dusk
    cz + sunDist*0.15
  );
  sunLight.intensity = s.sun;
  var sc=hexToRGB(s.sc);
  sunLight.color.setRGB(sc[0]/255, sc[1]/255, sc[2]/255);

  // Moon: opposite arc (rises at 6pm, overhead at midnight, sets at 6am)
  var moonAngle3d = sunAngle3d + Math.PI;
  moonLight.position.set(
    cx - sunDist*Math.cos(moonAngle3d),
    Math.max(20, sunDist*Math.sin(moonAngle3d)),
    cz + sunDist*0.15
  );
  moonLight.intensity = s.moon;

  ambLight.intensity = s.amb;

  var hs=hexToRGB(s.hs);
  hemiLight.color.setRGB(hs[0]/255, hs[1]/255, hs[2]/255);
  hemiLight.groundColor.setHex(s.sun>0.1 ? 0x3e6e30 : 0x1a1a30);
  hemiLight.intensity = Math.max(0.08, s.amb*1.0);

  var fc=hexToRGB(s.fog);
  scene.fog.color.setRGB(fc[0]/255, fc[1]/255, fc[2]/255);

  drawSky();
  drawTODArc();
}

// Draw the time-of-day arc in sidebar
function drawTODArc(){
  var arc=$e('tod-arc'); if(!arc) return;
  var ctx=arc.getContext('2d'), W=arc.width, H=arc.height;
  ctx.clearRect(0,0,W,H);
  var grd=ctx.createLinearGradient(0,0,W,0);
  grd.addColorStop(0,'#04040e'); grd.addColorStop(0.22,'#d4602a');
  grd.addColorStop(0.26,'#ffa040'); grd.addColorStop(0.5,'#5fa8d8');
  grd.addColorStop(0.74,'#f08030'); grd.addColorStop(0.78,'#130a20');
  grd.addColorStop(1,'#04040e');
  ctx.fillStyle=grd; ctx.fillRect(0,4,W,H-10);
  ctx.fillStyle='rgba(255,255,255,0.28)'; ctx.font='7px monospace'; ctx.textAlign='center';
  [0,6,12,18,24].forEach(function(h){ ctx.fillText(h+'h',h/24*W,H-1); });
  var px=cfg.tod/24*W;
  ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.fillRect(px-1,2,2,H-12);
  var isDay=(cfg.tod>=5.5&&cfg.tod<=18.5);
  ctx.fillStyle=isDay?'#ffee66':'#c8d8f0';
  ctx.beginPath(); ctx.arc(px,H/2-5,4,0,Math.PI*2); ctx.fill();
}

/* =====================================================
   FLAT MINECRAFT-STYLE CLOUD SYSTEM
   Each cloud = organic blob built with exterior-faces-only
   meshing, so transparency works perfectly (no internal
   touching quads causing double-opacity artifacts).
   Geometry is in LOCAL space (origin = cloud centre).
   mesh.position drives world placement + drift.
===================================================== */
var cloudGroup = new THREE.Group();
scene.add(cloudGroup);

function buildClouds(){
  while(cloudGroup.children.length){
    var c=cloudGroup.children[0];
    c.geometry.dispose();
    if(c.material) c.material.dispose();
    cloudGroup.remove(c);
  }
  cloudOffset=0; // reset drift on rebuild
  if(cfg.cloudAmt===0) return;

  var prng  = PRNG(999);
  var WORLD = CHUNK_SIZES[cfg.chunkIdx];
  var BSZ   = 4;   // block size in world units
  var BH    = 4;   // cloud slab height (MC style: thin flat layer)

  for(var ci=0;ci<cfg.cloudAmt;ci++){
    // World position of cloud centre
    var wx0 = prng()*WORLD;
    var wz0 = prng()*WORLD;
    var S   = Math.max(4, cfg.cloudSize|0);

    // ---- Build organic blob on a 2D grid ----
    // Grid dimensions in cells (each cell = BSZ world units)
    var GW = Math.ceil(S/BSZ)+2;
    var GH = Math.ceil(S/BSZ)+2;
    var grid = new Uint8Array(GW*GH);

    // Start from centre, grow outward with weighted random walk
    var sx=Math.floor(GW/2), sz=Math.floor(GH/2);
    grid[sx+sz*GW]=1;
    var filled=1;
    var target=Math.max(3, Math.floor(GW*GH*(0.28+prng()*0.30)));
    // Keep a proper frontier queue (use splice-free approach for speed)
    var frontier=[sx+sz*GW];
    var fi=0; // read head
    var dirs=[1,-1,GW,-GW];
    while(filled<target && fi<frontier.length){
      // Pick random element from remaining frontier
      var pick=fi+Math.floor(prng()*(frontier.length-fi));
      var tmp=frontier[fi]; frontier[fi]=frontier[pick]; frontier[pick]=tmp;
      var cur=frontier[fi++];
      var cx2=cur%GW, cz2=Math.floor(cur/GW);
      // Try all 4 neighbours in random order
      var ds=dirs.slice(); // shallow copy
      for(var di=3;di>0;di--){ var dj=Math.floor(prng()*(di+1)); var dt2=ds[di]; ds[di]=ds[dj]; ds[dj]=dt2; }
      for(var di=0;di<4;di++){
        var ni=cur+ds[di];
        var nx2=ni%GW, nz2=Math.floor(ni/GW);
        if(ni>=0&&ni<GW*GH&&nz2>=0&&nz2<GH&&nx2>=0&&nx2<GW&&!grid[ni]){
          // Boundary-distance bias: slightly prefer cells closer to centre for rounder shapes
          var dist=Math.abs(nx2-sx)+Math.abs(nz2-sz);
          if(prng()<0.85-dist/(GW*0.5)*0.2){
            grid[ni]=1; filled++;
            frontier.push(ni);
          }
        }
      }
    }

    // ---- Emit exterior faces only (LOCAL space — centred at 0,0,0) ----
    var positions=[], normals=[], indices=[];
    var vi=0;

    // All vertices are relative to the cloud's local origin (wx0, cloudH, wz0)
    for(var gz=0;gz<GH;gz++){
      for(var gx=0;gx<GW;gx++){
        if(!grid[gx+gz*GW]) continue;
        // Local position of this block's corner
        var lx = (gx - GW/2) * BSZ;
        var ly = 0;   // bottom of slab at local y=0
        var lz = (gz - GH/2) * BSZ;
        var B=BSZ, H2=BH;

        // Helper: emit one quad. All coords in local space.
        function quad(ax,ay,az, bx,by,bz, cx3,cy3,cz3, dx2,dy2,dz2, nx3,ny3,nz3){
          positions.push(ax,ay,az, bx,by,bz, cx3,cy3,cz3, dx2,dy2,dz2);
          normals.push(nx3,ny3,nz3, nx3,ny3,nz3, nx3,ny3,nz3, nx3,ny3,nz3);
          indices.push(vi,vi+1,vi+2, vi,vi+2,vi+3);
          vi+=4;
        }

        // Top (+Y)
        quad(lx,ly+H2,lz, lx+B,ly+H2,lz, lx+B,ly+H2,lz+B, lx,ly+H2,lz+B, 0,1,0);
        // Bottom (-Y)
        quad(lx,ly,lz+B, lx+B,ly,lz+B, lx+B,ly,lz, lx,ly,lz, 0,-1,0);
        // East (+X) — only if no eastern neighbour
        if(!(gx+1<GW&&grid[(gx+1)+gz*GW]))
          quad(lx+B,ly,lz+B, lx+B,ly,lz, lx+B,ly+H2,lz, lx+B,ly+H2,lz+B, 1,0,0);
        // West (-X)
        if(!(gx>0&&grid[(gx-1)+gz*GW]))
          quad(lx,ly,lz, lx,ly,lz+B, lx,ly+H2,lz+B, lx,ly+H2,lz, -1,0,0);
        // North (-Z)
        if(!(gz>0&&grid[gx+(gz-1)*GW]))
          quad(lx+B,ly,lz, lx,ly,lz, lx,ly+H2,lz, lx+B,ly+H2,lz, 0,0,-1);
        // South (+Z)
        if(!(gz+1<GH&&grid[gx+(gz+1)*GW]))
          quad(lx,ly,lz+B, lx+B,ly,lz+B, lx+B,ly+H2,lz+B, lx,ly+H2,lz+B, 0,0,1);
      }
    }

    if(positions.length===0) continue;
    var geo=new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,3));
    geo.setIndex(indices);

    var mat=new THREE.MeshLambertMaterial({
      color:0xffffff, transparent:true, opacity:cfg.cloudOpa,
      depthWrite:false, side:THREE.FrontSide
    });

    var mesh=new THREE.Mesh(geo,mat);
    // Place mesh at world position — geometry is in local space
    mesh.position.set(wx0, cfg.cloudH, wz0);
    mesh.userData.startX=wx0; // original X for wrap calculation
    cloudGroup.add(mesh);
  }
}

function updateCloudOpacity(){
  cloudGroup.children.forEach(function(m){ if(m.material) m.material.opacity=cfg.cloudOpa; });
}

var cloudOffset=0;
var lastCloudTime=performance.now();
var frameCount=0, lastFpsTime=performance.now();

/* =====================================================
   ORBIT CONTROLS
===================================================== */
var orb={theta:-0.35,phi:0.80,radius:130,target:new THREE.Vector3(32,10,32),mx:0,my:0,ldown:false,rdown:false,touchActive:false};
cv.addEventListener('mousedown',function(e){ if(e.button===0) orb.ldown=true; if(e.button===2) orb.rdown=true; orb.mx=e.clientX; orb.my=e.clientY; });
cv.addEventListener('contextmenu',function(e){ e.preventDefault(); });
window.addEventListener('mouseup',function(){ orb.ldown=orb.rdown=false; });
window.addEventListener('mousemove',function(e){
  var dx=e.clientX-orb.mx, dy=e.clientY-orb.my; orb.mx=e.clientX; orb.my=e.clientY;
  if(orb.ldown){ cfg.autoRotate=false; if(autoRotateController) autoRotateController.updateDisplay(); orb.theta-=dx*0.005; orb.phi=Math.max(0.06,Math.min(Math.PI/2-0.04,orb.phi-dy*0.005)); }
  if(orb.rdown){ var r=new THREE.Vector3(-Math.cos(orb.theta),0,Math.sin(orb.theta)); orb.target.addScaledVector(r,dx*0.14); orb.target.y=Math.max(-2,Math.min(200,orb.target.y-dy*0.14)); }
});
cv.addEventListener('wheel',function(e){ orb.radius=Math.max(12,Math.min(700,orb.radius+e.deltaY*0.18)); },{passive:true});
// Touch
var lt=[];
cv.addEventListener('touchstart',function(e){ orb.touchActive=true; lt=Array.from(e.touches); },{passive:true});
cv.addEventListener('touchend',function(e){ if(e.touches.length===0) orb.touchActive=false; },{passive:true});
cv.addEventListener('touchcancel',function(e){ if(e.touches.length===0) orb.touchActive=false; },{passive:true});
cv.addEventListener('touchmove',function(e){
  if(e.touches.length===1&&lt.length>=1){ cfg.autoRotate=false; if(autoRotateController) autoRotateController.updateDisplay(); orb.theta-=(e.touches[0].clientX-lt[0].clientX)*0.006; orb.phi=Math.max(0.06,Math.min(Math.PI/2-0.04,orb.phi-(e.touches[0].clientY-lt[0].clientY)*0.006)); }
  else if(e.touches.length===2&&lt.length>=2){ var d0=Math.hypot(lt[0].clientX-lt[1].clientX,lt[0].clientY-lt[1].clientY); var d1=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY); orb.radius=Math.max(12,Math.min(700,orb.radius-(d1-d0)*0.3)); }
  lt=Array.from(e.touches);
},{passive:true});

/* =====================================================
   GENERATE  —  streams tiles one per frame after first render
===================================================== */
var worldGroup = null;
var renderCancelToken = {id:0};

function setProgress(p,msg){ $e('bar').style.width=p+'%'; if(msg) $e('load-status').textContent=msg; }

async function generate(seed, opts){
  opts=opts||{};
  renderCancelToken.id++;
  var myToken = renderCancelToken.id;
  var skipLoading = opts.skipLoading;
  var renderStart = performance.now();

  var loading=$e('loading');
  if(!skipLoading){ loading.style.opacity='1'; loading.style.pointerEvents='all'; }
  $e('render-toast').style.display='none';

  $e('hud-seed').textContent=seed;
  var CHUNK=CHUNK_SIZES[cfg.chunkIdx];
  $e('hud-size').textContent=CHUNK; $e('hud-size2').textContent=CHUNK;

  setProgress(0,'BUILDING TEXTURES...'); await sleep(skipLoading?0:20);
  matCache={}; buildTextures();

  setProgress(15,'GENERATING WORLD...'); await sleep(skipLoading?0:10);
  var result = genWorld(seed);
  var colMap=result.colMap, typeNames=result.typeNames;
  var getBlock=makeLookup(colMap,typeNames,CHUNK);

  // Clear old world
  if(worldGroup){ scene.remove(worldGroup); worldGroup.traverse(function(o){ if(o.geometry) o.geometry.dispose(); }); }
  worldGroup = new THREE.Group();
  scene.add(worldGroup);

  // Camera reset
  orb.target.set(CHUNK/2, cfg.waterLvl+4, CHUNK/2);
  orb.radius = CHUNK*1.6;

  // Build tile list (spiral from centre for nicer progressive reveal)
  var tiles=[];
  for(var tz=0;tz<CHUNK;tz+=TILE) for(var tx=0;tx<CHUNK;tx+=TILE){
    tiles.push({tx:tx, tz:tz, tw:Math.min(TILE,CHUNK-tx), th:Math.min(TILE,CHUNK-tz)});
  }
  // Sort tiles by distance from centre so centre loads first
  var cx=CHUNK/2, cz=CHUNK/2;
  tiles.sort(function(a,b){
    var da=Math.pow(a.tx+a.tw/2-cx,2)+Math.pow(a.tz+a.th/2-cz,2);
    var db=Math.pow(b.tx+b.tw/2-cx,2)+Math.pow(b.tz+b.th/2-cz,2);
    return da-db;
  });

  setProgress(40,'MESHING CENTRE TILE...'); await sleep(skipLoading?0:5);

  // Build first (centre) tile — hide loading after this so user can interact
  var t0=tiles[0];
  var m0=buildTileMesh(colMap,typeNames,getBlock,CHUNK,t0.tx,t0.tz,t0.tw,t0.th);
  worldGroup.add(m0);

  setProgress(100,'READY'); await sleep(skipLoading?20:120);
  if(!skipLoading){ loading.style.opacity='0'; loading.style.pointerEvents='none'; }

  buildClouds(); // rebuild with correct world size
  applyTOD();   // re-sync sky/lighting

  // Stream remaining tiles
  if(tiles.length>1){
    var toast=$e('render-toast'), tbar=$e('toast-bar'), ttxt=$e('toast-text');
    toast.style.display='block'; toast.style.opacity='1';

    if(cfg.useWorkers){
      // Parallel build with worker pool
      var numWorkers=Math.min(navigator.hardwareConcurrency||4, tiles.length-1);
      var workerPool=[], nextTile=1, pending=0, doneCount=0;
      for(var wi=0;wi<numWorkers;wi++){
        try{
          var w=new Worker('scripts/mesh-worker.js');
          w.onmessage=function(msg){
            var r=msg.data;
            worldGroup.add(bucketsToGroup(r.buckets));
            doneCount++;
            var pct=Math.round((doneCount+1)/tiles.length*100);
            ttxt.textContent='WORKERS  '+pct+'%  ('+doneCount+' / '+(tiles.length-1)+' tiles)';
            tbar.style.width=pct+'%';
            pending--;
            if(nextTile<tiles.length){
              var t=tiles[nextTile], tid=nextTile;
              this.postMessage({id:tid,colMap:colMap,typeNames:typeNames,CHUNK:CHUNK,tileX:t.tx,tileZ:t.tz,tileW:t.tw,tileH:t.th});
              nextTile++; pending++;
            }
            if(pending===0){
              renderTimeMs=Math.round(performance.now()-renderStart);
              var hr=$e('hud-render-time'); if(hr) hr.textContent=(renderTimeMs/1000).toFixed(2)+'s';
              toast.style.transition='opacity 0.6s'; toast.style.opacity='0';
              setTimeout(function(){ toast.style.display='none'; toast.style.opacity='1'; toast.style.transition=''; }, 650);
              for(var wi2=0;wi2<workerPool.length;wi2++) workerPool[wi2].terminate();
            }
          };
          workerPool.push(w);
          var t=tiles[nextTile];
          w.postMessage({id:nextTile,colMap:colMap,typeNames:typeNames,CHUNK:CHUNK,tileX:t.tx,tileZ:t.tz,tileW:t.tw,tileH:t.th});
          nextTile++; pending++;
        }catch(err){ cfg.useWorkers=false; break; }
      }
      if(!cfg.useWorkers){
        for(var wi2=0;wi2<workerPool.length;wi2++) workerPool[wi2].terminate();
      }
    }
    if(!cfg.useWorkers){
      // Sequential build (original behavior)
      for(var ti=1;ti<tiles.length;ti++){
        if(renderCancelToken.id!==myToken){ toast.style.display='none'; return; }
        var t=tiles[ti];
        var mesh=buildTileMesh(colMap,typeNames,getBlock,CHUNK,t.tx,t.tz,t.tw,t.th);
        worldGroup.add(mesh);
        var pct=Math.round((ti+1)/tiles.length*100);
        ttxt.textContent='STREAMING  '+pct+'%  ('+(ti+1)+' / '+tiles.length+' tiles)';
        tbar.style.width=pct+'%';
        await sleep(0);
      }
      toast.style.transition='opacity 0.6s';
      toast.style.opacity='0';
      await sleep(650);
      toast.style.display='none'; toast.style.opacity='1'; toast.style.transition='';
    }
  }

  if(!cfg.useWorkers||tiles.length<=1){
    renderTimeMs=Math.round(performance.now()-renderStart);
    var hudRender=$e('hud-render-time');
    if(hudRender) hudRender.textContent=(renderTimeMs/1000).toFixed(2)+'s';
  }
  var blockCount=0; for(var ci=0;ci<colMap.length;ci++) blockCount+=colMap[ci].length>>1;
  var hb=$e('hud-blocks'); if(hb) hb.textContent=blockCount.toLocaleString();
  var hc=$e('hud-chunks'); if(hc) hc.textContent=tiles.length;
  drawNoisePreview();
}

/* =====================================================
   NOISE PREVIEW (minimap)
===================================================== */
var noiseDebounce;
function scheduleNoise(){ clearTimeout(noiseDebounce); noiseDebounce=setTimeout(drawNoisePreview,120); }

function drawNoisePreview(){
  var canvas=$e('noise-preview');
  if(!canvas) return;
  var ctx=canvas.getContext('2d');
  var W=Math.max(1, canvas.clientWidth||220), H=Math.max(1, canvas.clientHeight||220);
  if(canvas.width!==W||canvas.height!==H){ canvas.width=W; canvas.height=H; }
  var p1=makeNoise(currentSeed), p2=makeNoise(currentSeed+7331), p3=makeNoise(currentSeed+31337);
  var img=ctx.createImageData(W,H);
  var MAXH=cfg.maxHeight, WATER=cfg.waterLvl;
  var snowLine=cfg.snowPct/100, treelineN=cfg.treeline/100, pinelineN=cfg.pineline/100;
  var sandH=(cfg.sandPct/100)*WATER/MAXH;
  for(var py=0;py<H;py++) for(var px=0;px<W;px++){
    var nx=px/W, nz=py/H;
    var base  =fbm(p1,nx*cfg.scale+10,nz*cfg.scale+7,cfg.oct,cfg.lac,cfg.gain);
    var detail=fbm(p2,nx*cfg.dscale+30,nz*cfg.dscale+20,Math.min(4,cfg.oct),2.0,0.5)*cfg.dmix;
    var ridge =(1-Math.abs(fbm(p3,nx*cfg.rscale+60,nz*cfg.rscale+50,3,2.0,0.5)*2-1));
    ridge=Math.pow(ridge,2)*cfg.rmix;
    var h=base*cfg.basemix+detail+ridge;
    h=Math.pow(Math.max(0,h),cfg.exp); h=Math.max(0,Math.min(1,h));
    var wl=WATER/MAXH;
    var r,g,b;
    if(h<wl-0.01){r=45;g=100;b=200;}
    else if(h<wl+0.012){r=210;g=185;b=130;}
    else if(h>snowLine){r=230;g=240;b=245;}
    else if(h>treelineN){r=Math.floor(80+h*60);g=Math.floor(110+h*70);b=Math.floor(80+h*50);}
    else if(h>pinelineN){r=Math.floor(30+h*40);g=Math.floor(80+h*60);b=Math.floor(30+h*30);}
    else{var t=h;r=Math.floor(35+t*55);g=Math.floor(100+t*80);b=Math.floor(18+t*28);}
    var idx=(py*W+px)*4; img.data[idx]=r; img.data[idx+1]=g; img.data[idx+2]=b; img.data[idx+3]=255;
  }
  ctx.putImageData(img,0,0);
}

/* =====================================================
   LIL-GUI
===================================================== */
var treeRegenDebounce;
function scheduleTreeRegenerate(){
  clearTimeout(treeRegenDebounce);
  treeRegenDebounce=setTimeout(function(){ currentSeed=cfg.seed; generate(currentSeed, {skipLoading:true}); }, 400);
}

var gui, autoRotateController;
function setupGUI(){
  if(gui) gui.destroy();
  gui = new lil.GUI({ title: 'Minecraft World Generator' });

  var chunkOpts = { 16:0, 32:1, 64:2, 96:3, 128:4, 256:5, 512:6, 1024:7 };
  var chunkFolder = gui.addFolder('Chunk');
  chunkFolder.add(cfg, 'chunkIdx', chunkOpts).name('Size').onChange(function(){ currentSeed=cfg.seed; generate(currentSeed); });
  chunkFolder.add(cfg, 'waterLvl', 2, 60, 1).name('Water Level').onChange(function(){ scheduleNoise(); scheduleTreeRegenerate(); });
  chunkFolder.add(cfg, 'maxHeight', 16, 128, 1).name('Max Height').onChange(function(){ scheduleNoise(); scheduleTreeRegenerate(); });
  chunkFolder.add(cfg, 'seed', 0, 9999999, 1).name('Seed');
  chunkFolder.add({ gen: function(){ currentSeed=cfg.seed; generate(currentSeed); } }, 'gen').name('Generate');
  chunkFolder.add({ rand: function(){ cfg.seed=currentSeed=Math.floor(Math.random()*9999999); generate(currentSeed); } }, 'rand').name('Randomise Seed');
  chunkFolder.add({ reset: function(){ Object.assign(cfg,DEFAULTS); currentSeed=cfg.seed; setupGUI(); buildClouds(); applyTOD(); generate(currentSeed); } }, 'reset').name('Reset Defaults');

  var noiseFolder = gui.addFolder('Noise');
  noiseFolder.add(cfg, 'noiseType', { Perlin: 'perlin', Simplex: 'simplex' }).name('Algorithm').onChange(scheduleNoise);
  noiseFolder.add(cfg, 'scale', 0.1, 5, 0.05).name('Scale').onChange(scheduleNoise);
  noiseFolder.add(cfg, 'oct', 1, 10, 1).name('Octaves').onChange(scheduleNoise);
  noiseFolder.add(cfg, 'lac', 1.2, 4, 0.05).name('Lacunarity').onChange(scheduleNoise);
  noiseFolder.add(cfg, 'gain', 0.1, 0.9, 0.01).name('Persistence').onChange(scheduleNoise);
  noiseFolder.add(cfg, 'dscale', 0.1, 5, 0.05).name('Detail Scale').onChange(scheduleNoise);
  noiseFolder.add(cfg, 'dmix', 0, 0.8, 0.01).name('Detail Mix').onChange(scheduleNoise);
  noiseFolder.add(cfg, 'rscale', 0.1, 4, 0.05).name('Ridge Scale').onChange(scheduleNoise);
  noiseFolder.add(cfg, 'rmix', 0, 0.6, 0.01).name('Ridge Mix').onChange(scheduleNoise);
  noiseFolder.add(cfg, 'basemix', 0.1, 1, 0.01).name('Base Mix').onChange(scheduleNoise);
  noiseFolder.add(cfg, 'exp', 0.3, 3, 0.02).name('Exponent').onChange(scheduleNoise);

  var treeFolder = gui.addFolder('Trees');
  treeFolder.add(cfg, 'snowPct', 40, 98, 1).name('Snow Line %').onChange(function(){ scheduleNoise(); scheduleTreeRegenerate(); });
  treeFolder.add(cfg, 'treeline', 30, 95, 1).name('Tree Line %').onChange(function(){ scheduleNoise(); scheduleTreeRegenerate(); });
  treeFolder.add(cfg, 'pineline', 10, 90, 1).name('Pine Line %').onChange(function(){ scheduleNoise(); scheduleTreeRegenerate(); });
  treeFolder.add(cfg, 'sandPct', 100, 130, 1).name('Sand Line %').onChange(function(){ scheduleNoise(); scheduleTreeRegenerate(); });
  treeFolder.add(cfg, 'treeOak', 0, 120, 1).name('Oak').onChange(scheduleTreeRegenerate);
  treeFolder.add(cfg, 'treePine', 0, 120, 1).name('Pine').onChange(scheduleTreeRegenerate);
  treeFolder.add(cfg, 'treeAutumn', 0, 120, 1).name('Autumn').onChange(scheduleTreeRegenerate);
  treeFolder.add(cfg, 'treeMystic', 0, 120, 1).name('Mystic').onChange(scheduleTreeRegenerate);
  treeFolder.add(cfg, 'treeGolden', 0, 120, 1).name('Golden').onChange(scheduleTreeRegenerate);
  treeFolder.add(cfg, 'treeTropical', 0, 120, 1).name('Tropical').onChange(scheduleTreeRegenerate);
  treeFolder.add(cfg, 'tSpacing', 2, 16, 1).name('Min Spacing').onChange(scheduleTreeRegenerate);
  treeFolder.add(cfg, 'sparseDens', 0, 100, 1).name('Sparse Density %').onChange(scheduleTreeRegenerate);

  var skyFolder = gui.addFolder('Sky & Clouds');
  skyFolder.add(cfg, 'tod', 0, 24, 0.25).name('Time of Day').onChange(applyTOD);
  skyFolder.add(cfg, 'cloudH', 80, 300, 5).name('Cloud Height').onChange(buildClouds);
  skyFolder.add(cfg, 'cloudSpeed', 0, 5, 0.1).name('Cloud Speed');
  skyFolder.add(cfg, 'cloudAmt', 0, 60, 1).name('Cloud Amount').onChange(buildClouds);
  skyFolder.add(cfg, 'cloudSize', 4, 60, 1).name('Cloud Size').onChange(buildClouds);
  skyFolder.add(cfg, 'cloudOpa', 0.1, 1, 0.02).name('Cloud Opacity').onChange(updateCloudOpacity);
  skyFolder.close();

  var optionsFolder = gui.addFolder('Options');
  optionsFolder.add(cfg, 'showWater').name('Show Water');
  optionsFolder.add(cfg, 'surfaceOnly').name('Surface Only').onChange(function(){ currentSeed=cfg.seed; generate(currentSeed); });
  optionsFolder.add(cfg, 'wireframe').name('Wireframe').onChange(function(){
    if(worldGroup) worldGroup.traverse(function(o){ if(o.material) o.material.wireframe=cfg.wireframe; });
  });
  autoRotateController = optionsFolder.add(cfg, 'autoRotate').name('Auto-rotate');
  optionsFolder.add(cfg, 'useWorkers').name('Use Workers');
  optionsFolder.close();

  var wrap = document.createElement('div');
  wrap.id = 'minimap-wrap';
  wrap.className = 'minimap-in-gui';
  var canvas = document.createElement('canvas');
  canvas.id = 'noise-preview';
  canvas.title = 'Terrain preview';
  wrap.appendChild(canvas);
  gui.$children.insertBefore(wrap, gui.$children.firstChild);
}

// Info modal — contributors loaded from contributors/contributors.js
(function(){
  var modal=$e('info-modal'), btn=$e('info-btn'), close=$e('modal-close'), list=$e('contributors-list');
  if(!modal||!btn) return;
  function renderContributors(){
    if(!list) return;
    var data=typeof CONTRIBUTORS_DATA!=='undefined'?CONTRIBUTORS_DATA:[];
    if(data.length===0){ list.innerHTML='<p class="text-dim">No contributors yet. Add yourself in contributors/contributors.js!</p>'; return; }
    list.innerHTML=data.map(function(c){
      var avatar=c.avatar||(c.github?('https://github.com/'+String(c.github).replace(/^https?:\/\/github\.com\//,'').replace(/\/.*$/,'')+'.png'):'');
      var avatarHtml=avatar
        ?'<img class="contributor-avatar" src="'+avatar+'" alt="'+String(c.name||'').replace(/"/g,'&quot;')+'" loading="lazy">'
        :'<div class="contributor-avatar placeholder">?</div>';
      var gh=c.github||'#';
      return '<div class="contributor-card">'+avatarHtml+
        '<div class="contributor-name">'+(c.name||'')+'</div>'+
        '<div class="contributor-title">'+(c.title||'')+'</div>'+
        '<div class="contributor-desc">'+(c.description||'')+'</div>'+
        '<a class="contributor-github" href="'+gh+'" target="_blank" rel="noopener">GitHub</a></div>';
    }).join('');
  }
  renderContributors();
  function openModal(){ modal.classList.add('open'); }
  function closeModal(){ modal.classList.remove('open'); }
  function toggleModal(){ modal.classList.toggle('open'); }
  btn.addEventListener('click',openModal);
  close.addEventListener('click',closeModal);
  modal.addEventListener('click',function(e){ if(e.target===modal) closeModal(); });
  window.addEventListener('keydown',function(e){ if(e.key==='i'||e.key==='I'){ e.preventDefault(); toggleModal(); } });
  document.querySelectorAll('.modal-tab').forEach(function(tab){
    tab.addEventListener('click',function(){
      document.querySelectorAll('.modal-tab').forEach(function(t){ t.classList.remove('active'); });
      document.querySelectorAll('.modal-pane').forEach(function(p){ p.classList.remove('active'); });
      this.classList.add('active');
      var pane=$e('tab-'+this.dataset.tab);
      if(pane) pane.classList.add('active');
    });
  });
})();

/* =====================================================
   INIT
===================================================== */
currentSeed = cfg.seed;
setupGUI();
onResize(); // sets sky canvas size + draws sky
applyTOD();
buildClouds();
generate(currentSeed);
drawNoisePreview();

/* =====================================================
   RENDER LOOP
===================================================== */
function animate(){
  requestAnimationFrame(animate);
  var now=performance.now();
  var dt=Math.min(0.1,(now-lastCloudTime)/1000);
  lastCloudTime=now;

  if(cfg.autoRotate&&!orb.ldown&&!orb.rdown&&!orb.touchActive) orb.theta+=0.04*dt;
  camera.position.x=orb.target.x+orb.radius*Math.sin(orb.phi)*Math.sin(orb.theta);
  camera.position.y=orb.target.y+orb.radius*Math.cos(orb.phi);
  camera.position.z=orb.target.z+orb.radius*Math.sin(orb.phi)*Math.cos(orb.theta);
  camera.lookAt(orb.target);

  // Animate clouds — drift along +X, wrap within world
  if(cfg.cloudSpeed>0 && cloudGroup.children.length>0){
    var WORLD=CHUNK_SIZES[cfg.chunkIdx];
    cloudOffset += cfg.cloudSpeed*dt*6;
    for(var ci=0;ci<cloudGroup.children.length;ci++){
      var cm=cloudGroup.children[ci];
      // New world X = (startX + cloudOffset) wrapped to [0, WORLD)
      var wx=(cm.userData.startX + cloudOffset) % WORLD;
      if(wx<0) wx+=WORLD;
      cm.position.x=wx;
    }
  }

  frameCount++;
  var now2=performance.now();
  if(now2-lastFpsTime>=500){ fps=Math.round(frameCount/((now2-lastFpsTime)/1000)); frameCount=0; lastFpsTime=now2; var h=$e('hud-fps'); if(h) h.textContent=fps; }

  renderer.render(scene,camera);
}
animate();

})();
