/**
 * Web Worker for building tile mesh geometry (pos, nor, uv, idx).
 * Runs mesh computation off main thread for multi-core parallelism.
 */
var FACE_DEF = [
  {d:[1,0,0],  fi:0,v:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]],n:[1,0,0]},
  {d:[-1,0,0], fi:1,v:[[0,0,1],[0,1,1],[0,1,0],[0,0,0]],n:[-1,0,0]},
  {d:[0,1,0],  fi:2,v:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]],n:[0,1,0]},
  {d:[0,-1,0], fi:3,v:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]],n:[0,-1,0]},
  {d:[0,0,1],  fi:4,v:[[1,0,1],[1,1,1],[0,1,1],[0,0,1]],n:[0,0,1]},
  {d:[0,0,-1], fi:5,v:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]],n:[0,0,-1]},
];
var QUAD_UV = [[0,0],[0,1],[1,1],[1,0]];
var STONE_SCALE = 1/4;

function getTexKey(type, fi){
  if(type.indexOf(':')!==-1) return type.split(':')[1];
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

function stoneUV(bx,by,bz,fi,vi){
  var ov=FACE_DEF[fi].v[vi], wx=bx+ov[0], wy=by+ov[1], wz=bz+ov[2];
  var u,v;
  if(fi===2||fi===3){u=wx;v=wz;} else if(fi===0||fi===1){u=wz;v=wy;} else{u=wx;v=wy;}
  return [u*STONE_SCALE, v*STONE_SCALE];
}

function buildTileMeshData(colMap, typeNames, CHUNK, tileX, tileZ, tileW, tileH){
  function getBlock(x,y,z){
    if(x<0||x>=CHUNK||z<0||z>=CHUNK||y<0) return null;
    var col=colMap[x+z*CHUNK];
    for(var ci=0;ci<col.length;ci+=2){
      if(col[ci]===y) return typeNames[col[ci+1]];
    }
    return null;
  }

  var buckets = Object.create(null);
  function bkt(k){
    if(!buckets[k]) buckets[k]={pos:[],nor:[],uv:[],idx:[],isStone:k==='stone'||k==='deepStone'};
    return buckets[k];
  }

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
          if(!tk) tk='stone';
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

  return buckets;
}

self.onmessage = function(e){
  var d = e.data;
  var buckets = buildTileMeshData(d.colMap, d.typeNames, d.CHUNK, d.tileX, d.tileZ, d.tileW, d.tileH);
  self.postMessage({ id: d.id, buckets: buckets });
};
