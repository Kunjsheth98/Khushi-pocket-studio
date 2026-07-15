'use strict';

// ══════════════════════════
//  GLOBAL ERROR CATCHER — so a bug is visible, never silent again
// ══════════════════════════
window.addEventListener('error', function(e){
  console.error('APP ERROR:', e.message, 'at', e.filename+':'+e.lineno);
  var bar = document.getElementById('err-bar');
  if(bar){
    bar.textContent = '⚠️ Something broke: ' + e.message + ' (line ' + e.lineno + ')';
    bar.style.display = 'block';
  }
});

// ══════════════════════════
//  STATE
// ══════════════════════════
let curTool = 'pen';
let curColor = '#C9B8E8';
let brushSz = 5;
let curOpacity = 1;
let curBg = '#FFFFFF';
let stampColor = '#333333';
let selStamp = null;
let activeCat = 'All';
let customStamps = JSON.parse(localStorage.getItem('khushi_custom_stamps') || '[]');
let favStamps = JSON.parse(localStorage.getItem('khushi_fav_stamps') || '[]');
let searchQuery = '';

let mainDrawing = false;
let mainCtx = null;
let lastPX = 0, lastPY = 0;

let tplColor = '#C9B8E8';
let tplSz = 10;
let tplDrawing = false;
let tplCtx = null;
let curTplIdx = -1;
let tplUndo = [];
let tplRedo = [];
let activeDL = 'main';

let undoStack = [];
let redoStack = [];

let ddTool = 'pen';
let ddColor = '#000000';
let ddSz = 4;
let ddDrawing = false;
let ddCtx = null;
let doodleInited = false;

const BRUSH_TYPES = {
  pen:      { widthMul: 1,    alphaMul: 1,    smooth: false },
  pencil:   { widthMul: 0.6,  alphaMul: 0.85, smooth: false },
  brush:    { widthMul: 2,    alphaMul: 1,    smooth: true  },
  marker:   { widthMul: 2.5,  alphaMul: 0.55, smooth: false },
  watercolor:{widthMul: 3.2,  alphaMul: 0.35, smooth: true  },
  crayon:   { widthMul: 1.8,  alphaMul: 0.75, smooth: false },
  glitter:  { widthMul: 1.4,  alphaMul: 1,    smooth: false, sparkle:true },
};

// ══════════════════════════
//  COLORS
// ══════════════════════════
const COLORS = [
  '#FFFFFF','#FFF0F5','#FFD6E8','#F7A0B5','#FF6B9D','#FF4080',
  '#FFC8D8','#FFB3C6','#F7C5D0','#E8B8D4','#D4A0C8','#C9B8E8',
  '#B8A0E0','#9B85CC','#7B65B8','#6A4FA0','#C8E8FF','#80C8FF',
  '#4090E0','#2060C0','#B8F0E0','#40C8A0','#20A080','#008060',
  '#FFE8A0','#FFD060','#FFA820','#FF8000','#D4C0A8','#907060',
  '#F0F0F0','#D0D0D0','#A0A0A0','#707070','#404040','#000000',
  '#FFD700','#FF6347','#DC143C','#800080',
];
const TINTS = ['#000000','#444444','#9B85CC','#F7A0B5','#40C8A0','#2060C0','#FF8000','#DC143C','#FFFFFF'];
const BGS   = ['#FFFFFF','#FFF5FA','#F5F0FF','#F0FFF8','#FFFFF0','#FFF0E8','#F0F8FF','#1a1a2e'];

// ══════════════════════════
//  SAFE INIT — every piece wrapped so one failure doesn't kill the rest
// ══════════════════════════
function safe(name, fn){
  try { fn(); } catch(e){ console.error('Init failed:', name, e); }
}

window.addEventListener('DOMContentLoaded', function(){
  safe('main-canvas', initMainCanvas);
  safe('color-row', buildColorRow);
  safe('bg-row', buildBgRow);
  safe('tint-row', buildTintRow);
  safe('brush-row', buildBrushRow);
  safe('stamp-ui', buildStampUI);
  safe('tpl-grid', buildTplGrid);
  safe('tpl-colors', buildTplColors);
  safe('resize', function(){
    window.addEventListener('resize', function(){
      // Keep main canvas crisp on rotate — redraw preserved image at new size
    });
  });
});

function initMainCanvas(){
  const mc = document.getElementById('main-canvas');
  const w = mc.parentElement.clientWidth || (window.innerWidth - 24);
  mc.width = w;
  mc.height = Math.round(w * 1.15);
  mainCtx = mc.getContext('2d');
  mainCtx.fillStyle = curBg;
  mainCtx.fillRect(0, 0, mc.width, mc.height);
  pushUndo();
  bindMain(mc);
}

function initDoodleCanvas(){
  const dc = document.getElementById('doodle-canvas');
  const w = dc.parentElement.clientWidth || (window.innerWidth - 24);
  const h = Math.round(w * 0.65);
  dc.width = w;
  dc.height = h;
  dc.style.height = h + 'px';
  ddCtx = dc.getContext('2d');
  ddCtx.fillStyle = '#FFFFFF';
  ddCtx.fillRect(0, 0, w, h);
  if(!dc._bound){ dc._bound = true; bindDoodle(dc); }
}

// ══════════════════════════
//  TABS
// ══════════════════════════
function switchTab(t){
  ['create','colour','draw'].forEach(function(id){
    document.getElementById(id+'-mode').classList.toggle('active', id === t);
    document.getElementById('tab-'+id).classList.toggle('active', id === t);
  });
  if(t !== 'create') cancelStamp();
  if(t === 'draw' && !doodleInited){
    doodleInited = true;
    setTimeout(function(){ safe('doodle-canvas-lazy', initDoodleCanvas); }, 60);
  }
}

// ══════════════════════════
//  TOOLS
// ══════════════════════════
const TOOL_ELS = { pen:'t-pen', pencil:'t-pencil', brush:'t-brush', marker:'t-marker', watercolor:'t-watercolor', crayon:'t-crayon', glitter:'t-glitter', fill:'t-fill', eraser:'t-eraser', text:'t-text' };

function setTool(t){
  curTool = t;
  cancelStamp();
  Object.values(TOOL_ELS).forEach(function(id){
    const el = document.getElementById(id);
    if(el) el.classList.remove('active');
  });
  const el = document.getElementById(TOOL_ELS[t]);
  if(el) el.classList.add('active');
}

function cancelStamp(){
  selStamp = null;
  const bar = document.getElementById('stamp-bar');
  const tr = document.getElementById('tint-row');
  if(bar) bar.classList.remove('show');
  if(tr) tr.classList.remove('show');
  document.querySelectorAll('.si').forEach(function(x){ x.classList.remove('sel'); });
}

function buildBrushRow(){
  const row = document.getElementById('brush-type-row');
  if(!row) return;
  const names = { pen:'✏️ Pen', pencil:'✎ Pencil', brush:'🖌️ Brush', marker:'🖊️ Marker', watercolor:'💧 Water', crayon:'🖍️ Crayon', glitter:'✨ Glitter' };
  row.innerHTML = '';
  Object.keys(names).forEach(function(k){
    const b = document.createElement('button');
    b.className = 'brush-chip' + (k === 'pen' ? ' active' : '');
    b.id = TOOL_ELS[k];
    b.textContent = names[k];
    b.addEventListener('click', function(){
      setTool(k);
      row.querySelectorAll('.brush-chip').forEach(function(x){ x.classList.remove('active'); });
      b.classList.add('active');
    });
    row.appendChild(b);
  });
}

// ══════════════════════════
//  COORDS
// ══════════════════════════
function getXY(canvas, e){
  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width;
  const sy = canvas.height / r.height;
  const src = e.touches && e.touches.length ? e.touches[0] : e;
  return [ (src.clientX - r.left) * sx, (src.clientY - r.top) * sy ];
}

// ══════════════════════════
//  MAIN CANVAS DRAWING
// ══════════════════════════
function bindMain(c){
  function onStart(e){
    e.preventDefault();
    if(!mainCtx) return;
    const p = getXY(c, e);
    const x = p[0], y = p[1];

    if(selStamp){ placeStamp(x, y); return; }

    if(curTool === 'fill'){
      floodFill(mainCtx, c.width, c.height, Math.round(x), Math.round(y), curColor);
      pushUndo();
      return;
    }
    if(curTool === 'text'){
      const t = prompt('Type your text:');
      if(!t) return;
      mainCtx.font = 'bold ' + Math.max(brushSz*6,14) + 'px Caveat,cursive';
      mainCtx.fillStyle = curColor;
      mainCtx.globalAlpha = curOpacity;
      mainCtx.fillText(t, x, y);
      mainCtx.globalAlpha = 1;
      pushUndo();
      return;
    }

    mainDrawing = true;
    lastPX = x; lastPY = y;
    applyBrushStyle(mainCtx);
    mainCtx.beginPath();
    mainCtx.moveTo(x, y);
    mainCtx.lineTo(x + 0.01, y);
    mainCtx.stroke();
    if(BRUSH_TYPES[curTool] && BRUSH_TYPES[curTool].sparkle) sparkleDot(mainCtx, x, y);
  }

  function onMove(e){
    e.preventDefault();
    if(!mainDrawing || !mainCtx) return;
    const p = getXY(c, e);
    const x = p[0], y = p[1];
    applyBrushStyle(mainCtx);
    // smoothing for brush/watercolor via midpoint quadratic
    const bt = BRUSH_TYPES[curTool];
    if(bt && bt.smooth){
      const mx = (lastPX + x) / 2, my = (lastPY + y) / 2;
      mainCtx.quadraticCurveTo(lastPX, lastPY, mx, my);
      mainCtx.stroke();
      mainCtx.beginPath();
      mainCtx.moveTo(mx, my);
    } else {
      mainCtx.lineTo(x, y);
      mainCtx.stroke();
      mainCtx.beginPath();
      mainCtx.moveTo(x, y);
    }
    if(bt && bt.sparkle && Math.random() < 0.3) sparkleDot(mainCtx, x, y);
    lastPX = x; lastPY = y;
  }

  function onEnd(){
    if(!mainDrawing) return;
    mainDrawing = false;
    pushUndo();
  }

  c.addEventListener('mousedown', onStart);
  c.addEventListener('touchstart', onStart, { passive:false });
  c.addEventListener('mousemove', onMove);
  c.addEventListener('touchmove', onMove, { passive:false });
  c.addEventListener('mouseup', onEnd);
  c.addEventListener('touchend', onEnd);
  c.addEventListener('touchcancel', onEnd);
  document.addEventListener('mouseup', onEnd);
}

function sparkleDot(ctx, x, y){
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = ['#FFD700','#FFF','#C9B8E8','#F7A0B5'][Math.floor(Math.random()*4)];
  const r = 1 + Math.random()*2;
  ctx.beginPath();
  ctx.arc(x + (Math.random()-0.5)*brushSz*2, y + (Math.random()-0.5)*brushSz*2, r, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();
}

function applyBrushStyle(ctx){
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
  if(curTool === 'eraser'){
    ctx.strokeStyle = curBg;
    ctx.lineWidth = brushSz * 4;
    ctx.globalAlpha = 1;
    return;
  }
  const bt = BRUSH_TYPES[curTool] || BRUSH_TYPES.pen;
  ctx.strokeStyle = curColor;
  ctx.lineWidth = brushSz * bt.widthMul;
  ctx.globalAlpha = bt.alphaMul * curOpacity;
}

// ══════════════════════════
//  FLOOD FILL
// ══════════════════════════
function hexToRgba(h){
  const v = h.replace('#','');
  return [ parseInt(v.slice(0,2),16), parseInt(v.slice(2,4),16), parseInt(v.slice(4,6),16), 255 ];
}
function colorsClose(a,b,tol){
  return Math.abs(a[0]-b[0])<tol && Math.abs(a[1]-b[1])<tol && Math.abs(a[2]-b[2])<tol && Math.abs(a[3]-b[3])<tol;
}
function floodFill(ctx, W, H, sx, sy, hex){
  if(sx<0||sx>=W||sy<0||sy>=H) return;
  const img = ctx.getImageData(0,0,W,H);
  const d = img.data;
  const i0 = (sy*W+sx)*4;
  const target = [d[i0],d[i0+1],d[i0+2],d[i0+3]];
  const fill = hexToRgba(hex);
  if(colorsClose(target, fill, 4)) return;
  const stack = [sx+sy*W];
  const visited = new Uint8Array(W*H);
  while(stack.length){
    const idx = stack.pop();
    const x = idx % W, y = (idx / W) | 0;
    if(x<0||x>=W||y<0||y>=H) continue;
    if(visited[idx]) continue;
    visited[idx] = 1;
    const pi = idx*4;
    if(!colorsClose([d[pi],d[pi+1],d[pi+2],d[pi+3]], target, 32)) continue;
    d[pi]=fill[0]; d[pi+1]=fill[1]; d[pi+2]=fill[2]; d[pi+3]=fill[3];
    stack.push(idx+1, idx-1, idx+W, idx-W);
  }
  ctx.putImageData(img,0,0);
}

// ══════════════════════════
//  UNDO / REDO — up to 50 steps
// ══════════════════════════
function pushUndo(){
  const c = document.getElementById('main-canvas');
  undoStack.push(c.toDataURL());
  if(undoStack.length > 50) undoStack.shift();
  redoStack = [];
}
function restoreMain(dataURL){
  const img = new Image();
  img.onload = function(){ mainCtx.clearRect(0,0,mainCtx.canvas.width,mainCtx.canvas.height); mainCtx.drawImage(img,0,0); };
  img.src = dataURL;
}
function undoMain(){
  if(undoStack.length < 2) return;
  redoStack.push(undoStack.pop());
  restoreMain(undoStack[undoStack.length-1]);
}
function redoMain(){
  if(!redoStack.length) return;
  const d = redoStack.pop();
  undoStack.push(d);
  restoreMain(d);
}
function clearMain(){
  if(!confirm('Clear canvas?')) return;
  mainCtx.fillStyle = curBg;
  mainCtx.fillRect(0,0,document.getElementById('main-canvas').width, document.getElementById('main-canvas').height);
  pushUndo();
}

function changeBg(newBg){
  curBg = newBg;
  const c = document.getElementById('main-canvas');
  const current = mainCtx.getImageData(0,0,c.width,c.height);
  mainCtx.fillStyle = newBg;
  mainCtx.fillRect(0,0,c.width,c.height);
  mainCtx.putImageData(current,0,0);
  pushUndo();
}

// ══════════════════════════
//  SWATCH BUILDERS
// ══════════════════════════
function makeSwatches(containerId, colors, getActive, onPick, showCustom){
  const row = document.getElementById(containerId);
  if(!row) return;
  row.innerHTML = '';
  colors.forEach(function(c){
    const s = document.createElement('div');
    s.className = 'sw' + (c === getActive() ? ' active' : '');
    s.style.background = c;
    if(c === '#FFFFFF') s.style.boxShadow = '0 0 0 1.5px #ddd inset';
    s.addEventListener('click', function(){
      onPick(c);
      row.querySelectorAll('.sw').forEach(function(x){ x.classList.remove('active'); });
      s.classList.add('active');
    });
    row.appendChild(s);
  });
  if(showCustom){
    const cc = document.createElement('input');
    cc.type = 'color';
    cc.className = 'cc';
    cc.value = getActive();
    cc.addEventListener('input', function(e){
      onPick(e.target.value);
      row.querySelectorAll('.sw').forEach(function(x){ x.classList.remove('active'); });
    });
    row.appendChild(cc);
  }
}
function buildColorRow(){ makeSwatches('draw-colors', COLORS, function(){return curColor;}, function(c){curColor=c;}, true); }
function buildTplColors(){ makeSwatches('tpl-colors', COLORS, function(){return tplColor;}, function(c){tplColor=c;}, true); }

function buildBgRow(){
  const row = document.getElementById('bg-swatches');
  if(!row) return;
  row.innerHTML = '';
  BGS.forEach(function(c, i){
    const s = document.createElement('div');
    s.className = 'bg-sw' + (i===0 ? ' active' : '');
    s.style.background = c;
    if(c === '#FFFFFF') s.style.boxShadow = '0 0 0 1.5px #ddd inset';
    s.addEventListener('click', function(){
      document.querySelectorAll('.bg-sw').forEach(function(x){ x.classList.remove('active'); });
      s.classList.add('active');
      changeBg(c);
    });
    row.appendChild(s);
  });
}

function buildTintRow(){
  const row = document.getElementById('tint-swatches');
  if(!row) return;
  row.innerHTML = '';
  TINTS.forEach(function(c, i){
    const s = document.createElement('div');
    s.className = 'tint-sw' + (i===0 ? ' active' : '');
    s.style.background = c;
    if(c === '#FFFFFF') s.style.boxShadow = '0 0 0 1.5px #ddd inset';
    s.addEventListener('click', function(){
      stampColor = c;
      row.querySelectorAll('.tint-sw').forEach(function(x){ x.classList.remove('active'); });
      s.classList.add('active');
      renderStampGrid();
    });
    row.appendChild(s);
  });
}

// ══════════════════════════
//  STAMPS
// ══════════════════════════
const ALL_CATS = ['All','Favorites','Misc Doodles','Arrows','Circles','Lines','Boxes','Colorful Art','Mine'];

function buildStampUI(){
  const cats = document.getElementById('stamp-cats');
  if(!cats) return;
  cats.innerHTML = '';
  ALL_CATS.forEach(function(cat){
    const b = document.createElement('button');
    b.className = 'cat-btn' + (cat === activeCat ? ' active' : '');
    b.textContent = cat;
    b.addEventListener('click', function(){
      activeCat = cat;
      cats.querySelectorAll('.cat-btn').forEach(function(x){ x.classList.remove('active'); });
      b.classList.add('active');
      renderStampGrid();
    });
    cats.appendChild(b);
  });

  const search = document.getElementById('stamp-search');
  if(search){
    search.addEventListener('input', function(){
      searchQuery = search.value.trim().toLowerCase();
      renderStampGrid();
    });
  }

  renderStampGrid();
}

function stampKey(stamp, idx, cat){ return cat + '_' + idx; }

function getAllStamps(){
  const all = [];
  if(typeof REAL_STAMPS !== 'undefined'){
    Object.keys(REAL_STAMPS).forEach(function(k){
      REAL_STAMPS[k].forEach(function(s, i){ all.push(Object.assign({}, s, { _cat:k, _key: k+'_'+i })); });
    });
  }
  if(typeof MEGA_STAMPS !== 'undefined'){
    MEGA_STAMPS.forEach(function(s, i){ all.push(Object.assign({}, s, { _cat:'Colorful Art', _colorful:true, _key:'Colorful Art_'+i })); });
  }
  return all;
}

function renderStampGrid(){
  const grid = document.getElementById('stamp-grid');
  if(!grid) return;
  grid.innerHTML = '';

  let stamps = [];
  if(activeCat === 'All'){
    stamps = getAllStamps();
  } else if(activeCat === 'Favorites'){
    const all = getAllStamps();
    stamps = all.filter(function(s){ return favStamps.indexOf(s._key) !== -1; });
  } else if(activeCat === 'Mine'){
    stamps = customStamps.map(function(s, i){ return Object.assign({}, s, { _custom:true, _key:'Mine_'+i }); });
  } else if(activeCat === 'Colorful Art'){
    stamps = (typeof MEGA_STAMPS !== 'undefined' ? MEGA_STAMPS : []).map(function(s, i){ return Object.assign({}, s, { _cat:'Colorful Art', _colorful:true, _key:'Colorful Art_'+i }); });
  } else {
    stamps = ((typeof REAL_STAMPS !== 'undefined' && REAL_STAMPS[activeCat]) || []).map(function(s, i){ return Object.assign({}, s, { _cat:activeCat, _key:activeCat+'_'+i }); });
  }

  if(searchQuery){
    stamps = stamps.filter(function(s){
      const n = (s.name || s.n || s._cat || '').toLowerCase();
      return n.indexOf(searchQuery) !== -1;
    });
  }

  if(stamps.length === 0){
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:16px;color:#B0A0C8;font-size:11px;">Nothing here yet.</div>';
    return;
  }

  // Lazy render: only build first 60 immediately, rest on scroll (perf)
  const LIMIT = 60;
  renderStampBatch(grid, stamps.slice(0, LIMIT));
  if(stamps.length > LIMIT){
    const more = document.createElement('div');
    more.style.cssText = 'grid-column:1/-1;text-align:center;padding:8px;font-size:11px;color:#9B85CC;cursor:pointer;font-weight:700;';
    more.textContent = 'Show ' + (stamps.length - LIMIT) + ' more ↓';
    more.addEventListener('click', function(){
      more.remove();
      renderStampBatch(grid, stamps.slice(LIMIT));
    });
    grid.appendChild(more);
  }
}

function renderStampBatch(grid, stamps){
  stamps.forEach(function(stamp){
    const item = document.createElement('div');
    item.className = 'si';

    if(stamp._custom){
      const img = document.createElement('img');
      img.src = stamp.dataURL;
      item.appendChild(img);
    } else if(stamp._colorful){
      const vb = stamp.v || '0 0 600 600';
      const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox', vb);
      svg.style.cssText = 'width:72%;height:72%;';
      svg.innerHTML = stamp.p;
      item.appendChild(svg);
    } else {
      const vb = stamp.v || '0 0 534 534';
      const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox', vb);
      svg.style.cssText = 'width:72%;height:72%;color:' + stampColor;
      svg.innerHTML = (typeof SHARED_FILTER !== 'undefined' ? SHARED_FILTER : '') + (stamp.p || '');
      item.appendChild(svg);
    }

    // Favorite star
    const favBtn = document.createElement('div');
    favBtn.className = 'fav-star' + (favStamps.indexOf(stamp._key) !== -1 ? ' active' : '');
    favBtn.textContent = '★';
    favBtn.addEventListener('click', function(e){
      e.stopPropagation();
      toggleFav(stamp._key);
      favBtn.classList.toggle('active');
    });
    item.appendChild(favBtn);

    item.addEventListener('click', function(){
      selStamp = stamp;
      curTool = 'stamp';
      Object.values(TOOL_ELS).forEach(function(id){
        const el = document.getElementById(id);
        if(el) el.classList.remove('active');
      });
      const bar = document.getElementById('stamp-bar');
      if(bar) bar.classList.add('show');
      const tr = document.getElementById('tint-row');
      if(tr) tr.classList.toggle('show', !(stamp._custom || stamp._colorful));
      document.querySelectorAll('.si').forEach(function(x){ x.classList.remove('sel'); });
      item.classList.add('sel');
      toast('✦ Tap the canvas to place your stamp!');
    });

    grid.appendChild(item);
  });
}

function toggleFav(key){
  const i = favStamps.indexOf(key);
  if(i === -1) favStamps.push(key); else favStamps.splice(i,1);
  localStorage.setItem('khushi_fav_stamps', JSON.stringify(favStamps));
}

// ══════════════════════════
//  PLACE STAMP
// ══════════════════════════
function placeStamp(x, y){
  if(!selStamp || !mainCtx) return;
  const size = Math.max(brushSz * 10, 70) * (window._stampScale || 1);

  if(selStamp._custom){
    const img = new Image();
    img.onload = function(){
      mainCtx.drawImage(img, x-size/2, y-size/2, size, size);
      pushUndo();
      toast('Stamp placed! ✦');
    };
    img.src = selStamp.dataURL;
    return;
  }

  const vb = selStamp.v || (selStamp._colorful ? '0 0 600 600' : '0 0 534 534');
  let svgContent;
  if(selStamp._colorful){
    svgContent = selStamp.p || '';
  } else {
    svgContent = (typeof SHARED_FILTER !== 'undefined' ? SHARED_FILTER : '') + (selStamp.p || '').split('currentColor').join(stampColor);
  }

  const svgStr = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '" width="' + size + '" height="' + size + '">' + svgContent + '</svg>';
  const blob = new Blob([svgStr], { type:'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = function(){
    mainCtx.globalAlpha = 1;
    mainCtx.drawImage(img, x-size/2, y-size/2, size, size);
    URL.revokeObjectURL(url);
    pushUndo();
    toast('Stamp placed! ✦');
  };
  img.onerror = function(){
    URL.revokeObjectURL(url);
    mainCtx.fillStyle = stampColor;
    mainCtx.beginPath();
    mainCtx.arc(x,y,10,0,Math.PI*2);
    mainCtx.fill();
    pushUndo();
  };
  img.src = url;
}

function setStampScale(v){ window._stampScale = v; }

// ══════════════════════════
//  TEMPLATE CANVAS
// ══════════════════════════
function bindTemplate(c){
  function onStart(e){
    e.preventDefault();
    if(!tplCtx) return;
    const p = getXY(c,e);
    tplDrawing = true;
    tplCtx.strokeStyle = tplColor;
    tplCtx.lineWidth = tplSz;
    tplCtx.lineCap = 'round';
    tplCtx.lineJoin = 'round';
    tplCtx.globalAlpha = 1;
    tplCtx.beginPath();
    tplCtx.moveTo(p[0], p[1]);
    tplCtx.lineTo(p[0]+0.01, p[1]);
    tplCtx.stroke();
  }
  function onMove(e){
    e.preventDefault();
    if(!tplDrawing || !tplCtx) return;
    const p = getXY(c,e);
    tplCtx.strokeStyle = tplColor;
    tplCtx.lineWidth = tplSz;
    tplCtx.lineTo(p[0], p[1]);
    tplCtx.stroke();
    tplCtx.beginPath();
    tplCtx.moveTo(p[0], p[1]);
  }
  function onEnd(){
    if(!tplDrawing) return;
    tplDrawing = false;
    saveTplUndo();
  }
  c.addEventListener('mousedown', onStart);
  c.addEventListener('touchstart', onStart, { passive:false });
  c.addEventListener('mousemove', onMove);
  c.addEventListener('touchmove', onMove, { passive:false });
  c.addEventListener('mouseup', onEnd);
  c.addEventListener('touchend', onEnd);
  document.addEventListener('mouseup', onEnd);
}

function saveTplUndo(){
  const c = document.getElementById('tpl-canvas');
  tplUndo.push(c.toDataURL());
  if(tplUndo.length > 30) tplUndo.shift();
  tplRedo = [];
}
function undoTpl(){
  if(tplUndo.length < 2) return;
  tplRedo.push(tplUndo.pop());
  const img = new Image();
  img.onload = function(){ tplCtx.clearRect(0,0,tplCtx.canvas.width,tplCtx.canvas.height); tplCtx.drawImage(img,0,0); };
  img.src = tplUndo[tplUndo.length-1];
}

// ══════════════════════════
//  DOODLE CANVAS
// ══════════════════════════
function bindDoodle(c){
  function onStart(e){
    e.preventDefault();
    if(!ddCtx) return;
    const p = getXY(c,e);
    ddDrawing = true;
    applyDdStyle();
    ddCtx.beginPath();
    ddCtx.moveTo(p[0], p[1]);
    ddCtx.lineTo(p[0]+0.01, p[1]);
    ddCtx.stroke();
  }
  function onMove(e){
    e.preventDefault();
    if(!ddDrawing || !ddCtx) return;
    const p = getXY(c,e);
    applyDdStyle();
    ddCtx.lineTo(p[0], p[1]);
    ddCtx.stroke();
    ddCtx.beginPath();
    ddCtx.moveTo(p[0], p[1]);
  }
  function onEnd(){ ddDrawing = false; }
  c.addEventListener('mousedown', onStart);
  c.addEventListener('touchstart', onStart, { passive:false });
  c.addEventListener('mousemove', onMove);
  c.addEventListener('touchmove', onMove, { passive:false });
  c.addEventListener('mouseup', onEnd);
  c.addEventListener('touchend', onEnd);
  document.addEventListener('mouseup', onEnd);
}

function applyDdStyle(){
  ddCtx.lineCap = 'round';
  ddCtx.lineJoin = 'round';
  if(ddTool === 'eraser'){
    ddCtx.strokeStyle = '#FFFFFF';
    ddCtx.lineWidth = ddSz * 5;
    ddCtx.globalAlpha = 1;
  } else {
    ddCtx.strokeStyle = ddColor;
    ddCtx.lineWidth = ddSz;
    ddCtx.globalAlpha = 1;
  }
}

function setDoodleTool(t){
  ddTool = t;
  document.getElementById('dd-pen').classList.toggle('active', t==='pen');
  document.getElementById('dd-eraser').classList.toggle('active', t==='eraser');
}

function clearDoodle(){
  const c = document.getElementById('doodle-canvas');
  ddCtx.fillStyle = '#FFFFFF';
  ddCtx.fillRect(0,0,c.width,c.height);
}

// Auto-crop transparent/white margins, export as transparent PNG stamp
function saveDoodleAsStamp(){
  const c = document.getElementById('doodle-canvas');
  const cropped = autoCropWhite(c);
  customStamps.push({ dataURL: cropped, name: 'My Doodle ' + (customStamps.length+1) });
  localStorage.setItem('khushi_custom_stamps', JSON.stringify(customStamps));
  activeCat = 'Mine';
  document.querySelectorAll('.cat-btn').forEach(function(b){ b.classList.toggle('active', b.textContent === 'Mine'); });
  renderStampGrid();
  switchTab('create');
  toast('✨ Saved as stamp! Find it in Stamps → Mine');
}

function autoCropWhite(canvas){
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const data = ctx.getImageData(0,0,w,h).data;
  let minX=w, minY=h, maxX=0, maxY=0, found=false;
  for(let y=0; y<h; y+=2){
    for(let x=0; x<w; x+=2){
      const i = (y*w+x)*4;
      const r=data[i], g=data[i+1], b=data[i+2];
      if(!(r>245 && g>245 && b>245)){
        found = true;
        if(x<minX) minX=x; if(x>maxX) maxX=x;
        if(y<minY) minY=y; if(y>maxY) maxY=y;
      }
    }
  }
  if(!found) return canvas.toDataURL();
  const pad = 10;
  minX = Math.max(0, minX-pad); minY = Math.max(0, minY-pad);
  maxX = Math.min(w, maxX+pad); maxY = Math.min(h, maxY+pad);
  const cw = maxX-minX, ch = maxY-minY;
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  const octx = out.getContext('2d');
  octx.drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
  // make white transparent
  const img = octx.getImageData(0,0,cw,ch);
  const d = img.data;
  for(let i=0;i<d.length;i+=4){
    if(d[i]>245 && d[i+1]>245 && d[i+2]>245) d[i+3]=0;
  }
  octx.putImageData(img,0,0);
  return out.toDataURL();
}

// ══════════════════════════
//  TEMPLATES (data comes from templates.js as plain JSON — no backticks, no risk)
// ══════════════════════════
function buildTplGrid(){
  const grid = document.getElementById('tpl-grid');
  if(!grid || typeof TEMPLATES === 'undefined') return;
  TEMPLATES.forEach(function(t, i){
    const card = document.createElement('div');
    card.className = 'tc';
    card.innerHTML = t.svg + '<div class="tc-label">' + t.name + '</div>';
    card.addEventListener('click', function(){ openTemplate(i); });
    grid.appendChild(card);
  });
}

function openTemplate(idx){
  curTplIdx = idx;
  document.getElementById('vt').textContent = TEMPLATES[idx].name;
  document.getElementById('tpl-list').style.display = 'none';
  document.getElementById('tpl-viewer').style.display = 'block';

  const c = document.getElementById('tpl-canvas');
  const w = c.parentElement.clientWidth || (window.innerWidth-24);
  c.width = w; c.height = w;
  tplCtx = c.getContext('2d');
  tplCtx.fillStyle = TEMPLATES[idx].bg || '#FFFFFF';
  tplCtx.fillRect(0,0,w,w);

  const inner = TEMPLATES[idx].svg.replace(/<svg[^>]*>/, '').replace('</svg>', '');
  const svgStr = '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+w+'" viewBox="0 0 300 300">'+inner+'</svg>';
  const blob = new Blob([svgStr], { type:'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = function(){
    tplCtx.drawImage(img,0,0,w,w);
    URL.revokeObjectURL(url);
    tplUndo = [c.toDataURL()];
    tplRedo = [];
  };
  img.src = url;
  activeDL = 'tpl';
  if(!c._bound){ c._bound = true; bindTemplate(c); }
}

function backToList(){
  document.getElementById('tpl-list').style.display = 'block';
  document.getElementById('tpl-viewer').style.display = 'none';
  activeDL = 'main';
}
function resetTpl(){ if(curTplIdx >= 0) openTemplate(curTplIdx); }

// ══════════════════════════
//  DOWNLOAD (with transparent option)
// ══════════════════════════
function openDL(mode){
  activeDL = mode;
  document.getElementById('note-text').value = '';
  document.getElementById('dl-modal').classList.add('show');
}
function closeDL(){ document.getElementById('dl-modal').classList.remove('show'); }

function doDownload(){
  const note = document.getElementById('note-text').value.trim();
  const transparent = document.getElementById('dl-transparent') && document.getElementById('dl-transparent').checked;
  const src = activeDL === 'tpl' ? document.getElementById('tpl-canvas') : document.getElementById('main-canvas');

  if(transparent){
    // Just export the raw drawing, no sticky frame
    const a = document.createElement('a');
    a.download = 'khushi-doodle-' + Date.now() + '.png';
    a.href = src.toDataURL('image/png');
    a.click();
    closeDL();
    toast('Saved! 💜');
    return;
  }

  const pad = 18, noteH = note ? 50 : 28;
  const outW = src.width + pad*2, outH = src.height + pad*2 + noteH;
  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const ctx = out.getContext('2d');

  ctx.shadowColor = 'rgba(100,60,160,0.2)';
  ctx.shadowBlur = 18; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 5;

  const g = ctx.createLinearGradient(0,0,outW,outH);
  g.addColorStop(0,'#EDE0FF'); g.addColorStop(1,'#F7E8FF');
  ctx.fillStyle = g;
  roundRect(ctx,7,7,outW-14,outH-14,16);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.fillStyle = 'rgba(170,140,220,0.28)';
  ctx.beginPath();
  ctx.moveTo(outW-7,7); ctx.lineTo(outW-34,7); ctx.lineTo(outW-7,34); ctx.closePath(); ctx.fill();

  ctx.drawImage(src, pad, pad, src.width, src.height);

  if(note){
    ctx.fillStyle = 'rgba(90,70,130,0.9)';
    ctx.font = 'bold 20px Caveat,cursive';
    ctx.textAlign = 'center';
    ctx.fillText(note, outW/2, outH-16);
  }
  ctx.fillStyle = 'rgba(150,120,190,0.4)';
  ctx.font = '10px Quicksand,sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText("Khushi's Studio ✨", outW-10, outH-4);

  const a = document.createElement('a');
  a.download = 'khushi-doodle-' + Date.now() + '.png';
  a.href = out.toDataURL('image/png');
  a.click();
  closeDL();
  toast('Saved to your gallery! 💜');
}

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

// ══════════════════════════
//  KHUSHI BUTTON
// ══════════════════════════
function triggerKhushi(){
  const rain = document.getElementById('heart-rain');
  rain.style.display = 'block';
  rain.innerHTML = '';
  const em = ['💜','💕','🌸','💖','✨','🩷','💗','🌷','💝','⭐','🌺'];
  for(let i=0;i<40;i++){
    const h = document.createElement('div');
    h.className = 'hd';
    h.textContent = em[Math.floor(Math.random()*em.length)];
    h.style.cssText = 'left:'+(Math.random()*100)+'%;font-size:'+(16+Math.random()*18)+'px;animation-delay:'+(Math.random()*2)+'s;animation-duration:'+(2.5+Math.random()*1.5)+'s;';
    rain.appendChild(h);
  }
  setTimeout(function(){
    document.getElementById('love-modal').classList.add('show');
    rain.style.display = 'none';
  }, 1800);
}
function closeLove(){ document.getElementById('love-modal').classList.remove('show'); }

// ══════════════════════════
//  TOAST
// ══════════════════════════
function toast(msg){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(function(){ t.classList.remove('show'); }, 2400);
}
