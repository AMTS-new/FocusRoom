'use strict';
/* ═══════════════════════════════════════════════════════════
   FOCUSROOM  —  app.js
   ✅ All sounds synthesized by Web Audio API (NO external URLs)
      → Rain, Ocean, Night, Campfire, Wind, Café, Lo-Fi
   ✅ Every track has its own volume slider (0-100%)
   ✅ Master volume controls all tracks together
   ✅ Play/Stop each track independently, mix any combination
   ✅ Preset buttons: Focus Mix, Relax Mix, Stop All
   ✅ Timer controlled ONLY by room creator
   ✅ Live canvas with pen, eraser, text tool
   ✅ Real-time sync via Firebase
   ✅ Break chat (locked during focus)
   ✅ Members list + count + streak counter
═══════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────────────
// APP STATE
// ─────────────────────────────────────────────────────────
const state = {
  userId:    null,
  userName:  '',
  userColor: '#7c5cfc',
  roomCode:  '',
  roomRef:   null,
  isCreator: false,

  // Canvas
  isDrawing: false, currentTool: 'pen',
  brushSize: 4, drawColor: null,
  lastX: 0, lastY: 0,
  currentStrokeId: null, currentStrokePoints: [],
  allStrokes: {},
  undoStack: [],   // my stroke IDs, newest last
  redoStack: [],   // entries popped by undo

  // Timer
  timerInterval: null, timerSeconds: 25*60,
  timerRunning: false, isBreak: false, sessions: 0,

  // Members
  members: {},

  // Cleanup
  resizeHandler: null, cursorThrottle: null,
};

// ─────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────
function uid(len=8){ return Math.random().toString(36).substring(2,2+len).toUpperCase(); }
function showToast(msg,ms=3000){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),ms);
}
function showPage(id){
  document.querySelectorAll('.page').forEach(p=>{p.classList.remove('active');p.classList.add('hidden');});
  const pg=document.getElementById(id); pg.classList.remove('hidden'); pg.classList.add('active');
}
function fmt(s){ return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`; }
function canvasPos(e){
  const cv=document.getElementById('main-canvas'),r=cv.getBoundingClientRect();
  const sx=cv.width/r.width,sy=cv.height/r.height,src=e.touches?e.touches[0]:e;
  return{x:(src.clientX-r.left)*sx,y:(src.clientY-r.top)*sy};
}
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ─────────────────────────────────────────────────────────
// LANDING
// ─────────────────────────────────────────────────────────
function initLanding(){
  document.querySelectorAll('#color-options .color-dot').forEach(d=>{
    d.addEventListener('click',()=>{
      document.querySelectorAll('#color-options .color-dot').forEach(x=>x.classList.remove('selected'));
      d.classList.add('selected'); state.userColor=d.dataset.color;
    });
  });
  document.getElementById('btn-create').addEventListener('click',()=>{
    const n=document.getElementById('input-name').value.trim();
    if(!n){landErr('Please enter your name!');return;}
    enterRoom(n,uid(6),true);
  });
  document.getElementById('input-name').addEventListener('keydown',e=>{ if(e.key==='Enter') document.getElementById('btn-create').click(); });
  document.getElementById('btn-join-toggle').addEventListener('click',()=>{
    const s=document.getElementById('join-section'); s.classList.toggle('hidden');
    if(!s.classList.contains('hidden')) document.getElementById('input-room-code').focus();
  });
  document.getElementById('btn-join').addEventListener('click',doJoin);
  document.getElementById('input-room-code').addEventListener('keydown',e=>{
    e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(e.key==='Enter') doJoin();
  });
}
function doJoin(){
  const name=document.getElementById('input-name').value.trim();
  const code=document.getElementById('input-room-code').value.trim().toUpperCase();
  if(!name){landErr('Please enter your name!');return;}
  if(code.length<4){landErr('Please enter a valid room code!');return;}
  enterRoom(name,code,false);
}
function landErr(msg){ const el=document.getElementById('landing-error'); el.textContent=msg; el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'),3500); }

// ─────────────────────────────────────────────────────────
// ENTER ROOM
// ─────────────────────────────────────────────────────────
function enterRoom(name,code,isCreator){
  state.userName=name; state.userColor=state.userColor||'#7c5cfc';
  state.roomCode=code; state.userId=uid(10); state.isCreator=isCreator;
  state.roomRef=db.ref(`rooms/${code}`);

  const meRef=state.roomRef.child(`members/${state.userId}`);
  meRef.set({name:state.userName,color:state.userColor,status:'focused',isCreator,joinedAt:Date.now()});
  meRef.onDisconnect().remove();

  document.documentElement.style.setProperty('--user-color',state.userColor);
  document.getElementById('display-room-code').textContent=code;
  showPage('page-room');

  initCanvas();
  initMembersSync();
  initTimer();
  initChat();
  initRoomControls();
  resizeCanvas();
  initCanvasSync();
}

// ─────────────────────────────────────────────────────────
// CANVAS
// ─────────────────────────────────────────────────────────
function initCanvas(){
  const cv=document.getElementById('main-canvas');
  cv.addEventListener('mousedown',onDown); cv.addEventListener('mousemove',onMove);
  cv.addEventListener('mouseup',onUp);     cv.addEventListener('mouseleave',onUp);
  cv.addEventListener('touchstart',e=>{e.preventDefault();onDown(e);},{passive:false});
  cv.addEventListener('touchmove', e=>{e.preventDefault();onMove(e);},{passive:false});
  cv.addEventListener('touchend',  e=>{e.preventDefault();onUp(e);  },{passive:false});

  document.getElementById('own-color-dot').style.background=state.userColor;

  document.querySelectorAll('#canvas-color-options .color-dot').forEach(d=>{
    d.addEventListener('click',()=>{
      document.querySelectorAll('#canvas-color-options .color-dot').forEach(x=>x.classList.remove('selected'));
      d.classList.add('selected');
      state.drawColor=d.dataset.color==='own'?null:d.dataset.color;
    });
  });

  document.getElementById('brush-size').addEventListener('input',e=>{
    state.brushSize=parseInt(e.target.value);
    document.getElementById('brush-size-label').textContent=state.brushSize;
  });

  document.getElementById('tool-pen').addEventListener('click',()=>setTool('pen'));
  document.getElementById('tool-eraser').addEventListener('click',()=>setTool('eraser'));
  document.getElementById('tool-text').addEventListener('click',()=>setTool('text'));
  document.getElementById('tool-clear').addEventListener('click',clearMyDrawings);
  document.getElementById('btn-undo').addEventListener('click',doUndo);
  document.getElementById('btn-redo').addEventListener('click',doRedo);

  // Keyboard shortcuts — skip when user is typing in any input
  document.addEventListener('keydown',e=>{
    const tag=document.activeElement?.tagName;
    if(tag==='INPUT'||tag==='TEXTAREA') return;
    if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==='z'){e.preventDefault();doUndo();}
    if((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.shiftKey&&e.key==='z'))){e.preventDefault();doRedo();}
  });

  state.resizeHandler=resizeCanvas;
  window.addEventListener('resize',state.resizeHandler);
}

function resizeCanvas(){
  const cv=document.getElementById('main-canvas'),wr=document.getElementById('canvas-wrapper');
  cv.width=wr.clientWidth; cv.height=wr.clientHeight; redrawAll();
}

function setTool(t){
  state.currentTool=t;
  document.querySelectorAll('.tool-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById(`tool-${t}`)?.classList.add('active');
  document.getElementById('main-canvas').style.cursor=t==='eraser'?'cell':t==='text'?'text':'crosshair';
}

function onDown(e){
  const p=canvasPos(e);
  if(state.currentTool==='text'){showTextInput(p.x,p.y);return;}
  state.isDrawing=true; state.lastX=p.x; state.lastY=p.y;
  state.currentStrokeId=`${state.userId}_${Date.now()}`;
  state.currentStrokePoints=[{x:p.x,y:p.y}];
}

function onMove(e){
  if(!state.cursorThrottle){
    state.cursorThrottle=setTimeout(()=>{
      state.cursorThrottle=null;
      if(state.roomRef){
        const p=canvasPos(e),cv=document.getElementById('main-canvas');
        state.roomRef.child(`cursors/${state.userId}`).set({x:p.x/cv.width,y:p.y/cv.height,name:state.userName,color:state.userColor});
      }
    },80);
  }
  if(!state.isDrawing) return;
  const p=canvasPos(e),cv=document.getElementById('main-canvas'),ctx=cv.getContext('2d');
  const col=state.currentTool==='eraser'?'#07070e':(state.drawColor||state.userColor);
  const sz=state.currentTool==='eraser'?state.brushSize*4:state.brushSize;
  drawSeg(ctx,state.lastX,state.lastY,p.x,p.y,col,sz);
  state.currentStrokePoints.push({x:p.x,y:p.y});
  state.lastX=p.x; state.lastY=p.y;
}

function onUp(){
  if(!state.isDrawing) return;
  state.isDrawing=false;
  const pts=state.currentStrokePoints;
  if(!pts.length) return;
  const cv=document.getElementById('main-canvas'),ctx=cv.getContext('2d');
  const col=state.currentTool==='eraser'?'#07070e':(state.drawColor||state.userColor);
  const sz=state.currentTool==='eraser'?state.brushSize*4:state.brushSize;
  if(pts.length===1){
    ctx.beginPath(); ctx.arc(pts[0].x,pts[0].y,sz/2,0,Math.PI*2);
    ctx.fillStyle=col; ctx.fill();
    pts.push({x:pts[0].x+0.1,y:pts[0].y});
  }
  const stroke={userId:state.userId,color:state.currentTool==='eraser'?'__eraser__':col,points:pts,size:sz,tool:state.currentTool,ts:Date.now()};
  state.allStrokes[state.currentStrokeId]=stroke;
  state.roomRef?.child(`strokes/${state.currentStrokeId}`).set(stroke);
  // Record in undo stack; new stroke clears redo chain
  state.undoStack.push(state.currentStrokeId);
  state.redoStack=[];
  refreshUndoRedoBtns();
  state.currentStrokePoints=[];
}

function drawSeg(ctx,x1,y1,x2,y2,col,sz){
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
  ctx.strokeStyle=col==='__eraser__'?'#07070e':col;
  ctx.lineWidth=sz; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.stroke();
}

function redrawAll(){
  const cv=document.getElementById('main-canvas'),ctx=cv.getContext('2d');
  ctx.clearRect(0,0,cv.width,cv.height);
  Object.values(state.allStrokes).sort((a,b)=>(a.ts||0)-(b.ts||0)).forEach(s=>{
    if(s.tool==='text'&&s.text){
      ctx.font=`${s.fontSize||16}px DM Sans,sans-serif`;
      ctx.fillStyle=s.color||'#fff'; ctx.fillText(s.text,s.x,s.y); return;
    }
    if(!s.points||s.points.length<2) return;
    const col=s.color==='__eraser__'?'#07070e':s.color;
    for(let i=1;i<s.points.length;i++) drawSeg(ctx,s.points[i-1].x,s.points[i-1].y,s.points[i].x,s.points[i].y,col,s.size);
  });
}

function clearMyDrawings(){
  const toRemove=Object.keys(state.allStrokes).filter(id=>id.startsWith(state.userId));
  if(!toRemove.length){showToast('🗑️ Nothing to clear');return;}
  // Save snapshot for undo
  const snapshot=toRemove.map(id=>({id,data:state.allStrokes[id]}));
  state.undoStack.push({type:'clear',snapshot});
  state.redoStack=[];
  toRemove.forEach(id=>{delete state.allStrokes[id];state.roomRef?.child(`strokes/${id}`).remove();});
  redrawAll(); refreshUndoRedoBtns();
  showToast(`🗑️ Cleared ${toRemove.length} stroke(s) — Ctrl+Z to undo`);
}

function showTextInput(x,y){
  const ov=document.getElementById('text-overlay'),inp=document.getElementById('text-input');
  const ca=document.getElementById('canvas-area'),wr=document.getElementById('canvas-wrapper');
  const cv=document.getElementById('main-canvas');
  const wr_r=wr.getBoundingClientRect(),ca_r=ca.getBoundingClientRect();
  const sx=cv.width/wr_r.width,sy=cv.height/wr_r.height;
  ov.style.left=(wr_r.left-ca_r.left+x/sx)+'px';
  ov.style.top =(wr_r.top -ca_r.top +y/sy)+'px';
  ov.classList.remove('hidden'); ov.classList.add('active');
  inp.value='';
  setTimeout(()=>inp.focus(),20);

  function finish(){
    const txt=inp.value.trim();
    if(txt) placeText(x,y,txt);
    ov.classList.add('hidden'); ov.classList.remove('active');
    inp.removeEventListener('keydown',kh);
    document.removeEventListener('mousedown',outside);
    setTool('pen');
  }
  function cancel(){
    ov.classList.add('hidden'); ov.classList.remove('active');
    inp.removeEventListener('keydown',kh);
    document.removeEventListener('mousedown',outside);
    setTool('pen');
  }
  function kh(e){
    e.stopPropagation(); // CRITICAL: prevent Enter reaching chat listener
    if(e.key==='Enter'){e.preventDefault();finish();}
    if(e.key==='Escape'){e.preventDefault();cancel();}
  }
  function outside(e){
    if(!ov.contains(e.target)) finish();
  }
  inp.removeEventListener('keydown',inp._kh||null);
  inp._kh=kh;
  inp.addEventListener('keydown',kh);
  // slight delay so the current mousedown doesn't immediately close it
  setTimeout(()=>document.addEventListener('mousedown',outside),50);
}

function placeText(x,y,text){
  const cv=document.getElementById('main-canvas'),ctx=cv.getContext('2d');
  const col=state.drawColor||state.userColor,size=Math.max(14,12+state.brushSize);
  ctx.font=`${size}px DM Sans,sans-serif`; ctx.fillStyle=col; ctx.fillText(text,x,y);
  const id=`${state.userId}_text_${Date.now()}`;
  const data={userId:state.userId,color:col,tool:'text',text,x,y,fontSize:size,ts:Date.now()};
  state.allStrokes[id]=data; state.roomRef?.child(`strokes/${id}`).set(data);
  state.undoStack.push(id); state.redoStack=[]; refreshUndoRedoBtns();
}

// ── UNDO / REDO ───────────────────────────────────────────
function doUndo(){
  if(!state.undoStack.length){showToast('Nothing to undo');return;}
  const entry=state.undoStack.pop();
  if(typeof entry==='string'){
    // single stroke
    const saved=state.allStrokes[entry];
    if(saved){state.redoStack.push({type:'stroke',id:entry,data:saved});delete state.allStrokes[entry];state.roomRef?.child(`strokes/${entry}`).remove();}
  } else if(entry.type==='clear'){
    // batch clear — restore all
    state.redoStack.push(entry);
    entry.snapshot.forEach(({id,data})=>{state.allStrokes[id]=data;state.roomRef?.child(`strokes/${id}`).set(data);});
  }
  redrawAll(); refreshUndoRedoBtns(); showToast('↩ Undone');
}
function doRedo(){
  if(!state.redoStack.length){showToast('Nothing to redo');return;}
  const entry=state.redoStack.pop();
  if(entry.type==='stroke'){
    state.allStrokes[entry.id]=entry.data;
    state.roomRef?.child(`strokes/${entry.id}`).set(entry.data);
    state.undoStack.push(entry.id);
  } else if(entry.type==='clear'){
    state.undoStack.push(entry);
    entry.snapshot.forEach(({id})=>{delete state.allStrokes[id];state.roomRef?.child(`strokes/${id}`).remove();});
  }
  redrawAll(); refreshUndoRedoBtns(); showToast('↪ Redone');
}
function refreshUndoRedoBtns(){
  const u=document.getElementById('btn-undo'),r=document.getElementById('btn-redo');
  if(u) u.disabled=!state.undoStack.length;
  if(r) r.disabled=!state.redoStack.length;
}

// ─────────────────────────────────────────────────────────
// CANVAS FIREBASE SYNC
// ─────────────────────────────────────────────────────────
function initCanvasSync(){
  if(!state.roomRef) return;
  state.roomRef.child('strokes').on('child_added',snap=>{
    const id=snap.key,s=snap.val();
    if(state.allStrokes[id]) return;
    state.allStrokes[id]=s;
    const cv=document.getElementById('main-canvas'),ctx=cv.getContext('2d');
    if(s.tool==='text'&&s.text){ctx.font=`${s.fontSize||16}px DM Sans,sans-serif`;ctx.fillStyle=s.color||'#fff';ctx.fillText(s.text,s.x,s.y);}
    else if(s.points&&s.points.length>=2){const col=s.color==='__eraser__'?'#07070e':s.color;for(let i=1;i<s.points.length;i++) drawSeg(ctx,s.points[i-1].x,s.points[i-1].y,s.points[i].x,s.points[i].y,col,s.size);}
  });
  state.roomRef.child('strokes').on('child_removed',snap=>{delete state.allStrokes[snap.key];redrawAll();});
  state.roomRef.child('cursors').on('value',snap=>renderCursors(snap.val()||{}));
}

function renderCursors(cursors){
  const wr=document.getElementById('canvas-wrapper'),cv=document.getElementById('main-canvas');
  wr.querySelectorAll('.remote-cursor').forEach(c=>c.remove());
  Object.entries(cursors).forEach(([id,c])=>{
    if(id===state.userId) return;
    const el=document.createElement('div'); el.className='remote-cursor';
    el.style.left=(c.x*cv.width)+'px'; el.style.top=(c.y*cv.height)+'px';
    el.innerHTML=`<div class="remote-cursor-dot" style="background:${c.color}"></div><div class="remote-cursor-label" style="background:${c.color}">${esc(c.name)}</div>`;
    wr.appendChild(el);
  });
}

// ─────────────────────────────────────────────────────────
// MEMBERS
// ─────────────────────────────────────────────────────────
function initMembersSync(){
  state.roomRef.child('members').on('value',snap=>{
    state.members=snap.val()||{};
    renderMembers();
    document.getElementById('members-count').textContent=Object.keys(state.members).length;
  });
}
function renderMembers(){
  const list=document.getElementById('members-list'); list.innerHTML='';
  Object.entries(state.members).forEach(([id,m])=>{
    const isYou=id===state.userId,status=m.status||'focused';
    const slabel=status==='focused'?'🟢 Focused':status==='break'?'☕ Break':status==='paused'?'⏸ Paused':'🔵 Online';
    const div=document.createElement('div'); div.className=`member-item${isYou?' is-you':''}`;
    div.innerHTML=`<div class="member-avatar" style="background:${m.color}">${m.name.charAt(0).toUpperCase()}</div><div class="member-info"><div class="member-name">${esc(m.name)}${isYou?' <span style="opacity:.45;font-size:.6rem">(you)</span>':''}${m.isCreator?' 👑':''}</div><div class="member-status ${status}">${slabel}</div></div>`;
    list.appendChild(div);
  });
}
function setMyStatus(s){ state.roomRef?.child(`members/${state.userId}/status`).set(s); }

// ─────────────────────────────────────────────────────────
// TIMER — Firebase-synced so ALL participants see same time
//
// Creator writes to rooms/{code}/timerState:
//   { running, isBreak, seconds, sessions, startedAt }
// Every client (including creator) listens and drives a local
// setInterval. The startedAt field lets late-joiners catch up.
//
// Chat lock stored at rooms/{code}/chatLocked so break unlocks
// for everyone simultaneously.
// ─────────────────────────────────────────────────────────
function initTimer(){
  if(state.isCreator){
    document.getElementById('timer-controls').classList.remove('hidden');
    document.getElementById('timer-viewer-msg').classList.add('hidden');
    document.getElementById('btn-start-timer').addEventListener('click',()=>{
      state.timerRunning ? _tWrite({running:false,isBreak:state.isBreak,seconds:state.timerSeconds,sessions:state.sessions,startedAt:null})
                        : _tWrite({running:true, isBreak:state.isBreak,seconds:state.timerSeconds,sessions:state.sessions,startedAt:Date.now()});
    });
    document.getElementById('btn-reset-timer').addEventListener('click',()=>{
      _tWrite({running:false,isBreak:false,seconds:25*60,sessions:state.sessions,startedAt:null});
      state.roomRef.child('chatLocked').set(true);
    });
    // initialise Firebase state on room creation
    _tWrite({running:false,isBreak:false,seconds:25*60,sessions:0,startedAt:null});
    state.roomRef.child('chatLocked').set(true);
  } else {
    document.getElementById('timer-controls').classList.add('hidden');
    document.getElementById('timer-viewer-msg').classList.remove('hidden');
  }
  // Everyone (incl. creator) listens for timer state changes
  state.roomRef.child('timerState').on('value', snap=>{ const v=snap.val(); if(v) _applyTimerState(v); });
  // Everyone listens for chat lock changes
  state.roomRef.child('chatLocked').on('value', snap=>{ _applyChatLock(snap.val()!==false); });
  // Skip break — anyone can dismiss overlay locally
  document.getElementById('btn-skip-break').addEventListener('click',()=>{
    document.getElementById('break-overlay').classList.add('hidden');
    if(state.isCreator) _tWrite({running:false,isBreak:false,seconds:25*60,sessions:state.sessions,startedAt:null});
  });
  renderTimer();
}

function _tWrite(obj){ state.roomRef.child('timerState').set(obj); }

function _applyTimerState(ts){
  clearInterval(state.timerInterval);
  state.isBreak   = !!ts.isBreak;
  state.sessions  = ts.sessions||0;
  document.getElementById('streak-count').textContent = state.sessions;

  if(ts.running && ts.startedAt){
    // Adjust for time already elapsed since startedAt
    const elapsed = Math.floor((Date.now()-ts.startedAt)/1000);
    state.timerSeconds = Math.max(0, (ts.seconds||0) - elapsed);
    state.timerRunning = true;
    if(state.isCreator) document.getElementById('btn-start-timer').textContent='⏸ Pause';
    setMyStatus(ts.isBreak?'break':'focused');

    state.timerInterval = setInterval(()=>{
      state.timerSeconds--;
      renderTimer();
      _syncBreakOverlay();
      if(state.timerSeconds<=0){
        clearInterval(state.timerInterval);
        state.timerRunning=false;
        if(state.isCreator){
          if(!state.isBreak){
            state.sessions++;
            document.getElementById('streak-count').textContent=state.sessions;
            showToast(`🔥 Session ${state.sessions} done! Break time!`);
            _tWrite({running:true,isBreak:true,seconds:5*60,sessions:state.sessions,startedAt:Date.now()});
            state.roomRef.child('chatLocked').set(false);
          } else {
            showToast('🎯 Break over! Back to focus!');
            _tWrite({running:false,isBreak:false,seconds:25*60,sessions:state.sessions,startedAt:null});
            state.roomRef.child('chatLocked').set(true);
          }
        }
      }
    },1000);
  } else {
    state.timerSeconds = ts.seconds||25*60;
    state.timerRunning = false;
    if(state.isCreator) document.getElementById('btn-start-timer').textContent='▶ Start';
    setMyStatus('paused');
  }
  renderTimer();
  _syncBreakOverlay();
}

function _syncBreakOverlay(){
  const ov=document.getElementById('break-overlay');
  if(state.isBreak){
    ov.classList.remove('hidden');
    document.getElementById('break-timer').textContent=fmt(state.timerSeconds);
    document.getElementById('timer-status').textContent='Break ☕';
    document.getElementById('timer-display').className='timer-display break-mode';
  } else {
    ov.classList.add('hidden');
    document.getElementById('timer-status').textContent='Focus Time';
    document.getElementById('timer-display').className='timer-display';
  }
}

function renderTimer(){
  const el=document.getElementById('timer-display');
  el.textContent=fmt(state.timerSeconds);
  if(!state.isBreak&&state.timerSeconds<=60&&state.timerRunning) el.classList.add('urgent');
  else el.classList.remove('urgent');
}

// ─────────────────────────────────────────────────────────
// CHAT — lock synced via Firebase, Enter key fixed
// ─────────────────────────────────────────────────────────
function initChat(){
  const inp=document.getElementById('chat-input'),btn=document.getElementById('btn-send-chat');
  btn.addEventListener('click',sendChat);
  // stopPropagation prevents Enter reaching any canvas listener
  inp.addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Enter') sendChat(); });
  state.roomRef.child('chat').on('child_added',snap=>appendMsg(snap.val()));
  // chatLocked listener is registered in initTimer so it fires immediately
}
function _applyChatLock(locked){
  const inp=document.getElementById('chat-input'),btn=document.getElementById('btn-send-chat');
  inp.disabled=locked; btn.disabled=locked;
  document.getElementById('chat-lock').textContent=locked?'🔒':'🟢';
  inp.placeholder=locked?'Locked during focus...':'Say something...';
  if(!locked) setTimeout(()=>inp.focus(),100);
}
function sendChat(){
  const inp=document.getElementById('chat-input'),txt=inp.value.trim();
  if(!txt||inp.disabled) return;
  state.roomRef.child('chat').push({userId:state.userId,name:state.userName,color:state.userColor,text:txt,ts:Date.now()});
  inp.value='';
}
function appendMsg(msg){
  const box=document.getElementById('chat-messages');
  const hint=box.querySelector('.chat-hint'); if(hint) hint.remove();
  const div=document.createElement('div'); div.className='chat-msg';
  div.style.setProperty('--msg-color',msg.color||'#7c5cfc');
  div.innerHTML=`<div class="msg-author">${esc(msg.name)}</div><div class="msg-text">${esc(msg.text)}</div>`;
  box.appendChild(div); box.scrollTop=box.scrollHeight;
}

// ─────────────────────────────────────────────────────────
// ROOM CONTROLS
// ─────────────────────────────────────────────────────────
function initRoomControls(){
  document.getElementById('btn-copy-code').addEventListener('click',()=>{
    const code=state.roomCode;
    if(navigator.clipboard){navigator.clipboard.writeText(code).then(()=>showToast(`📋 "${code}" copied! Share with friends`)).catch(()=>showToast(`Room: ${code}`));}
    else showToast(`Room code: ${code}`);
  });
  document.getElementById('btn-leave').addEventListener('click',()=>{if(confirm('Leave the room?')) leaveRoom();});
}

function leaveRoom(){
  clearInterval(state.timerInterval);
  clearTimeout(state.cursorThrottle);
  if(state.resizeHandler){window.removeEventListener('resize',state.resizeHandler);state.resizeHandler=null;}
  if(state.roomRef){
    state.roomRef.child(`members/${state.userId}`).remove();
    state.roomRef.child(`cursors/${state.userId}`).remove();
    ['members','strokes','cursors','chat','timerState','chatLocked'].forEach(k=>state.roomRef.child(k).off());
    state.roomRef=null;
  }
  Object.assign(state,{allStrokes:{},members:{},timerRunning:false,isBreak:false,timerSeconds:25*60,sessions:0,currentStrokePoints:[],isCreator:false});
  document.getElementById('members-list').innerHTML='';
  document.getElementById('chat-messages').innerHTML='<div class="chat-hint">Chat unlocks during break ☕</div>';
  document.getElementById('streak-count').textContent='0';
  document.getElementById('members-count').textContent='1';
  if(document.getElementById('btn-start-timer')) document.getElementById('btn-start-timer').textContent='▶ Start';
  document.getElementById('timer-display').className='timer-display';
  document.getElementById('timer-display').textContent='25:00';
  document.getElementById('break-overlay').classList.add('hidden');
  const cv=document.getElementById('main-canvas');
  cv.getContext('2d').clearRect(0,0,cv.width,cv.height);
  showPage('page-landing');
  showToast('👋 You left the room');
}

// ─────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{ initLanding(); console.log('🚀 FocusRoom ready!'); });
