#pragma once
#include <Arduino.h>

static const char PAGE[] PROGMEM = R"HTML(<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LED Panel</title>
<style>
:root{--bg:#f4f5f7;--card:#fff;--fg:#1c1f26;--mut:#6b7280;--line:#e3e6ea;--acc:#2563eb;--ok:#16a34a;--err:#dc2626;--warn:#d97706;--log:#0f172a;--logfg:#cbd5e1}
@media (prefers-color-scheme:dark){:root{--bg:#0e1116;--card:#171b22;--fg:#e6e9ef;--mut:#8b93a1;--line:#272d38;--acc:#60a5fa;--ok:#4ade80;--err:#f87171;--warn:#fbbf24;--log:#0a0d12}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;max-width:880px;margin:0 auto}
h1{font-size:1.25rem;margin:0}
h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:0 0 12px}
main{max-width:880px;margin:0 auto;padding:0 16px 32px;display:grid;gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.pill{display:inline-flex;align-items:center;gap:7px;padding:5px 12px;border-radius:99px;border:1px solid var(--line);background:var(--card);font-size:.85rem;white-space:nowrap}
.dot{width:9px;height:9px;border-radius:50%;background:var(--mut)}
.pill.ok .dot{background:var(--ok)}.pill.busy .dot{background:var(--warn);animation:p 1s infinite}.pill.bad .dot{background:var(--err)}
@keyframes p{50%{opacity:.3}}
.steps{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.step{flex:1;min-width:84px;text-align:center;padding:6px 4px;border-radius:8px;border:1px solid var(--line);font-size:.78rem;color:var(--mut)}
.step.done{color:var(--ok);border-color:var(--ok)}.step.act{color:var(--acc);border-color:var(--acc);font-weight:600}.step.err{color:var(--err);border-color:var(--err)}
.bar{height:10px;border-radius:99px;background:var(--line);overflow:hidden}
.bar>i{display:block;height:100%;width:0;background:var(--acc);transition:width .4s}
.bar.ok>i{background:var(--ok)}.bar.err>i{background:var(--err)}
.msg{display:flex;justify-content:space-between;margin:8px 0 12px;font-size:.9rem}
.msg b{font-weight:600}
#log{background:var(--log);color:var(--logfg);font:12px/1.5 ui-monospace,Consolas,monospace;padding:10px;border-radius:8px;height:200px;overflow:auto}
#log div{white-space:pre-wrap;word-break:break-word}#log .ok{color:#4ade80}#log .err{color:#f87171}#log .t{color:#64748b;margin-right:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.demo{border:1px solid var(--line);border-radius:10px;padding:10px;display:grid;gap:8px}
.demo img,#prev{width:100%;aspect-ratio:4/1;image-rendering:pixelated;background:#000;border-radius:6px;object-fit:contain;display:block}
button{font:inherit;padding:9px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
button.pri{background:var(--acc);border-color:var(--acc);color:#fff}
button:disabled{opacity:.45;cursor:not-allowed}
#drop{border:2px dashed var(--line);border-radius:10px;padding:18px;text-align:center;color:var(--mut);cursor:pointer}
#drop.hot{border-color:var(--acc);color:var(--acc)}
#fi{display:none}
.info{font-size:.85rem;margin:10px 0;color:var(--mut)}.info .w{color:var(--warn)}.info .e{color:var(--err)}
.kv{display:grid;grid-template-columns:auto 1fr;gap:5px 16px;font-size:.9rem}.kv dt{color:var(--mut)}.kv dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
#tx{width:100%;font:inherit;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);margin-bottom:10px}
.meter{height:10px;border-radius:99px;background:var(--line);overflow:hidden;margin-top:10px}.meter>i{display:block;height:100%;width:0;background:var(--ok);transition:width .25s}
.chk{display:flex!important;grid-template-columns:none;align-items:center;gap:8px}.chk input{width:auto!important;height:auto!important}
#tp,#lp{width:100%;aspect-ratio:4/1;image-rendering:pixelated;background:#000;border-radius:6px;display:block}
.opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0}
.opts label{display:grid;gap:4px;font-size:.8rem;color:var(--mut)}
.opts select,.opts input{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px;width:100%;height:36px}
.opts input[type=range]{padding:0}
.sw{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.sw i{width:22px;height:22px;border-radius:50%;border:2px solid var(--line);cursor:pointer}
.mpkrows{background:#000;color:#ffb000;font:700 20px/1.35 ui-monospace,Consolas,monospace;border-radius:8px;padding:10px 14px;margin-bottom:6px}.mpkrows div{display:flex;justify-content:space-between;min-height:1.35em}
#ban{display:none;background:#fef3c7;color:#78350f;border-radius:10px;padding:10px 14px;font-size:.9rem}
</style></head><body>
<header><h1>LED Panel</h1><span class="pill" id="pill"><span class="dot"></span><span id="pt">connecting…</span></span></header>
<main>
<div id="ban"></div>

<section class="card"><h2>Live job</h2>
 <div class="steps" id="steps"></div>
 <div class="bar" id="bar"><i></i></div>
 <div class="msg"><b id="ph">Idle</b><span id="pc"></span></div>
 <div id="log"></div>
</section>

<section class="card"><h2>Built-in animations</h2>
 <div class="grid">
  <div class="demo"><img src="/demo.gif?n=a" alt="A"><b>A — green bar</b><button class="pri" data-demo="a">Send to panel</button></div>
  <div class="demo"><img src="/demo.gif?n=b" alt="B"><b>B — checkerboard</b><button class="pri" data-demo="b">Send to panel</button></div>
 </div>
</section>

<section class="card"><h2>Text</h2>
 <input id="tx" type="text" maxlength="120" placeholder="Type some text…" value="Hello!" autocomplete="off">
 <canvas id="tp" width="64" height="16"></canvas>
 <div class="opts">
  <label>Mode<select id="tm"><option value="scroll">Scrolling ←</option><option value="static">Static</option><option value="blink">Blinking</option></select></label>
  <label>Size<select id="ts"><option value="1">Small 5×7 (with Polish letters)</option><option value="2">Large 10×14 (no diacritics)</option></select></label>
  <label>Scroll speed<input type="range" id="tv" min="1" max="5" value="3"></label>
  <label>Text colour<input type="color" id="tc" value="#00ff00"></label>
  <label>Background<input type="color" id="tb" value="#000000"></label>
 </div>
 <div class="sw" id="sw"></div>
 <div class="info" id="ti"></div>
 <button class="pri" id="tsend" disabled>Send text to panel</button>
</section>

<section class="card"><h2>Custom GIF</h2>
 <div id="drop">Drop a .gif file here or click to choose<br><small>64×16 px, up to 64 KB</small></div>
 <input type="file" id="fi" accept=".gif,image/gif">
 <div id="pv" style="display:none;margin-top:12px"><img id="prev" alt="preview"></div>
 <div class="info" id="fin"></div>
 <button class="pri" id="send" disabled>Send to panel</button>
</section>

<section class="card"><h2>Game of Life → GIF</h2>
 <canvas id="lp" width="64" height="16"></canvas>
 <div class="meter"><i id="lbar"></i></div>
 <div class="info" id="li"></div>
 <div class="opts">
  <label><span>Generations (<span id="lnv">100</span>)</span><input type="range" id="ln" min="10" max="600" value="100"></label>
  <label>Frame time<select id="lt"><option value="50">50 ms</option><option value="100" selected>100 ms</option><option value="150">150 ms</option><option value="200">200 ms</option><option value="300">300 ms</option><option value="500">500 ms</option></select></label>
  <label><span>Initial density (<span id="ldv">30</span>%)</span><input type="range" id="ld" min="10" max="60" value="30"></label>
  <label>Random seed<input type="number" id="lseed" value="1" min="0" max="999999"></label>
  <label>Live cell colour<input type="color" id="lc" value="#00c000"></label>
  <label>Background<input type="color" id="lb" value="#000000"></label>
  <label class="chk"><input type="checkbox" id="lw" checked>Wrap around edges</label>
  <label class="chk"><input type="checkbox" id="lr" checked>Reseed on stagnation</label>
  <label class="chk"><input type="checkbox" id="la" checked>Trim to the 64 KB limit</label>
 </div>
 <div class="row"><button id="lrnd">Random seed</button><button class="pri" id="lsend" disabled>Send GIF to panel</button></div>
</section>

<section class="card"><h2>Stream test — Game of Life</h2>
 <div class="opts">
  <label>Frame format<select id="bm"><option value="both">RGB, then 1-bit</option><option value="rgb">PNG RGB (3.2 KB)</option><option value="idx">PNG 1-bit (~0.25 KB)</option></select></label>
  <label>Seconds per variant<input type="number" id="bs" value="10" min="3" max="60"></label>
  <label>Gap between packets (ms)<input type="number" id="bg" value="10" min="0" max="50"></label>
 </div>
 <div class="row"><button class="pri" id="bgo">Start test</button><button id="bstop">Stop</button></div>
 <div class="info">2×2 px cells (32×8 grid) are computed on the ESP and sent as PNG frames over a single BLE connection. Results (fps, confirmation latency) appear in the log at the top. Afterwards the panel may stay in its loading mode until you send a regular GIF.</div>
</section>

<section class="card"><h2>MPK departures</h2>
 <div class="mpkrows" id="mrows"></div>
 <div class="opts">
  <label>Stop code<input id="ms" maxlength="12" value="12020"></label>
  <label>Lines (comma-separated)<input id="ml" maxlength="40" value="13"></label>
  <label>Direction (terminus or stop, optional)<input id="md" maxlength="40" value="Stadion Olimpijski"></label>
  <label>Refresh every (s)<input type="number" id="mi" min="15" max="600" value="30"></label>
  <label class="chk"><input type="checkbox" id="me">MPK mode on</label>
 </div>
 <div class="info" id="minfo"></div>
 <div class="row"><button class="pri" id="msave">Save</button><button id="mnow">Refresh now</button></div>
 <div class="info">The ESP asks the Wrocław transit worker for the next 2 departures and shows them on the panel, one per row (line on the left, minutes on the right). The panel is only updated when the departures change. Sending any other animation switches MPK mode off.</div>
</section>

<section class="card"><h2>Device</h2>
 <dl class="kv" id="kv"></dl>
 <div class="row"><button id="reboot">Restart ESP</button></div>
</section>
</main>
<script src="/font.js"></script>
<script>
const $=s=>document.querySelector(s);
const STEPS=[['scan','BLE scan'],['connect','Connect'],['handshake','Handshake'],['send','Transfer'],['confirm','Confirmation']];
const PH={idle:'Idle',scan:'Looking for the panel…',connect:'Connecting to the panel…',handshake:'Handshake…',send:'Sending data…',confirm:'Waiting for confirmation…',done:'Done — the panel confirmed',error:'Error'};
$('#steps').innerHTML=STEPS.map(s=>`<div class="step" data-s="${s[0]}">${s[1]}</div>`).join('');
let since=0,fails=0,running=false,lastRun=false,file=null;
const fmtT=ms=>{const s=Math.floor(ms/1000);return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')};
const fmtUp=s=>s>=3600?Math.floor(s/3600)+' h '+Math.floor(s%3600/60)+' min':s>=60?Math.floor(s/60)+' min '+s%60+' s':s+' s';

function render(s){
  const j=s.job;running=j.running||j.pending;
  const pill=$('#pill');
  pill.className='pill '+(running?'busy':'ok');
  $('#pt').textContent=running?'Sending… '+j.pct+'%':'ESP online';
  // steps
  const idx=STEPS.findIndex(x=>x[0]===j.phase);
  document.querySelectorAll('.step').forEach((e,i)=>{
    let c='step';
    if(j.phase==='done')c+=' done';
    else if(j.phase==='error'){ if(i<s.err_step)c+=' done'; else if(i===s.err_step)c+=' err'}
    else if(idx>=0){ if(i<idx)c+=' done'; else if(i===idx)c+=' act'}
    e.className=c;
  });
  const bar=$('#bar');bar.className='bar'+(j.phase==='done'?' ok':j.phase==='error'?' err':'');
  bar.firstElementChild.style.width=(j.phase==='error'?100:j.pct)+'%';
  $('#ph').textContent=(PH[j.phase]||j.phase)+(j.name&&running?' · '+j.name:'');
  $('#pc').textContent=running?j.pct+'%':(s.last.msg?s.last.msg+' ('+fmtUp(s.last.ago_s)+' ago)':'');
  // log
  if(s.seq<since){$('#log').innerHTML='';since=0}
  const L=$('#log'),stick=L.scrollTop+L.clientHeight>=L.scrollHeight-30;
  for(const e of s.log){
    const d=document.createElement('div');d.className=e.l;
    d.innerHTML='<span class="t">'+fmtT(e.t)+'</span>';d.append(e.m);L.append(d);
  }
  while(L.children.length>250)L.removeChild(L.firstChild);
  since=s.seq;if(stick)L.scrollTop=L.scrollHeight;
  // device
  const kv=[['Wi-Fi network',s.ssid],['IP address',s.ip],['Wi-Fi signal',s.rssi+' dBm'],
   ['LED panel',s.panel.addr],['BLE signal (last scan)',s.panel.rssi?s.panel.rssi+' dBm'+(s.panel.seen_s!=null?' ('+fmtUp(s.panel.seen_s)+' ago)':''):'—'],
   ['Jobs completed',s.jobs],['Uptime',fmtUp(s.uptime_s)],['Free memory',Math.round(s.heap/1024)+' KB'],['Firmware',s.fw]];
  $('#kv').innerHTML=kv.map(r=>`<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join('');
  renderMpk(s.mpk);
  document.querySelectorAll('[data-demo]').forEach(b=>b.disabled=running);
  $('#bgo').disabled=running;
  $('#send').disabled=running||!file||file.bad;
  $('#tsend').disabled=running||!tgif||tgif.length>65536;
  $('#lsend').disabled=running||!lgif||lgif.length>65536;
  $('#ban').style.display='none';lastRun=running;
}
let mpkInit=false;
function renderMpk(m){
  if(!m)return;
  if(!mpkInit){mpkInit=true;$('#ms').value=m.stop;$('#ml').value=m.lines;$('#md').value=m.dir;$('#mi').value=m.iv;$('#me').checked=m.en}
  $('#mrows').innerHTML=m.rows.map(r=>`<div><span>${r[0]||'&nbsp;'}</span><span>${r[1]}</span></div>`).join('');
  let t=m.en?'Mode <b>on</b>':'Mode <b>off</b>';
  if(m.stop_name)t+=` · ${m.stop_name} (${m.stop})`;
  if(m.age_s!=null)t+=` · updated ${fmtUp(m.age_s)} ago`;
  if(m.err)t+=` <span class="e">— ${m.err}</span>`;
  $('#minfo').innerHTML=t;
}
async function poll(){
  let delay=2500;
  try{
    const r=await fetch('/status?since='+since,{cache:'no-store',signal:AbortSignal.timeout(5000)});
    render(await r.json());fails=0;delay=running?700:2500;
  }catch(e){
    fails++;delay=1200;
    const p=$('#pill');p.className='pill bad';$('#pt').textContent='no response';
    if(fails>=2){const b=$('#ban');b.style.display='block';
      b.textContent=lastRun?'The ESP is busy connecting to the panel over BLE (up to ~20 s) — it will answer again automatically.':'The ESP is not responding. Check its power and that this computer is on the same network.'}
  }
  setTimeout(poll,delay);
}
async function post(url,opt){
  try{const r=await fetch(url,opt);const j=await r.json().catch(()=>({}));
    if(!r.ok)alert(j.error||('Error '+r.status));}catch(e){alert('Cannot reach the ESP')}
}
document.querySelectorAll('[data-demo]').forEach(b=>b.onclick=()=>post('/demo?n='+b.dataset.demo));
$('#bgo').onclick=()=>post('/bench?mode='+$('#bm').value+'&sec='+$('#bs').value+'&gap='+$('#bg').value);
$('#bstop').onclick=()=>post('/stop');
$('#msave').onclick=()=>post('/mpk',{method:'POST',body:new URLSearchParams({en:$('#me').checked?'1':'0',stop:$('#ms').value,lines:$('#ml').value,dir:$('#md').value,iv:$('#mi').value})});
$('#mnow').onclick=()=>post('/mpk/now');
$('#reboot').onclick=()=>{if(confirm('Restart the ESP?'))post('/reboot',{method:'POST'})};

// --- custom GIF ---
const drop=$('#drop'),fi=$('#fi');
drop.onclick=()=>fi.click();
drop.ondragover=e=>{e.preventDefault();drop.classList.add('hot')};
drop.ondragleave=()=>drop.classList.remove('hot');
drop.ondrop=e=>{e.preventDefault();drop.classList.remove('hot');pick(e.dataTransfer.files[0])};
fi.onchange=()=>pick(fi.files[0]);
async function pick(f){
  if(!f)return;file=null;$('#send').disabled=true;
  const b=new Uint8Array(await f.slice(0,16).arrayBuffer());
  const sig=String.fromCharCode(...b.slice(0,4));
  const w=b[6]|b[7]<<8,h=b[8]|b[9]<<8;
  let msg=`${f.name} · ${(f.size/1024).toFixed(1)} KB`,bad=false;
  if(sig!=='GIF8'){msg+=' <span class="e">— not a GIF file</span>';bad=true}
  else{msg+=` · ${w}×${h} px`;
    if(w!==64||h!==16)msg+=' <span class="w">— the panel is 64×16; other sizes may look wrong</span>'}
  if(f.size>65536){msg+=' <span class="e">— too large (max 64 KB)</span>';bad=true}
  $('#fin').innerHTML=msg;
  $('#prev').src=URL.createObjectURL(f);$('#pv').style.display='block';
  file=f;file.bad=bad;$('#send').disabled=bad||running;
}
$('#send').onclick=async()=>{
  if(!file||file.bad)return;const d=new FormData();d.append('gif',file,file.name);
  $('#send').disabled=true;await post('/gif',{method:'POST',body:d});
};
// --- text: render with the 5x7 font -> frames -> GIF (LZW) in the browser ---
let tgif=null,tpal=[],lgif=null;
const W=64,H=16;
function createPlayer(sel){
  let fr=[],dl=[],pal=[],i=0,timer=null;const c=$(sel).getContext('2d');
  function tick(){
    if(!fr.length)return;const f=fr[i%fr.length],im=c.createImageData(W,H);
    for(let p=0;p<W*H;p++){const col=pal[f[p]];im.data.set([col[0],col[1],col[2],255],p*4)}
    c.putImageData(im,0,0);timer=setTimeout(tick,Math.max(20,dl[i%dl.length]*10));i++}
  return{set(f,d,p){clearTimeout(timer);fr=f;dl=d;pal=p;i=0;tick()}}}
const tPlayer=createPlayer('#tp'),lPlayer=createPlayer('#lp');
const hex2rgb=h=>[1,3,5].map(i=>parseInt(h.substr(i,2),16));
function textBitmap(text,scale){
  const top=scale===1?-2:0,bot=scale===1?8:6,h=(bot-top+1)*scale,items=[];let x=0;
  for(const ch of text.replace(/\n/g,' ')){let c=ch;if(scale!==1&&FONT_BASE[c])c=FONT_BASE[c];
    const g=FONT[c]||FONT['?'];items.push([x,g[1]]);x+=(g[0]+1)*scale}
  const w=Math.max(1,x-scale),px=new Uint8Array(w*h);
  for(const [gx,rows] of items)for(const [y,row] of rows){if(y<top||y>bot)continue;
    for(let cx=0;cx<row.length;cx++)if(row[cx]==='#')for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){
      const xx=gx+cx*scale+dx,yy=(y-top)*scale+dy;if(xx<w&&yy<h)px[yy*w+xx]=1}}
  return{w,h,px}}
function blit(bm,xo){const f=new Uint8Array(W*H),yo=Math.floor((H-bm.h)/2);
  for(let y=0;y<bm.h;y++)for(let x=0;x<bm.w;x++){const X=x+xo,Y=y+yo;if(bm.px[y*bm.w+x]&&X>=0&&X<W&&Y>=0&&Y<H)f[Y*W+X]=1}
  return f}
function lzw(px,mc){
  const clear=1<<mc,eoi=clear+1;let size=mc+1,next=eoi+1,cur=0,nb=0;const out=[],dict=new Map();
  const emit=c=>{cur|=c<<nb;nb+=size;while(nb>=8){out.push(cur&255);cur>>>=8;nb-=8}};
  emit(clear);let pre=px[0];
  for(let i=1;i<px.length;i++){const k=px[i],key=(pre<<8)|k,v=dict.get(key);
    if(v!==undefined){pre=v;continue}
    emit(pre);dict.set(key,next++);
    if(next>(1<<size)&&size<12)size++;
    if(next>=4096){emit(clear);dict.clear();size=mc+1;next=eoi+1}
    pre=k}
  emit(pre);next++;if(next>(1<<size)&&size<12)size++;emit(eoi);
  if(nb>0)out.push(cur&255);return out}
function gifHeader(pal){
  const b=[],w16=n=>b.push(n&255,(n>>8)&255),str=s=>{for(const c of s)b.push(c.charCodeAt(0))};
  str('GIF89a');w16(W);w16(H);b.push(0xF3,0,0);               // global palette of 16 entries, no local tables (like the known-good files)
  for(let i=0;i<16;i++){const c=pal[i]||[0,0,0];b.push(c[0],c[1],c[2])}
  b.push(0x21,0xFF,0x0B);str('NETSCAPE2.0');b.push(3,1,0,0,0);
  return b}
function frameBlock(f,delay){
  const b=[],w16=n=>b.push(n&255,(n>>8)&255);
  b.push(0x21,0xF9,4,0x04);w16(delay);b.push(0,0);
  b.push(0x2C);w16(0);w16(0);w16(W);w16(H);b.push(0,4);
  const d=lzw(f,4);for(let o=0;o<d.length;o+=255){const n=Math.min(255,d.length-o);b.push(n);for(let k=0;k<n;k++)b.push(d[o+k])}
  b.push(0);return b}
function buildGif(frames,delays,pal){
  const b=gifHeader(pal);
  frames.forEach((f,i)=>{for(const x of frameBlock(f,delays[i]))b.push(x)});
  b.push(0x3B);return new Uint8Array(b)}
const SPEED=[[1,10],[1,6],[1,4],[1,3],[2,5]];   // [px per frame, delay in 1/100 s]
function buildText(){
  const text=$('#tx').value,scale=+$('#ts').value;let mode=$('#tm').value;
  const bm=textBitmap(text||' ',scale);let note='';
  if(mode==='static'&&bm.w>W){mode='scroll';note=' · text does not fit (64 px) — scrolling instead'}
  const fr=[],dl=[];
  if(mode==='static'){const f=blit(bm,Math.floor((W-bm.w)/2));fr.push(f,f);dl.push(100,100)}
  else if(mode==='blink'){fr.push(blit(bm,Math.floor((W-bm.w)/2)),new Uint8Array(W*H));dl.push(60,40);if(bm.w>W)note=' · text is wider than the panel — it will be clipped'}
  else{const[st,d]=SPEED[+$('#tv').value-1];for(let x=W;x>=-bm.w;x-=st){fr.push(blit(bm,x));dl.push(d)}}
  tpal=[hex2rgb($('#tb').value),hex2rgb($('#tc').value)];
  tgif=buildGif(fr,dl,tpal);
  const kb=(tgif.length/1024).toFixed(1);
  $('#ti').innerHTML=`${fr.length} frames · ${kb} KB${note}`+(tgif.length>65536?' <span class="e">— too large (max 64 KB): shorten the text, raise the speed or use static mode</span>':'');
  $('#tsend').disabled=running||tgif.length>65536||!text.trim();
  tPlayer.set(fr,dl,tpal)}
let tDeb;['#tx','#tm','#ts','#tv','#tc','#tb'].forEach(s=>$(s).addEventListener('input',()=>{clearTimeout(tDeb);tDeb=setTimeout(buildText,150)}));
$('#sw').innerHTML=['#ffffff','#ff2020','#00ff00','#3060ff','#ffb000','#ff40ff','#00e5ff'].map(c=>`<i style="background:${c}" data-c="${c}"></i>`).join('');
$('#sw').onclick=e=>{if(e.target.dataset.c){$('#tc').value=e.target.dataset.c;buildText()}};
$('#tsend').onclick=async()=>{
  if(!tgif||tgif.length>65536)return;const d=new FormData();
  d.append('gif',new Blob([tgif],{type:'image/gif'}),'text: '+$('#tx').value.slice(0,30));
  $('#tsend').disabled=true;await post('/gif',{method:'POST',body:d})};
// --- Game of Life -> GIF: 32x8 simulation (2x2 cells), file size computed live ---
const LIMIT=65536,LMAXGEN=600;
function mulberry32(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function lifeStep(g,wrap){
  const GW=32,GH=8,o=new Uint8Array(GW*GH);
  for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){let s=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;let yy=y+dy,xx=x+dx;
      if(wrap){yy=(yy+GH)%GH;xx=(xx+GW)%GW}else if(yy<0||yy>=GH||xx<0||xx>=GW)continue;s+=g[yy*GW+xx]}
    o[y*GW+x]=g[y*GW+x]?(s===2||s===3?1:0):(s===3?1:0)}
  return o}
function lifeFrames(n,dens,seed,wrap,reseed){
  const rnd=mulberry32(seed),GW=32,GH=8;let g=new Uint8Array(GW*GH),hist=[],reseeds=0;
  const sow=()=>{for(let i=0;i<g.length;i++)g[i]=rnd()<dens?1:0;hist=[]};
  const hash=a=>{let h=2166136261;for(const v of a)h=Math.imul(h^v,16777619)>>>0;return h};
  sow();const frames=[];
  for(let k=0;k<n;k++){
    const f=new Uint8Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++)f[y*W+x]=g[(y>>1)*GW+(x>>1)];
    frames.push(f);
    g=lifeStep(g,wrap);const h=hash(g);
    if(reseed&&(hist.includes(h)||!g.some(v=>v))){sow();reseeds++}else{hist.push(h);if(hist.length>4)hist.shift()}}
  return{frames,reseeds}}
function buildLife(){
  const n=+$('#ln').value,ms=+$('#lt').value,cs=Math.round(ms/10),dens=+$('#ld').value/100,seed=(+$('#lseed').value)>>>0;
  $('#lnv').textContent=n;$('#ldv').textContent=Math.round(dens*100);
  const pal=[hex2rgb($('#lb').value),hex2rgb($('#lc').value)];
  const sim=lifeFrames(LMAXGEN,dens,seed,$('#lw').checked,$('#lr').checked);
  const head=gifHeader(pal),blocks=sim.frames.map(f=>frameBlock(f,cs)),base=head.length+1;
  // how many generations fit in the limit with these settings (the size of every frame is known)
  let cum=base,maxFit=0;for(const b of blocks){if(cum+b.length>LIMIT)break;cum+=b.length;maxFit++}
  const sizeOf=k=>blocks.slice(0,k).reduce((s,b)=>s+b.length,base);
  const wanted=sizeOf(n),over=wanted>LIMIT,trim=$('#la').checked&&over;
  const keep=trim?maxFit:n,total=sizeOf(keep);
  const bytes=[...head];for(let i=0;i<keep;i++)for(const x of blocks[i])bytes.push(x);bytes.push(0x3B);
  lgif=new Uint8Array(bytes);
  lPlayer.set(sim.frames.slice(0,keep),new Array(keep).fill(cs),pal);
  const kb=total/1024,pct=Math.round(100*total/LIMIT),avg=Math.round((total-base)/Math.max(1,keep));
  const bar=$('#lbar');bar.style.width=Math.min(100,pct)+'%';bar.style.background=total>LIMIT?'var(--err)':pct>=80?'var(--warn)':'var(--ok)';
  let t=`<b>${keep} gen.</b> · <b>${kb.toFixed(1)} KB</b> of 64 KB (${pct}%) · ~${avg} B/frame · animation ${(keep*ms/1000).toFixed(1)} s`;
  t+=` · upload ≈ ${Math.round(2+kb/4)} s (measured: 3.4 KB→3 s, 12 KB→4 s)`;
  t+=maxFit>=LMAXGEN?` · ≥${LMAXGEN} generations fit with these settings`:` · max within the limit: <b>${maxFit}</b> gen.`;
  if(sim.reseeds)t+=` · reseeded ${sim.reseeds}×`;
  if(trim)t+=` <span class="w">— trimmed from ${n} to ${keep} gen. to fit the limit</span>`;
  if(total>LIMIT)t+=` <span class="e">— exceeds the 64 KB limit: reduce the generations or enable trimming</span>`;
  $('#li').innerHTML=t;
  $('#lsend').disabled=running||total>LIMIT||keep<1}
let lDeb;['#ln','#lt','#ld','#lseed','#lc','#lb','#lw','#lr','#la'].forEach(s=>$(s).addEventListener('input',()=>{clearTimeout(lDeb);lDeb=setTimeout(buildLife,120)}));
$('#lrnd').onclick=()=>{$('#lseed').value=Math.floor(Math.random()*1000000);buildLife()};
$('#lsend').onclick=async()=>{
  if(!lgif||lgif.length>LIMIT)return;const d=new FormData();
  d.append('gif',new Blob([lgif],{type:'image/gif'}),'life '+$('#lseed').value);
  $('#lsend').disabled=true;await post('/gif',{method:'POST',body:d})};
$('#lseed').value=Math.floor(Math.random()*1000000);
buildText();
buildLife();
poll();
</script></body></html>)HTML";

static const char SETUP_PAGE[] PROGMEM = R"HTML(<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Wi-Fi setup</title>
<style>body{font-family:system-ui;max-width:420px;margin:2rem auto;padding:0 1rem}input,button{font-size:1rem;padding:.6rem;width:100%;margin:.3rem 0;box-sizing:border-box}</style>
<h2>Wi-Fi setup</h2><form method="POST" action="/save">
<input name="ssid" list="n" placeholder="Network name (SSID)" required><datalist id="n">%NETS%</datalist>
<input name="pass" type="password" placeholder="Password"><button>Save and restart</button></form></html>)HTML";
