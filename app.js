'use strict';

// ══════════════════════════
//  GLOBAL ERROR CATCHER
// ══════════════════════════
window.addEventListener('error', function(e){
  console.error('APP ERROR:', e.message, 'at', e.filename+':'+e.lineno);
  var bar = document.getElementById('err-bar');
  if(bar){
    bar.textContent = '⚠️ Something broke: ' + e.message + ' (line ' + e.lineno + ')';
    bar.style.display = 'block';
  }
});
function safe(name, fn){ try { fn(); } catch(e){ console.error('Failed:', name, e); } }

// ══════════════════════════
//  STATE
// ══════════════════════════
let fCanvas = null;          // Fabric.js canvas — Create tab
let curTool = 'select';
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
let refImg = null;

let historyStack = [];
let historyIndex = -1;
let suppressHistory = false;

// Colour-it (plain canvas, unchanged approach)
let tplColor = '#C9B8E8';
let tplSz = 10;
let tplDrawing = false;
let tplCtx = null;
let curTplIdx = -1;
let tplUndo = [];
let tplRedo = [];
let activeDL = 'main';

// Draw-your-own-doodle (plain canvas)
let ddTool = 'pen';
let ddColor = '#000000';
let ddSz = 4;
let ddDrawing = false;
let ddCtx = null;
let doodleInited = false;

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
const SPARKLE_COLORS = ['#FFD700','#FFF','#F7A0B5','#C9B8E8','#80C8FF','#FF6B9D'];
const STAR_PATH = 'M12 0 L15 8 L24 9 L17 15 L19 24 L12 19 L5 24 L7 15 L0 9 L9 8 Z';

// ══════════════════════════
//  INIT
// ══════════════════════════
window.addEventListener('DOMContentLoaded', function(){
  safe('main-canvas', initMainCanvas);
  safe('color-row', buildColorRow);
  safe('bg-row', buildBgRow);
  safe('tint-row', buildTintRow);
  safe('brush-row', buildBrushRow);
  safe('stamp-ui', buildStampUI);
  safe('tpl-grid', buildTplGrid);
  safe('tpl-colors', buildTplColors);
  safe('ref-input', bindRefInput);
});

function initMainCanvas(){
  if(typeof fabric === 'undefined'){
    var bar = document.getElementById('err-bar');
    if(bar){ bar.textContent = '⚠️ Drawing engine failed to load — check your internet connection and refresh.'; bar.style.display='block'; }
    return;
  }
  const wrap = document.getElementById('main-wrap');
  const w = wrap.clientWidth || (window.innerWidth - 24);
  const h = Math.round(w * 1.15);
  const el = document.getElementById('main-canvas');
  el.width = w; el.height = h;

  fCanvas = new fabric.Canvas('main-canvas', {
    backgroundColor: curBg,
    selection: true,
    preserveObjectStacking: true
  });
  fCanvas.setWidth(w);
  fCanvas.setHeight(h);

  fCanvas.on('mouse:down', onFabricCanvasDown);
  fCanvas.on('object:added', function(){ if(!suppressHistory) pushHistory(); });
  fCanvas.on('object:modified', function(){ if(!suppressHistory) pushHistory(); });
  fCanvas.on('object:removed', function(){ if(!suppressHistory) pushHistory(); });
  fCanvas.on('selection:created', updateSelBar);
  fCanvas.on('selection:updated', updateSelBar);
  fCanvas.on('selection:cleared', updateSelBar);

  pushHistory();
  setTool('select');
}

function updateSelBar(){
  const bar = document.getElementById('sel-bar');
  if(!bar) return;
  bar.style.display = (fCanvas && fCanvas.getActiveObject()) ? 'flex' : 'none';
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
const DRAW_TOOLS = ['pen','pencil','brush','marker','watercolor','crayon','neon','glitter'];
const TOOL_ELS = { select:'t-select', pen:'t-pen', pencil:'t-pencil', brush:'t-brush', marker:'t-marker',
  watercolor:'t-watercolor', crayon:'t-crayon', neon:'t-neon', glitter:'t-glitter',
  eraser:'t-eraser', text:'t-text', sparkletext:'t-sparkletext', sparkleburst:'t-sparkleburst' };

function setTool(t){
  curTool = t;
  cancelStamp();
  Object.values(TOOL_ELS).forEach(function(id){
    const el = document.getElementById(id);
    if(el) el.classList.remove('active');
  });
  const el = document.getElementById(TOOL_ELS[t]);
  if(el) el.classList.add('active');

  if(!fCanvas) return;

  if(DRAW_TOOLS.indexOf(t) !== -1){
    fCanvas.isDrawingMode = true;
    fCanvas.freeDrawingBrush = buildBrush(t);
  } else {
    fCanvas.isDrawingMode = false;
    fCanvas.selection = (t === 'select');
  }
}

function buildBrush(t){
  let b;
  if(t === 'glitter'){
    b = new fabric.SprayBrush(fCanvas);
    b.width = Math.max(brushSz*3, 18);
    b.density = 22;
    b.dotWidth = 3;
    b.dotWidthVariance = 2;
    b.randomOpacity = true;
    b.color = curColor;
    return b;
  }
  b = new fabric.PencilBrush(fCanvas);
  b.color = curColor;
  const mults = { pen:1, pencil:0.6, brush:2, marker:2.5, watercolor:3, crayon:1.8, neon:1.6 };
  b.width = brushSz * (mults[t] || 1);
  if(t === 'neon'){
    b.shadow = new fabric.Shadow({ color: curColor, blur: 16, offsetX:0, offsetY:0 });
  }
  return b;
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
  const names = {
    select:'↖ Select', pen:'✏️ Pen', pencil:'✎ Pencil', brush:'🖌️ Brush', marker:'🖊️ Marker',
    watercolor:'💧 Water', crayon:'🖍️ Crayon', neon:'💡 Neon', glitter:'✨ Glitter',
    eraser:'🧹 Tap-Erase', text:'T Text', sparkletext:'✨T Sparkle', sparkleburst:'🌟 Burst'
  };
  row.innerHTML = '';
  Object.keys(names).forEach(function(k){
    const b = document.createElement('button');
    b.className = 'brush-chip' + (k === 'select' ? ' active' : '');
    b.id = TOOL_ELS[k];
    b.textContent = names[k];
    b.addEventListener('click', function(){ setTool(k); });
    row.appendChild(b);
  });
}

// ══════════════════════════
//  CANVAS TAP HANDLER (stamps, text, sparkle burst, eraser)
// ══════════════════════════
function onFabricCanvasDown(opt){
  if(!fCanvas) return;
  const p = fCanvas.getPointer(opt.e);

  if(selStamp){ placeStampFabric(p.x, p.y); return; }

  if(curTool === 'text'){ addTextObject(p.x, p.y, false); return; }
  if(curTool === 'sparkletext'){ addTextObject(p.x, p.y, true); return; }
  if(curTool === 'sparkleburst'){ placeSparkleBurst(p.x, p.y); return; }

  if(curTool === 'eraser'){
    if(opt.target){ fCanvas.remove(opt.target); }
    return;
  }
}

function addTextObject(x, y, sparkly){
  const t = prompt('Type your text:');
  if(!t) return;
  let textObj;
  if(sparkly){
    textObj = new fabric.Text(t, {
      left:x, top:y, originX:'center', originY:'center',
      fontFamily:'Caveat, cursive', fontSize: Math.max(brushSz*8, 32), fontWeight:'700',
      fill: '#FFD700',
      stroke: '#F7A0B5', strokeWidth: 0.6,
      shadow: new fabric.Shadow({ color:'#FFD700', blur:12, offsetX:0, offsetY:0 })
    });
  } else {
    textObj = new fabric.IText(t, {
      left:x, top:y, originX:'center', originY:'center',
      fontFamily:'Caveat, cursive', fontSize: Math.max(brushSz*7, 26), fontWeight:'700',
      fill: curColor, opacity: curOpacity
    });
  }
  fCanvas.add(textObj);
  fCanvas.setActiveObject(textObj);
  setTool('select');
  toast('Drag, resize, or rotate your text! ✦');
}

function placeSparkleBurst(x, y){
  const n = 10 + Math.floor(Math.random()*6);
  for(let i=0;i<n;i++){
    const ang = Math.random()*Math.PI*2;
    const dist = 10 + Math.random()*60;
    const sx = x + Math.cos(ang)*dist;
    const sy = y + Math.sin(ang)*dist;
    const scale = 0.25 + Math.random()*0.55;
    const color = SPARKLE_COLORS[Math.floor(Math.random()*SPARKLE_COLORS.length)];
    const star = new fabric.Path(STAR_PATH, {
      left: sx, top: sy, originX:'center', originY:'center',
      fill: color, scaleX:scale, scaleY:scale,
      angle: Math.random()*360,
      shadow: new fabric.Shadow({ color: color, blur: 6, offsetX:0, offsetY:0 })
    });
    fCanvas.add(star);
  }
  toast('✨ Sparkle burst placed!');
}

function confettiBurst(){
  if(!fCanvas) return;
  const w = fCanvas.getWidth(), h = fCanvas.getHeight();
  const shapes = 26;
  for(let i=0;i<shapes;i++){
    const color = SPARKLE_COLORS[Math.floor(Math.random()*SPARKLE_COLORS.length)];
    const x = Math.random()*w, y = Math.random()*h;
    let obj;
    if(Math.random() > 0.5){
      obj = new fabric.Rect({ left:x, top:y, width:10, height:16, fill:color, originX:'center', originY:'center', angle:Math.random()*360, rx:2, ry:2 });
    } else {
      obj = new fabric.Circle({ left:x, top:y, radius:5, fill:color, originX:'center', originY:'center' });
    }
    fCanvas.add(obj);
  }
  toast('🎉 Confetti!');
}

// ══════════════════════════
//  STAMP PLACEMENT (Fabric objects — movable!)
// ══════════════════════════
function placeStampFabric(x, y){
  if(!selStamp || !fCanvas) return;
  const scale = window._stampScale || 1;
  const targetSize = Math.max(brushSz*10, 70) * scale;

  if(selStamp._custom){
    fabric.Image.fromURL(selStamp.dataURL, function(img){
      const s = targetSize / Math.max(img.width, img.height);
      img.set({ left:x, top:y, originX:'center', originY:'center', scaleX:s, scaleY:s });
      fCanvas.add(img);
      fCanvas.setActiveObject(img);
      finishStampPlace();
    });
    return;
  }

  const vb = selStamp.v || (selStamp._colorful ? '0 0 600 600' : '0 0 534 534');
  let svgContent;
  if(selStamp._colorful){
    svgContent = selStamp.p || '';
  } else {
    svgContent = (typeof SHARED_FILTER !== 'undefined' ? SHARED_FILTER : '') + (selStamp.p || '').split('currentColor').join(stampColor);
  }
  const svgStr = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '">' + svgContent + '</svg>';

  fabric.loadSVGFromString(svgStr, function(objects, options){
    const grouped = fabric.util.groupSVGElements(objects, options);
    const s = targetSize / Math.max(grouped.width || 100, grouped.height || 100);
    grouped.set({ left:x, top:y, originX:'center', originY:'center', scaleX:s, scaleY:s });
    fCanvas.add(grouped);
    fCanvas.setActiveObject(grouped);
    finishStampPlace();
  });
}

function finishStampPlace(){
  setTool('select');
  toast('Stamp placed! Drag, pinch, or rotate it ✦');
}

function setStampScale(v){ window._stampScale = v; }

// ══════════════════════════
//  SELECTED OBJECT ACTIONS
// ══════════════════════════
function dupSelected(){
  if(!fCanvas) return;
  const obj = fCanvas.getActiveObject();
  if(!obj){ toast('Select something first'); return; }
  obj.clone(function(cloned){
    cloned.set({ left: obj.left+18, top: obj.top+18 });
    fCanvas.add(cloned);
    fCanvas.setActiveObject(cloned);
  });
}
function deleteSelected(){
  if(!fCanvas) return;
  const obj = fCanvas.getActiveObject();
  if(!obj){ toast('Select something first'); return; }
  if(obj.type === 'activeSelection'){
    obj.forEachObject(function(o){ fCanvas.remove(o); });
    fCanvas.discardActiveObject();
  } else {
    fCanvas.remove(obj);
  }
}
function bringFront(){
  const obj = fCanvas && fCanvas.getActiveObject();
  if(!obj){ toast('Select something first'); return; }
  fCanvas.bringToFront(obj);
}
function sendBack(){
  const obj = fCanvas && fCanvas.getActiveObject();
  if(!obj){ toast('Select something first'); return; }
  fCanvas.sendToBack(obj);
}

// ══════════════════════════
//  UNDO / REDO — via Fabric JSON snapshots
// ══════════════════════════
function pushHistory(){
  if(!fCanvas) return;
  historyStack = historyStack.slice(0, historyIndex+1);
  historyStack.push(JSON.stringify(fCanvas.toJSON()));
  if(historyStack.length > 40) historyStack.shift();
  historyIndex = historyStack.length - 1;
}
function loadHistory(i){
  if(!fCanvas || i < 0 || i >= historyStack.length) return;
  suppressHistory = true;
  fCanvas.loadFromJSON(historyStack[i], function(){
    fCanvas.renderAll();
    suppressHistory = false;
  });
}
function undoMain(){
  if(historyIndex <= 0) return;
  historyIndex--;
  loadHistory(historyIndex);
}
function redoMain(){
  if(historyIndex >= historyStack.length - 1) return;
  historyIndex++;
  loadHistory(historyIndex);
}
function clearMain(){
  if(!fCanvas) return;
  if(!confirm('Clear everything from the canvas?')) return;
  fCanvas.clear();
  fCanvas.backgroundColor = curBg;
  fCanvas.renderAll();
  refImg = null;
  pushHistory();
}

function changeBg(newBg){
  curBg = newBg;
  if(!fCanvas) return;
  fCanvas.backgroundColor = newBg;
  fCanvas.renderAll();
  pushHistory();
}

// ══════════════════════════
//  REFERENCE IMAGE TRACING
// ══════════════════════════
function bindRefInput(){
  const inp = document.getElementById('ref-file-input');
  if(!inp) return;
  inp.addEventListener('change', function(e){
    const file = e.target.files && e.target.files[0];
    if(file) addReferenceImage(file);
    inp.value = '';
  });
}
function openRefPicker(){
  const inp = document.getElementById('ref-file-input');
  if(inp) inp.click();
}
function addReferenceImage(file){
  const reader = new FileReader();
  reader.onload = function(e){
    fabric.Image.fromURL(e.target.result, function(img){
      const cw = fCanvas.getWidth(), ch = fCanvas.getHeight();
      const s = Math.min(cw/img.width, ch/img.height) * 0.9;
      img.set({ left:cw/2, top:ch/2, originX:'center', originY:'center', scaleX:s, scaleY:s, opacity:0.35 });
      fCanvas.add(img);
      fCanvas.sendToBack(img);
      refImg = img;
      fCanvas.setActiveObject(img);
      const ctrl = document.getElementById('ref-controls');
      if(ctrl) ctrl.style.display = 'flex';
      toast('📷 Reference added — drag & resize it, then lock when ready to trace over it');
    });
  };
  reader.readAsDataURL(file);
}
function toggleRefLock(){
  if(!refImg){ toast('Add a reference image first'); return; }
  const unlocked = refImg.selectable !== false;
  refImg.set({ selectable: !unlocked, evented: !unlocked });
  fCanvas.discardActiveObject();
  fCanvas.renderAll();
  const btn = document.getElementById('ref-lock-btn');
  if(btn) btn.textContent = unlocked ? '🔓 Unlock Ref' : '🔒 Lock Ref';
  toast(unlocked ? '🔒 Reference locked — trace away!' : '🔓 Reference unlocked — move it freely');
}
function setRefOpacity(v){
  if(refImg){ refImg.set({ opacity:v }); fCanvas.renderAll(); }
}
function removeReference(){
  if(!refImg) return;
  fCanvas.remove(refImg);
  refImg = null;
  const ctrl = document.getElementById('ref-controls');
  if(ctrl) ctrl.style.display = 'none';
}

// ══════════════════════════
//  COLOR SWATCH BUILDERS
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
      if(fCanvas && fCanvas.isDrawingMode) fCanvas.freeDrawingBrush = buildBrush(curTool);
    });
    row.appendChild(s);
  });
  if(showCustom){
    const cc = document.createElement('input');
    cc.type = 'color'; cc.className = 'cc'; cc.value = getActive();
    cc.addEventListener('input', function(e){
      onPick(e.target.value);
      row.querySelectorAll('.sw').forEach(function(x){ x.classList.remove('active'); });
      if(fCanvas && fCanvas.isDrawingMode) fCanvas.freeDrawingBrush = buildBrush(curTool);
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
//  STAMPS LIBRARY
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

function getAllStamps(){
  const all = [];
  if(typeof REAL_STAMPS !== 'undefined'){
    Object.keys(REAL_STAMPS).forEach(function(k){
      REAL_STAMPS[k].forEach(function(s,i){ all.push(Object.assign({}, s, { _cat:k, _key:k+'_'+i })); });
    });
  }
  if(typeof MEGA_STAMPS !== 'undefined'){
    MEGA_STAMPS.forEach(function(s,i){ all.push(Object.assign({}, s, { _cat:'Colorful Art', _colorful:true, _key:'Colorful Art_'+i })); });
  }
  return all;
}

function renderStampGrid(){
  const grid = document.getElementById('stamp-grid');
  if(!grid) return;
  grid.innerHTML = '';

  let stamps = [];
  if(activeCat === 'All') stamps = getAllStamps();
  else if(activeCat === 'Favorites'){
    const all = getAllStamps();
    stamps = all.filter(function(s){ return favStamps.indexOf(s._key) !== -1; });
  }
  else if(activeCat === 'Mine') stamps = customStamps.map(function(s,i){ return Object.assign({}, s, { _custom:true, _key:'Mine_'+i }); });
  else if(activeCat === 'Colorful Art') stamps = (typeof MEGA_STAMPS !== 'undefined' ? MEGA_STAMPS : []).map(function(s,i){ return Object.assign({}, s, { _cat:'Colorful Art', _colorful:true, _key:'Colorful Art_'+i }); });
  else stamps = ((typeof REAL_STAMPS !== 'undefined' && REAL_STAMPS[activeCat]) || []).map(function(s,i){ return Object.assign({}, s, { _cat:activeCat, _key:activeCat+'_'+i }); });

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

  const LIMIT = 60;
  renderStampBatch(grid, stamps.slice(0, LIMIT));
  if(stamps.length > LIMIT){
    const more = document.createElement('div');
    more.style.cssText = 'grid-column:1/-1;text-align:center;padding:8px;font-size:11px;color:#9B85CC;cursor:pointer;font-weight:700;';
    more.textContent = 'Show ' + (stamps.length - LIMIT) + ' more ↓';
    more.addEventListener('click', function(){ more.remove(); renderStampBatch(grid, stamps.slice(LIMIT)); });
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
      Object.values(TOOL_ELS).forEach(function(id){ const el=document.getElementById(id); if(el) el.classList.remove('active'); });
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
//  DRAW YOUR OWN DOODLE (plain canvas — kept simple on purpose)
// ══════════════════════════
function initDoodleCanvas(){
  const dc = document.getElementById('doodle-canvas');
  const w = dc.parentElement.clientWidth || (window.innerWidth - 24);
  const h = Math.round(w * 0.65);
  dc.width = w; dc.height = h; dc.style.height = h + 'px';
  ddCtx = dc.getContext('2d');
  ddCtx.fillStyle = '#FFFFFF';
  ddCtx.fillRect(0,0,w,h);
  if(!dc._bound){ dc._bound = true; bindDoodle(dc); }
}
function getXY(canvas, e){
  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width, sy = canvas.height / r.height;
  const src = e.touches && e.touches.length ? e.touches[0] : e;
  return [ (src.clientX-r.left)*sx, (src.clientY-r.top)*sy ];
}
function bindDoodle(c){
  function onStart(e){
    e.preventDefault();
    if(!ddCtx) return;
    const p = getXY(c,e);
    ddDrawing = true;
    applyDdStyle();
    ddCtx.beginPath(); ddCtx.moveTo(p[0],p[1]); ddCtx.lineTo(p[0]+0.01,p[1]); ddCtx.stroke();
  }
  function onMove(e){
    e.preventDefault();
    if(!ddDrawing || !ddCtx) return;
    const p = getXY(c,e);
    applyDdStyle();
    ddCtx.lineTo(p[0],p[1]); ddCtx.stroke();
    ddCtx.beginPath(); ddCtx.moveTo(p[0],p[1]);
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
  ddCtx.lineCap='round'; ddCtx.lineJoin='round';
  if(ddTool === 'eraser'){ ddCtx.strokeStyle='#FFFFFF'; ddCtx.lineWidth=ddSz*5; ddCtx.globalAlpha=1; }
  else { ddCtx.strokeStyle=ddColor; ddCtx.lineWidth=ddSz; ddCtx.globalAlpha=1; }
}
function setDoodleTool(t){
  ddTool = t;
  document.getElementById('dd-pen').classList.toggle('active', t==='pen');
  document.getElementById('dd-eraser').classList.toggle('active', t==='eraser');
}
function clearDoodle(){
  const c = document.getElementById('doodle-canvas');
  ddCtx.fillStyle='#FFFFFF'; ddCtx.fillRect(0,0,c.width,c.height);
}
function saveDoodleAsStamp(){
  const c = document.getElementById('doodle-canvas');
  const cropped = autoCropWhite(c);
  customStamps.push({ dataURL: cropped, name: 'My Doodle ' + (customStamps.length+1) });
  localStorage.setItem('khushi_custom_stamps', JSON.stringify(customStamps));
  activeCat = 'Mine';
  document.querySelectorAll('.cat-btn').forEach(function(b){ b.classList.toggle('active', b.textContent==='Mine'); });
  renderStampGrid();
  switchTab('create');
  toast('✨ Saved as stamp! Find it in Stamps → Mine');
}
function autoCropWhite(canvas){
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const data = ctx.getImageData(0,0,w,h).data;
  let minX=w,minY=h,maxX=0,maxY=0,found=false;
  for(let y=0;y<h;y+=2){
    for(let x=0;x<w;x+=2){
      const i=(y*w+x)*4;
      if(!(data[i]>245 && data[i+1]>245 && data[i+2]>245)){
        found=true;
        if(x<minX) minX=x; if(x>maxX) maxX=x;
        if(y<minY) minY=y; if(y>maxY) maxY=y;
      }
    }
  }
  if(!found) return canvas.toDataURL();
  const pad=10;
  minX=Math.max(0,minX-pad); minY=Math.max(0,minY-pad);
  maxX=Math.min(w,maxX+pad); maxY=Math.min(h,maxY+pad);
  const cw=maxX-minX, ch=maxY-minY;
  const out=document.createElement('canvas'); out.width=cw; out.height=ch;
  const octx=out.getContext('2d');
  octx.drawImage(canvas,minX,minY,cw,ch,0,0,cw,ch);
  const img=octx.getImageData(0,0,cw,ch), d=img.data;
  for(let i=0;i<d.length;i+=4){ if(d[i]>245&&d[i+1]>245&&d[i+2]>245) d[i+3]=0; }
  octx.putImageData(img,0,0);
  return out.toDataURL();
}

// ══════════════════════════
//  COLOUR-IT TEMPLATES (plain canvas, unchanged)
// ══════════════════════════
function buildTplGrid(){
  const grid = document.getElementById('tpl-grid');
  if(!grid || typeof TEMPLATES === 'undefined') return;
  TEMPLATES.forEach(function(t,i){
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
  c.width=w; c.height=w;
  tplCtx = c.getContext('2d');
  tplCtx.fillStyle = TEMPLATES[idx].bg || '#FFFFFF';
  tplCtx.fillRect(0,0,w,w);
  const inner = TEMPLATES[idx].svg.replace(/<svg[^>]*>/,'').replace('</svg>','');
  const svgStr = '<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+w+'" viewBox="0 0 300 300">'+inner+'</svg>';
  const blob = new Blob([svgStr], {type:'image/svg+xml'});
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = function(){
    tplCtx.drawImage(img,0,0,w,w);
    URL.revokeObjectURL(url);
    tplUndo=[c.toDataURL()]; tplRedo=[];
  };
  img.src = url;
  activeDL = 'tpl';
  if(!c._bound){ c._bound=true; bindTemplate(c); }
}
function bindTemplate(c){
  function onStart(e){
    e.preventDefault();
    if(!tplCtx) return;
    const p = getXY(c,e);
    tplDrawing = true;
    tplCtx.strokeStyle=tplColor; tplCtx.lineWidth=tplSz; tplCtx.lineCap='round'; tplCtx.lineJoin='round'; tplCtx.globalAlpha=1;
    tplCtx.beginPath(); tplCtx.moveTo(p[0],p[1]); tplCtx.lineTo(p[0]+0.01,p[1]); tplCtx.stroke();
  }
  function onMove(e){
    e.preventDefault();
    if(!tplDrawing || !tplCtx) return;
    const p = getXY(c,e);
    tplCtx.strokeStyle=tplColor; tplCtx.lineWidth=tplSz;
    tplCtx.lineTo(p[0],p[1]); tplCtx.stroke();
    tplCtx.beginPath(); tplCtx.moveTo(p[0],p[1]);
  }
  function onEnd(){ if(!tplDrawing) return; tplDrawing=false; saveTplUndo(); }
  c.addEventListener('mousedown', onStart);
  c.addEventListener('touchstart', onStart, {passive:false});
  c.addEventListener('mousemove', onMove);
  c.addEventListener('touchmove', onMove, {passive:false});
  c.addEventListener('mouseup', onEnd);
  c.addEventListener('touchend', onEnd);
  document.addEventListener('mouseup', onEnd);
}
function saveTplUndo(){
  const c = document.getElementById('tpl-canvas');
  tplUndo.push(c.toDataURL());
  if(tplUndo.length>30) tplUndo.shift();
  tplRedo=[];
}
function undoTpl(){
  if(tplUndo.length<2) return;
  tplRedo.push(tplUndo.pop());
  const img = new Image();
  img.onload = function(){ tplCtx.clearRect(0,0,tplCtx.canvas.width,tplCtx.canvas.height); tplCtx.drawImage(img,0,0); };
  img.src = tplUndo[tplUndo.length-1];
}
function backToList(){
  document.getElementById('tpl-list').style.display='block';
  document.getElementById('tpl-viewer').style.display='none';
  activeDL='main';
}
function resetTpl(){ if(curTplIdx>=0) openTemplate(curTplIdx); }

// ══════════════════════════
//  DOWNLOAD
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

  let dataURL, w, h;
  if(activeDL === 'tpl'){
    const c = document.getElementById('tpl-canvas');
    dataURL = c.toDataURL(); w = c.width; h = c.height;
  } else {
    if(!fCanvas){ toast('Canvas not ready yet'); return; }
    dataURL = fCanvas.toDataURL({ format:'png', multiplier:2 });
    w = fCanvas.getWidth()*2; h = fCanvas.getHeight()*2;
  }

  const srcImg = new Image();
  srcImg.onload = function(){
    if(transparent){
      const a = document.createElement('a');
      a.download = 'khushi-doodle-' + Date.now() + '.png';
      a.href = dataURL;
      a.click();
      closeDL();
      toast('Saved! 💜');
      return;
    }
    const pad = Math.round(w*0.02) || 18;
    const noteH = note ? Math.round(h*0.045)+20 : Math.round(h*0.02)+10;
    const outW = w + pad*2, outH = h + pad*2 + noteH;
    const out = document.createElement('canvas');
    out.width = outW; out.height = outH;
    const ctx = out.getContext('2d');
    ctx.shadowColor = 'rgba(100,60,160,0.2)'; ctx.shadowBlur = 18; ctx.shadowOffsetX=3; ctx.shadowOffsetY=5;
    const g = ctx.createLinearGradient(0,0,outW,outH);
    g.addColorStop(0,'#EDE0FF'); g.addColorStop(1,'#F7E8FF');
    ctx.fillStyle = g;
    roundRect(ctx,7,7,outW-14,outH-14,16);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = 'rgba(170,140,220,0.28)';
    ctx.beginPath(); ctx.moveTo(outW-7,7); ctx.lineTo(outW-34,7); ctx.lineTo(outW-7,34); ctx.closePath(); ctx.fill();
    ctx.drawImage(srcImg, pad, pad, w, h);
    if(note){
      ctx.fillStyle = 'rgba(90,70,130,0.9)';
      ctx.font = 'bold ' + Math.max(20, Math.round(h*0.03)) + 'px Caveat,cursive';
      ctx.textAlign = 'center';
      ctx.fillText(note, outW/2, outH - noteH*0.35);
    }
    ctx.fillStyle = 'rgba(150,120,190,0.4)';
    ctx.font = '11px Quicksand,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText("Khushi's Studio ✨", outW-10, outH-6);

    const a = document.createElement('a');
    a.download = 'khushi-doodle-' + Date.now() + '.png';
    a.href = out.toDataURL('image/png');
    a.click();
    closeDL();
    toast('Saved to your gallery! 💜');
  };
  srcImg.src = dataURL;
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
  rain.style.display = 'block'; rain.innerHTML = '';
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
