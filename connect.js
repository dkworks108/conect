#!/usr/bin/env node
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

// ═══ AUTO INSTALL ═══
const REQUIRED = ['ws','qrcode-terminal'];
(function(){
  const miss = REQUIRED.filter(p => { try { require.resolve(p); return false; } catch(e) { return true; } });
  if (!miss.length) return;
  console.log('\n📦 Installing packages (one-time)...\n');
  const pkg = path.join(__dirname,'package.json');
  if (!fs.existsSync(pkg)) fs.writeFileSync(pkg, JSON.stringify({name:'connect-app',version:'1.0.0',private:true}));
  try { execSync(`npm install ${miss.join(' ')} --save --no-audit --no-fund`,{cwd:__dirname,stdio:'inherit',timeout:60000}); console.log('\n✅ Done!\n'); }
  catch(e) { console.error('❌ Run: npm install ws qrcode-terminal'); process.exit(1); }
})();
const WebSocket = require('ws');
const qrcode = require('qrcode-terminal');

// ═══ CONFIG ═══
const PORT = parseInt(process.env.PORT) || 3000;
const MAX_MSG = 200, MAX_FILE = 10*1024*1024;

function getLocalIP() {
  for (const iface of Object.values(os.networkInterfaces()))
    for (const a of iface) if (a.family==='IPv4' && !a.internal) return a.address;
  return 'localhost';
}
function openBrowser(url) {
  try {
    if (process.platform==='darwin') spawn('open',[url],{detached:true,stdio:'ignore'});
    else if (process.platform==='win32') spawn('cmd',['/c','start','',url],{detached:true,stdio:'ignore',shell:true});
    else for (const c of ['xdg-open','firefox','chromium-browser','google-chrome']) try { spawn(c,[url],{detached:true,stdio:'ignore'}); break; } catch(e){}
  } catch(e){}
}

// ═══ STATE ═══
const rooms = new Map();
const clients = new Map();
let clientCounter = 0;

// ═══ EMBEDDED CSS ═══
const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{height:100%;-webkit-tap-highlight-color:transparent}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a1a;color:#f0f0ff;min-height:100vh;overflow-x:hidden;line-height:1.5}
:root{--p:#00d4ff;--s:#7b2fff;--bg:#0a0a1a;--sf:#12122a;--cd:#1a1a35;--ch:#222245;--tx:#f0f0ff;--t2:#a0a0cc;--tm:#6a6a9a;--bd:rgba(255,255,255,.08);--ok:#00ff88;--wr:#ffcc00;--er:#ff4444;--r:12px;--hh:56px;--nh:64px}
a{color:var(--p);text-decoration:none}button{cursor:pointer;font-family:inherit}
.hidden{display:none!important}.tmut{color:var(--tm)}.tsm{font-size:.8125rem}
.app{display:flex;flex-direction:column;min-height:100vh;max-width:100vw;position:relative}
header{position:sticky;top:0;z-index:100;height:var(--hh);display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:rgba(10,10,26,.92);backdrop-filter:blur(20px);border-bottom:1px solid var(--bd)}
.logo{font-weight:700;font-size:1.125rem;background:linear-gradient(135deg,var(--p),var(--s));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.hst{display:flex;align-items:center;gap:8px;font-size:.8rem;cursor:pointer}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.dot.on{background:var(--ok);box-shadow:0 0 6px rgba(0,255,136,.4)}.dot.off{background:var(--er)}.dot.aw{background:var(--wr)}
main{flex:1;position:relative;padding-bottom:var(--nh)}
.pg{display:none;padding:20px 16px;min-height:calc(100vh - var(--hh) - var(--nh));animation:pi .3s ease}
.pg.act{display:block}
@keyframes pi{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
nav.bn{position:fixed;bottom:0;left:0;right:0;height:var(--nh);display:flex;align-items:center;justify-content:space-around;background:rgba(10,10,26,.95);backdrop-filter:blur(20px);border-top:1px solid var(--bd);z-index:1000;padding-bottom:env(safe-area-inset-bottom,0)}
.ni{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 16px;border:none;background:none;color:var(--tm);font-size:.65rem;transition:.2s;position:relative}
.ni.act{color:var(--p)}.ni.act::after{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:24px;height:2px;background:var(--p);border-radius:0 0 2px 2px}
.ni svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 24px;border-radius:var(--r);font-weight:600;font-size:.875rem;border:none;transition:.2s}
.bp{background:linear-gradient(135deg,var(--p),var(--s));color:#fff;box-shadow:0 0 8px rgba(0,212,255,.2)}
.bp:hover:not(:disabled){box-shadow:0 0 20px rgba(0,212,255,.3);transform:translateY(-1px)}.bp:disabled{opacity:.5;cursor:not-allowed}
.bs{background:var(--sf);color:var(--tx);border:1px solid var(--bd)}.bs:hover{background:var(--cd)}
.fg{margin-bottom:16px}.fg label{display:block;font-size:.8125rem;font-weight:600;color:var(--t2);margin-bottom:6px}
input[type=text],input[type=url],select,textarea{width:100%;padding:12px 16px;background:var(--sf);border:1px solid var(--bd);border-radius:var(--r);color:var(--tx);font-size:.875rem;transition:.2s;font-family:inherit}
input:focus,textarea:focus{outline:none;border-color:var(--p);box-shadow:0 0 0 3px rgba(0,212,255,.1)}
.gc{background:var(--cd);border:1px solid var(--bd);border-radius:var(--r);padding:20px}
.nc{display:flex;align-items:center;gap:14px;padding:16px;background:var(--cd);border:1px solid var(--bd);border-radius:var(--r);cursor:pointer;transition:.2s;margin-bottom:12px}
.nc:hover{background:var(--ch);border-color:rgba(0,212,255,.3)}
.nc .nm{font-weight:600;font-size:.9375rem}.nc .mt{font-size:.75rem;color:var(--tm);margin-top:2px}
.jb{padding:8px 16px;border-radius:8px;font-size:.75rem;font-weight:700;background:linear-gradient(135deg,var(--p),var(--s));color:#fff;border:none;margin-left:auto;flex-shrink:0}
.es{text-align:center;padding:40px 20px;color:var(--tm)}.es h3{color:var(--t2);margin-bottom:8px}
#cht{padding:0;display:flex;flex-direction:column;height:calc(100vh - var(--hh) - var(--nh))}
.chd{padding:12px 16px;background:var(--cd);border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:12px}
.cml{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}
.cm{display:flex;gap:8px;max-width:85%;animation:pi .25s ease}.cm.me{align-self:flex-end;flex-direction:row-reverse}.cm.th{align-self:flex-start}.cm.sy{align-self:center;max-width:90%}
.st{font-size:.75rem;color:var(--tm);text-align:center;background:var(--sf);padding:4px 12px;border-radius:12px;border:1px solid var(--bd)}
.cav{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
.cb{padding:10px 14px;border-radius:16px 16px 16px 4px;background:var(--sf);border:1px solid var(--bd);font-size:.875rem;word-break:break-word}
.cb.me{border-radius:16px 16px 4px 16px;background:linear-gradient(135deg,rgba(0,212,255,.1),rgba(123,47,255,.1));border-color:rgba(0,212,255,.3)}
.cn{font-size:.75rem;font-weight:600;color:var(--p);margin-bottom:4px}
.cmt{font-size:.65rem;color:var(--tm);text-align:right;margin-top:4px}
.cia{padding:12px 16px;background:var(--cd);border-top:1px solid var(--bd);display:flex;align-items:flex-end;gap:8px;position:relative}
.ciw{flex:1;background:var(--sf);border:1px solid var(--bd);border-radius:20px;display:flex;align-items:flex-end;padding:4px}
.cia textarea{flex:1;border:none;background:transparent;padding:8px 12px;resize:none;max-height:120px;min-height:24px;box-shadow:none;font-size:.875rem;color:var(--tx)}
.ib{width:32px;height:32px;border-radius:50%;border:none;background:transparent;color:var(--tm);display:flex;align-items:center;justify-content:center;font-size:1.1rem;transition:.2s;cursor:pointer}
.ib:hover{background:rgba(255,255,255,.1);color:var(--tx)}
.sb{width:40px;height:40px;border-radius:50%;border:none;background:linear-gradient(135deg,var(--p),var(--s));color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:.2s}
.sb:disabled{background:var(--sf);color:var(--tm)}
#ti{position:absolute;top:-24px;left:16px;font-size:.75rem;color:var(--p)}
.ag{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px}
.ao{width:44px;height:44px;border-radius:50%;background:var(--sf);border:2px solid transparent;display:flex;align-items:center;justify-content:center;font-size:20px;cursor:pointer;transition:.2s}
.ao.sel{border-color:var(--p);background:var(--cd);transform:scale(1.1);box-shadow:0 0 8px rgba(0,212,255,.2)}
.cg{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px}
.co{width:36px;height:36px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:.2s}
.co.sel{border-color:#fff;transform:scale(1.1)}
.tc{position:fixed;top:calc(var(--hh) + 12px);right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.toast{padding:12px 16px;border-radius:var(--r);background:var(--cd);border:1px solid var(--bd);color:var(--tx);font-size:.8125rem;display:flex;align-items:center;gap:10px;pointer-events:auto;max-width:350px;transform:translateX(120%);transition:transform .35s;box-shadow:0 8px 32px rgba(0,0,0,.4);border-left:3px solid var(--p)}
.toast.show{transform:translateX(0)}.toast.ok{border-left-color:var(--ok)}.toast.er{border-left-color:var(--er)}.toast.wr{border-left-color:var(--wr)}
.tc-x{background:none;border:none;color:var(--tm);cursor:pointer;font-size:1rem;margin-left:auto}
.tg{position:relative;display:inline-block;width:44px;height:24px;cursor:pointer}.tg input{display:none}
.tt{position:absolute;inset:0;background:var(--sf);border-radius:999px;border:1px solid var(--bd);transition:.2s}
.tt::after{content:'';position:absolute;width:18px;height:18px;top:2px;left:3px;background:var(--tm);border-radius:50%;transition:.2s}
.tg input:checked+.tt{background:var(--p);border-color:var(--p)}.tg input:checked+.tt::after{transform:translateX(20px);background:#fff}
.fb{display:flex;align-items:center;justify-content:space-between}
.hb{width:36px;height:36px;border-radius:8px;background:transparent;border:none;color:var(--t2);display:flex;align-items:center;justify-content:center;transition:.2s}
.hb:hover{background:var(--sf);color:var(--tx)}
.hb svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2}
.ci .chat-img{max-width:100%;border-radius:8px;margin-top:4px}
.pb{width:100%;height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden;margin-top:4px}.pf{height:100%;background:var(--p);transition:width .2s}
.sp{width:40px;height:40px;border:3px solid var(--sf);border-top-color:var(--p);border-radius:50%;animation:sp .8s linear infinite;margin:20px auto}
@keyframes sp{to{transform:rotate(360deg)}}
.call-m{position:fixed;inset:0;background:rgba(10,10,26,.9);backdrop-filter:blur(10px);z-index:2000;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff}
.call-av{width:80px;height:80px;border-radius:50%;background:var(--cd);border:2px solid var(--p);font-size:40px;display:flex;align-items:center;justify-content:center;margin-bottom:20px;animation:pg 2s infinite}
@keyframes pg{0%,100%{box-shadow:0 0 10px rgba(0,212,255,.2)}50%{box-shadow:0 0 30px rgba(0,212,255,.6),0 0 0 15px rgba(0,212,255,0)}}
.call-n{font-size:1.5rem;font-weight:bold;margin-bottom:8px}.call-s{color:var(--tm);margin-bottom:40px}
.call-a{display:flex;gap:40px}
.bc{width:64px;height:64px;border-radius:50%;border:none;font-size:24px;display:flex;align-items:center;justify-content:center;color:#fff;transition:.2s}
.bc.ok{background:var(--ok);box-shadow:0 4px 15px rgba(0,255,136,.3)}.bc.no{background:var(--er);box-shadow:0 4px 15px rgba(255,68,68,.3)}
.cbar{position:fixed;top:var(--hh);left:0;right:0;background:rgba(10,10,26,.95);border-bottom:1px solid var(--bd);padding:8px 16px;display:flex;align-items:center;gap:12px;z-index:99}
.ecb{background:var(--er);color:#fff;border:none;padding:4px 12px;border-radius:12px;font-size:.75rem;margin-left:auto}
@media(min-width:768px){body{background:#020205}.app{max-width:800px;margin:0 auto;border-left:1px solid var(--bd);border-right:1px solid var(--bd);box-shadow:0 0 40px rgba(0,0,0,.3);min-height:100vh;background:var(--bg)}nav.bn{max-width:800px;left:50%;transform:translateX(-50%);border-radius:20px 20px 0 0}}
@media(min-width:1200px){.app{max-width:1000px}nav.bn{max-width:1000px}}
`;

// ═══ EMBEDDED CLIENT JS ═══
const CLIENT_JS = `
(function(){
var db,ws,profile,roomId,roomName,members={},msgs=[],typing={},callPeer=null,callPC=null,localStream=null,recorder=null,recChunks=[];
var audioCtx;

// ── DB ──
function openDB(){return new Promise(function(res){var r=indexedDB.open("ConnectDB",1);r.onupgradeneeded=function(e){var d=e.target.result;if(!d.objectStoreNames.contains("messages")){var s=d.createObjectStore("messages",{keyPath:"msgId"});s.createIndex("roomId","roomId")}};r.onsuccess=function(e){db=e.target.result;res(db)};r.onerror=function(){res(null)}})}
function saveMsg(rid,m){if(!db)return;var tx=db.transaction("messages","readwrite");tx.objectStore("messages").put(Object.assign({},m,{roomId:rid}))}
function loadMsgs(rid){return new Promise(function(res){if(!db)return res([]);var tx=db.transaction("messages","readonly");var idx=tx.objectStore("messages").index("roomId");var arr=[];var c=idx.openCursor(IDBKeyRange.only(rid));c.onsuccess=function(e){var cur=e.target.result;if(cur){arr.push(cur.value);cur.continue()}else{res(arr.sort(function(a,b){return(a.timestamp||0)-(b.timestamp||0)}))}};c.onerror=function(){res([])}})}

// ── PROFILE ──
function loadProfile(){try{return JSON.parse(localStorage.getItem("c_profile"))}catch(e){return null}}
function saveProfile(p){localStorage.setItem("c_profile",JSON.stringify(p));profile=p}

// ── AUDIO ──
function getAC(){if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==="suspended")audioCtx.resume();return audioCtx}
function beep(f,d,v){try{var c=getAC(),o=c.createOscillator(),g=c.createGain();o.frequency.value=f;g.gain.value=v||0.1;g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+d);o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+d)}catch(e){}}
function sndRecv(){beep(880,0.08,0.1);beep(1100,0.12,0.08);if(navigator.vibrate)navigator.vibrate(50)}
function sndSent(){beep(800,0.06,0.06)}
function sndConn(){beep(523,0.06,0.1);setTimeout(function(){beep(784,0.08,0.1)},60)}

// ── SOCKET ──
var reconAttempts=0,maxRecon=5,reconTimer=null;
function wsConnect(url){return new Promise(function(resolve,reject){var wurl=url.trim().replace(/\\/+$/,"");if(!/^wss?:\\/\\//.test(wurl))wurl=wurl.replace(/^https?/,function(m){return m==="https"?"wss":"ws"});if(!/^wss?:\\/\\//.test(wurl))wurl="ws://"+wurl;ws=new WebSocket(wurl);var to=setTimeout(function(){reject(new Error("Cannot reach server"));try{ws.close()}catch(e){}},10000);ws.onopen=function(){reconAttempts=0;ws.send(JSON.stringify({type:"register",payload:profile}))};ws.onmessage=function(ev){try{var m=JSON.parse(ev.data);if(m.type==="registered"){clearTimeout(to);resolve(m.payload);updStatus("on","Connected");sndConn()}handleWS(m)}catch(e){}};ws.onclose=function(ev){updStatus("off","Disconnected");if(reconAttempts<maxRecon){reconAttempts++;updStatus("aw","Reconnecting ("+reconAttempts+"/"+maxRecon+")...");reconTimer=setTimeout(function(){wsConnect(url).catch(function(){})},2000*reconAttempts)}};ws.onerror=function(){clearTimeout(to);if(!ws||ws.readyState!==1)reject(new Error("Connection failed"))}})}
function wsSend(type,payload){if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:type,payload:payload}))}

// ── WS HANDLER ──
function handleWS(m){var p=m.payload||{};
if(m.type==="chat-message"){if(p.senderId===profile.id){var pend=msgs.find(function(x){return x.status==="sending"&&x.text===p.text&&Math.abs(x.timestamp-p.timestamp)<15000});if(pend){pend.msgId=p.msgId;pend.status="sent";saveMsg(roomId,pend);updMsgSt(pend);setTimeout(function(){pend.status="delivered";updMsgSt(pend)},1500)}return}if(msgs.find(function(x){return x.msgId===p.msgId}))return;var nm=Object.assign({},p,{status:"received"});msgs.push(nm);saveMsg(roomId,nm);appendMsg(nm);sndRecv()}
if(m.type==="room-joined"){roomId=p.roomId;roomName=p.roomName;members={};(p.members||[]).forEach(function(x){members[x.id]=x});loadMsgs(p.roomId).then(function(local){var srvMsgs=(p.history||[]).map(function(x){return Object.assign({},x,{status:"received"})});var map={};local.forEach(function(x){if(x.msgId)map[x.msgId]=x});srvMsgs.forEach(function(x){if(x.msgId)map[x.msgId]=x});msgs=Object.keys(map).map(function(k){return map[k]}).sort(function(a,b){return(a.timestamp||0)-(b.timestamp||0)});navigate("cht");renderMsgs();el("crn").textContent=p.roomName;el("cmc").textContent=p.memberCount||Object.keys(members).length;localStorage.setItem("c_lastRoom",p.roomId)})}
if(m.type==="room-created"){toast("Room created!","ok")}
if(m.type==="rooms-list"&&window._roomsCb){window._roomsCb(p.rooms||[]);window._roomsCb=null}
if(m.type==="member-joined"&&p.clientId!==profile.id){members[p.clientId]=p.profile||{};sysmsg("\\u{1F7E2} "+(p.profile&&p.profile.displayName||"Someone")+" joined");el("cmc").textContent=Object.keys(members).length}
if(m.type==="member-left"){delete members[p.clientId];sysmsg("\\u{1F534} "+(p.displayName||"Someone")+" left");el("cmc").textContent=Object.keys(members).length}
if(m.type==="user-typing"&&p.clientId!==profile.id){if(p.isTyping){typing[p.clientId]=p.displayName;clearTimeout(typing["_t"+p.clientId]);typing["_t"+p.clientId]=setTimeout(function(){delete typing[p.clientId];updTyping()},4000)}else{delete typing[p.clientId]}updTyping()}
if(m.type==="webrtc-offer"){el("icm").classList.remove("hidden");el("icn").textContent=p.fromName||"Someone";window._inOffer={fromId:p.fromId,offer:p.offer}}
if(m.type==="webrtc-answer"&&callPC){try{callPC.setRemoteDescription(new RTCSessionDescription(p.answer))}catch(e){}}
if(m.type==="webrtc-ice"&&callPC&&p.candidate){try{callPC.addIceCandidate(new RTCIceCandidate(p.candidate))}catch(e){}}
if(m.type==="webrtc-rejected"){endCall();toast("Call declined","wr")}
if(m.type==="error"){toast(p.message||"Error","er")}
if(m.type==="server-shutdown"){toast("Server shutting down","wr");navigate("hm")}
}

// ── CHAT ──
function sendText(){var inp=el("ci");var t=inp.value.trim();if(!t||!roomId)return;var m={msgId:"p_"+Date.now(),type:"text",senderId:profile.id,senderName:profile.displayName,senderAvatar:profile.avatar,senderColor:profile.avatarColor,text:t.slice(0,5000),timestamp:Date.now(),status:"sending"};msgs.push(m);appendMsg(m);sndSent();wsSend("chat-message",{roomId:roomId,text:t.slice(0,5000)});inp.value="";inp.style.height="auto";el("sendb").disabled=true}
function sysmsg(t){var m={msgId:"s_"+Date.now(),type:"system",text:t,timestamp:Date.now()};msgs.push(m);appendMsg(m)}

// ── WEBRTC ──
function startCall(tid){if(callPeer)return;navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){localStream=stream;callPeer=tid;callPC=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});stream.getTracks().forEach(function(t){callPC.addTrack(t,stream)});callPC.onicecandidate=function(e){if(e.candidate)wsSend("webrtc-ice",{targetId:tid,candidate:e.candidate})};callPC.ontrack=function(e){var a=document.createElement("audio");a.srcObject=e.streams[0];a.autoplay=true;document.body.appendChild(a)};callPC.onconnectionstatechange=function(){if(callPC&&(callPC.connectionState==="disconnected"||callPC.connectionState==="failed"))endCall()};callPC.createOffer().then(function(o){return callPC.setLocalDescription(o)}).then(function(){wsSend("webrtc-offer",{targetId:tid,offer:callPC.localDescription});el("acb").classList.remove("hidden");toast("Calling...","ok")})}).catch(function(){toast("Microphone access denied","er")})}
function acceptCall(){var o=window._inOffer;if(!o)return;navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){localStream=stream;callPeer=o.fromId;callPC=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});stream.getTracks().forEach(function(t){callPC.addTrack(t,stream)});callPC.onicecandidate=function(e){if(e.candidate)wsSend("webrtc-ice",{targetId:o.fromId,candidate:e.candidate})};callPC.ontrack=function(e){var a=document.createElement("audio");a.srcObject=e.streams[0];a.autoplay=true;document.body.appendChild(a)};callPC.setRemoteDescription(new RTCSessionDescription(o.offer)).then(function(){return callPC.createAnswer()}).then(function(ans){return callPC.setLocalDescription(ans)}).then(function(){wsSend("webrtc-answer",{targetId:o.fromId,answer:callPC.localDescription});el("icm").classList.add("hidden");el("acb").classList.remove("hidden")});window._inOffer=null}).catch(function(){toast("Microphone denied","er");rejectCall()})}
function rejectCall(){var o=window._inOffer;if(o)wsSend("webrtc-reject",{targetId:o.fromId});window._inOffer=null;el("icm").classList.add("hidden")}
function endCall(){if(callPC){callPC.close();callPC=null}if(localStream){localStream.getTracks().forEach(function(t){t.stop()});localStream=null}callPeer=null;el("acb").classList.add("hidden");document.querySelectorAll("audio").forEach(function(a){if(a.srcObject)a.remove()})}

// ── UI HELPERS ──
function el(id){return document.getElementById(id)}
function navigate(pg){document.querySelectorAll(".pg").forEach(function(p){p.classList.remove("act")});document.querySelectorAll(".ni").forEach(function(n){n.classList.remove("act")});var p=el(pg);if(p)p.classList.add("act");var n=document.querySelector(".ni[data-t=\\\""+pg+"\\\"]");if(n)n.classList.add("act");var bn=document.querySelector("nav.bn");if(bn)bn.style.display=(pg==="su")?"none":"flex";if(pg==="hm")refreshRooms();if(pg==="pf")renderProfile();if(pg==="st")renderSettings()}
function toast(msg,type){var c=document.querySelector(".tc");if(!c){c=document.createElement("div");c.className="tc";document.body.appendChild(c)}var t=document.createElement("div");t.className="toast "+(type||"");t.innerHTML="<span>"+msg+"</span><button class=tc-x>\\u2715</button>";c.appendChild(t);setTimeout(function(){t.classList.add("show")},10);var close=function(){t.classList.remove("show");setTimeout(function(){t.remove()},350)};t.querySelector(".tc-x").onclick=close;setTimeout(close,4000)}
function updStatus(cls,txt){var d=el("sd");if(d){d.className="dot "+cls}el("stx").textContent=txt}
function fmtTime(ts){return new Date(ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
function fmtSize(b){if(b<1024)return b+" B";if(b<1048576)return(b/1024).toFixed(1)+" KB";return(b/1048576).toFixed(1)+" MB"}

function appendMsg(m){var area=el("cmsgs");if(!area)return;var mine=m.senderId===profile.id;var sys=m.type==="system";var d=document.createElement("div");d.className="cm "+(sys?"sy":(mine?"me":"th"));d.dataset.mid=m.msgId;if(sys){d.innerHTML="<div class=st>"+m.text+"</div>"}else{var st="";if(mine){if(m.status==="sending")st=" \\u23f3";else if(m.status==="sent")st=" \\u2713";else if(m.status==="delivered")st=" \\u2713\\u2713"}var content=m.type==="file"?"\\u{1F4CE} "+(m.fileName||"File")+" ("+fmtSize(m.fileSize||0)+")":m.text.replace(/\\n/g,"<br>");d.innerHTML=(!mine?"<div class=cav style=\\"background:"+(m.senderColor||"#7b2fff")+"\\">"+m.senderAvatar+"</div>":"")+("<div class=\\"cb"+(mine?" me":"")+"\\">"+(!mine?"<div class=cn>"+m.senderName+"</div>":"")+("<div>"+content+"</div>")+("<div class=cmt>"+fmtTime(m.timestamp)+st+"</div>")+"</div>")}area.appendChild(d);area.scrollTop=area.scrollHeight}
function updMsgSt(m){var e=document.querySelector("[data-mid=\\""+m.msgId+"\\"] .cmt");if(e){var st=" \\u2713";if(m.status==="delivered")st=" \\u2713\\u2713";e.innerHTML=fmtTime(m.timestamp)+st}}
function renderMsgs(){var area=el("cmsgs");if(!area)return;area.innerHTML="";if(!msgs.length){area.innerHTML="<div class=es><h3>Say hello!</h3><p>Start the conversation</p></div>";return}msgs.forEach(appendMsg)}
function updTyping(){var ti=el("ti");if(!ti)return;var names=Object.keys(typing).filter(function(k){return k[0]!=="_"}).map(function(k){return typing[k]});if(names.length){ti.textContent=names.join(", ")+" typing...";ti.classList.remove("hidden")}else{ti.classList.add("hidden")}}

function refreshRooms(){var list=el("rlist");if(!list)return;list.innerHTML="<div class=sp></div>";wsSend("list-rooms",{});window._roomsCb=function(rooms){if(!rooms.length){list.innerHTML="<div class=es><h3>No Rooms Yet</h3><p>Create one to start chatting</p></div>";return}list.innerHTML="";rooms.forEach(function(r){var d=document.createElement("div");d.className="nc";d.innerHTML="<div style=\\"flex:1\\"><div class=nm>"+r.name+"</div><div class=mt>"+r.memberCount+" members \\u00b7 Code: "+r.joinCode+(r.isPrivate?" \\u{1F512}":"")+"</div></div><button class=jb>Join</button>";d.onclick=function(){wsSend("join-room",{roomId:r.id})};list.appendChild(d)})};setTimeout(function(){if(window._roomsCb){window._roomsCb([]);window._roomsCb=null}},5000)}

function renderProfile(){var c=el("pfc");if(!c||!profile)return;c.innerHTML="<div style=\\"text-align:center;padding:20px\\"><div class=cav style=\\"width:64px;height:64px;font-size:32px;margin:0 auto 16px;background:"+profile.avatarColor+"\\">"+profile.avatar+"</div><h2 style=\\"margin-bottom:8px\\">"+profile.displayName+"</h2><p class=tmut>"+(profile.statusMessage||"Available")+"</p><button class=\\"btn bs\\" style=\\"margin-top:16px\\" onclick=\\"editProfile()\\">Edit Profile</button></div>"}
function renderSettings(){var snd=el("snd");if(snd)snd.checked=localStorage.getItem("c_snd")!=="false";var vib=el("vib");if(vib)vib.checked=localStorage.getItem("c_vib")!=="false"}

// ── FILE SHARE ──
function sendFile(file){if(!file||!roomId)return;if(file.size>10485760){toast("File too large (10MB max)","er");return}var fr=new FileReader();fr.onload=function(){var data=fr.result.split(",")[1];var fid="f_"+Date.now();var CHUNK=32768;var total=Math.ceil(data.length/CHUNK);wsSend("file-start",{fileId:fid,fileName:file.name,fileSize:file.size,fileType:file.type,totalChunks:total,roomId:roomId});for(var i=0;i<total;i++){wsSend("file-chunk",{fileId:fid,chunkIndex:i,data:data.slice(i*CHUNK,(i+1)*CHUNK)})}wsSend("file-end",{fileId:fid,roomId:roomId});var m={msgId:"sf_"+fid,type:"file",senderId:profile.id,senderName:profile.displayName,senderAvatar:profile.avatar,senderColor:profile.avatarColor,fileName:file.name,fileSize:file.size,timestamp:Date.now(),status:"sent"};msgs.push(m);appendMsg(m);sndSent()};fr.readAsDataURL(file)}

// ── INIT ──
function init(){openDB().then(function(){profile=loadProfile();if(!profile){navigate("su")}else{navigate("hm");var url=localStorage.getItem("c_server")||location.origin;wsConnect(url).catch(function(e){toast(e.message,"er")})}});
// Setup form
var sf=el("sf");if(sf)sf.onsubmit=function(e){e.preventDefault();var dn=el("sn").value.trim();if(!dn)return;profile={id:"u_"+Date.now().toString(36)+Math.random().toString(36).substr(2,6),displayName:dn.slice(0,20),avatar:document.querySelector(".ao.sel")?document.querySelector(".ao.sel").textContent:"\\u{1F60E}",avatarColor:document.querySelector(".co.sel")?document.querySelector(".co.sel").dataset.c:"#00d4ff",statusMessage:el("ss")?el("ss").value:"",status:"online"};saveProfile(profile);var url=el("sv").value.trim()||location.origin;localStorage.setItem("c_server",url);navigate("hm");wsConnect(url).catch(function(e){toast(e.message,"er")})};
// Avatar/color pickers
document.querySelectorAll(".ao").forEach(function(a){a.onclick=function(){document.querySelectorAll(".ao").forEach(function(x){x.classList.remove("sel")});a.classList.add("sel")}});
document.querySelectorAll(".co").forEach(function(c){c.onclick=function(){document.querySelectorAll(".co").forEach(function(x){x.classList.remove("sel")});c.classList.add("sel")}});
// Nav
document.querySelectorAll(".ni").forEach(function(n){n.onclick=function(){var t=n.dataset.t;if(t==="cht"&&!roomId){toast("Join a room first","wr");return}navigate(t)}});
// Chat input
var ci=el("ci");if(ci){ci.oninput=function(){ci.style.height="auto";ci.style.height=Math.min(ci.scrollHeight,120)+"px";el("sendb").disabled=!ci.value.trim();if(roomId)wsSend("typing",{roomId:roomId,isTyping:true})};ci.onkeydown=function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendText()}}}
el("sendb").onclick=sendText;
el("crb").onclick=function(){var name=prompt("Enter room name:");if(name){wsSend("create-room",{roomName:name})}};
// File
el("atb").onclick=function(){el("fi").click()};
el("fi").onchange=function(){if(el("fi").files[0])sendFile(el("fi").files[0]);el("fi").value=""};
// Emoji
el("emb").onclick=function(){var pk=el("epk");if(pk){pk.remove();return}pk=document.createElement("div");pk.id="epk";pk.className="gc";pk.style.cssText="position:absolute;bottom:80px;left:16px;right:16px;z-index:1000;max-height:200px;overflow-y:auto";var emojis=["\\u{1F600}","\\u{1F602}","\\u{1F60D}","\\u{1F60E}","\\u{1F62D}","\\u{1F621}","\\u{1F914}","\\u{1F44D}","\\u{1F44E}","\\u{1F44B}","\\u{1F64F}","\\u{1F4AA}","\\u{1F525}","\\u{1F389}","\\u{1F680}","\\u2B50","\\u26A1","\\u2764\\uFE0F","\\u{1F4AF}","\\u{1F3AF}"];pk.innerHTML=emojis.map(function(e){return"<button style=\\"background:none;border:none;font-size:24px;padding:6px;cursor:pointer\\" class=ebtn>"+e+"</button>"}).join("");pk.onclick=function(ev){if(ev.target.classList.contains("ebtn")){ci.value+=ev.target.textContent;ci.focus();el("sendb").disabled=false}};document.querySelector("main").appendChild(pk);setTimeout(function(){document.addEventListener("click",function rm(ev){if(!pk.contains(ev.target)&&ev.target.id!=="emb"){pk.remove();document.removeEventListener("click",rm)}})},10)};
// WebRTC buttons
el("acpt").onclick=acceptCall;
el("decl").onclick=rejectCall;
el("ecb").onclick=endCall;
// Back button
el("bkb").onclick=function(){wsSend("leave-room",{roomId:roomId});roomId=null;roomName=null;msgs=[];members={};navigate("hm")};
// Location
el("locb").onclick=function(){if(!navigator.geolocation){toast("GPS not supported","er");return}navigator.geolocation.getCurrentPosition(function(p){wsSend("chat-message",{roomId:roomId,text:"\\u{1F4CD} Location: "+p.coords.latitude.toFixed(5)+", "+p.coords.longitude.toFixed(5)});toast("Location shared","ok")},function(){toast("Location access denied","er")})};
// Mic (voice recording)
var micBtn=el("micb");if(micBtn){var isRec=false;micBtn.onmousedown=micBtn.ontouchstart=function(e){e.preventDefault();navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){var mt=MediaRecorder.isTypeSupported("audio/webm;codecs=opus")?"audio/webm;codecs=opus":"audio/webm";recorder=new MediaRecorder(stream,{mimeType:mt});recChunks=[];recorder.ondataavailable=function(ev){if(ev.data.size>0)recChunks.push(ev.data)};recorder.onstop=function(){stream.getTracks().forEach(function(t){t.stop()});var blob=new Blob(recChunks,{type:mt});var fr2=new FileReader();fr2.onload=function(){wsSend("chat-message",{roomId:roomId,text:"\\u{1F3A4} Voice message"});toast("Voice sent","ok")};fr2.readAsDataURL(blob);isRec=false};recorder.start(100);isRec=true;toast("Recording...","ok")}).catch(function(){toast("Microphone denied","er")})};document.addEventListener("mouseup",function(){if(isRec&&recorder){recorder.stop();isRec=false}});document.addEventListener("touchend",function(){if(isRec&&recorder){recorder.stop();isRec=false}})}
// Settings toggles
var sndT=el("snd");if(sndT)sndT.onchange=function(){localStorage.setItem("c_snd",sndT.checked)};
var vibT=el("vib");if(vibT)vibT.onchange=function(){localStorage.setItem("c_vib",vibT.checked)};
// Header status click
el("hst").onclick=function(){var info="Server: "+(localStorage.getItem("c_server")||"N/A")+"\\nStatus: "+(ws&&ws.readyState===1?"Connected":"Disconnected");alert(info)};
}
window.editProfile=function(){navigate("su")};
document.addEventListener("DOMContentLoaded",init);
})();
`;

// ═══ EMBEDDED HTML ═══
const HTML = `<!DOCTYPE html><html lang=en data-theme=dark><head>
<meta charset=UTF-8><meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>Connect</title><meta name=theme-color content=#0a0a1a><meta name=apple-mobile-web-app-capable content=yes>
<link rel=manifest href=/manifest.json><style>${CSS}</style></head><body>
<div class=app>
<div id=acb class="cbar hidden"><span>📞 Call Active</span><span id=ctmr>00:00</span><button id=ecb class=ecb>End</button></div>
<header><div class=hst id=hst><span class="dot off" id=sd></span><span id=stx>Disconnected</span></div><div class=logo>Connect</div><div style="width:36px"></div></header>
<main>
<section id=su class=pg>
<div style="text-align:center;margin-bottom:24px"><h2 style="font-size:1.5rem;font-weight:700">Set up Connect</h2><p class="tmut tsm" style="margin-top:8px">Create your local profile</p></div>
<form id=sf><div class=fg><label>Avatar</label><div class=ag>
<div class="ao sel">😎</div><div class=ao>🚀</div><div class=ao>🦊</div><div class=ao>🐱</div><div class=ao>🦁</div><div class=ao>🐼</div><div class=ao>🦄</div><div class=ao>🐉</div><div class=ao>🎮</div><div class=ao>🎯</div><div class=ao>⚡</div><div class=ao>🔥</div>
</div></div>
<div class=fg><label>Color</label><div class=cg>
<div class="co sel" data-c=#00d4ff style=background:#00d4ff></div><div class=co data-c=#7b2fff style=background:#7b2fff></div><div class=co data-c=#ff6b35 style=background:#ff6b35></div><div class=co data-c=#00ff88 style=background:#00ff88></div><div class=co data-c=#ff4488 style=background:#ff4488></div><div class=co data-c=#ffcc00 style=background:#ffcc00></div>
</div></div>
<div class=fg><label for=sn>Display Name</label><input type=text id=sn required placeholder="Your Name" maxlength=20></div>
<div class=fg><label for=ss>Status (optional)</label><input type=text id=ss placeholder="What's up?" maxlength=100></div>
<div class=fg><label for=sv>Server Address</label><input type=text id=sv required placeholder="http://192.168.1.5:3000"><p class="tsm tmut" style="margin-top:8px">Enter the address shown in the host terminal</p></div>
<button type=submit class="btn bp" style="width:100%;margin-top:16px">Get Started →</button></form></section>

<section id=hm class="pg act">
<div class=fb style="margin-bottom:24px"><h2 style="font-size:1.5rem">Rooms</h2><button id=crb class="btn bp" style="padding:8px 16px;font-size:.8125rem">+ Create Room</button></div>
<div id=rlist></div></section>

<section id=cht class=pg style=padding:0>
<div class=chd><button class=hb id=bkb><svg viewBox="0 0 24 24"><line x1=19 y1=12 x2=5 y2=12/><polyline points="12 19 5 12 12 5"/></svg></button>
<div style="flex:1;overflow:hidden"><div id=crn style="font-weight:600;font-size:1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Room</div><div style="font-size:.75rem;color:var(--tm)"><span id=cmc>1</span> members</div></div>
<button class=hb id=locb><svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx=12 cy=10 r=3/></svg></button></div>
<div class=cml id=cmsgs></div>
<div class=cia><input type=file id=fi style=display:none><button class=ib id=atb>📎</button>
<div class=ciw><textarea id=ci placeholder="Type a message..." rows=1></textarea><button class=ib id=emb>😊</button><button class=ib id=micb>🎤</button><div id=ti class=hidden></div></div>
<button class=sb id=sendb disabled><svg width=20 height=20 viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2><line x1=22 y1=2 x2=11 y2=13/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button></div></section>

<section id=pf class=pg><div id=pfc></div></section>

<section id=st class=pg>
<h2 style="font-size:1.5rem;margin-bottom:20px">Settings</h2>
<div class=gc style=margin-bottom:16px><h4 style="margin-bottom:12px;color:var(--t2)">Sound & Haptics</h4>
<div class=fb style=margin-bottom:16px><span>Sounds</span><label class=tg><input type=checkbox id=snd checked><span class=tt></span></label></div>
<div class=fb><span>Vibration</span><label class=tg><input type=checkbox id=vib checked><span class=tt></span></label></div></div>
<div class=gc><h4 style="margin-bottom:12px;color:var(--t2)">Connection</h4>
<div class=fb><span>Server</span><span class=tmut id=srv></span></div>
<button class="btn bs" style="width:100%;margin-top:16px" onclick="localStorage.clear();location.reload()">Disconnect & Reset</button></div></section>
</main>

<nav class=bn>
<button class="ni act" data-t=hm><svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg><span>Home</span></button>
<button class=ni data-t=cht><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>Chat</span></button>
<button class=ni data-t=pf><svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx=12 cy=7 r=4/></svg><span>Profile</span></button>
<button class=ni data-t=st><svg viewBox="0 0 24 24"><circle cx=12 cy=12 r=3/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg><span>Settings</span></button>
</nav>

<div id=icm class="call-m hidden"><div class=call-av>📞</div><div class=call-n id=icn>Caller</div><div class=call-s>Incoming voice call...</div><div class=call-a><button id=decl class="bc no">✕</button><button id=acpt class="bc ok">📞</button></div></div>
</div>
<script>${CLIENT_JS}</script>
<script>var si=document.getElementById("sv");if(si&&!si.value)si.value=location.origin;var sr=document.getElementById("srv");if(sr)sr.textContent=localStorage.getItem("c_server")||location.origin;</script>
</body></html>`;

// ═══ MANIFEST ═══
const MANIFEST = JSON.stringify({name:"Connect Local Chat",short_name:"Connect",start_url:"/",display:"standalone",background_color:"#0a0a1a",theme_color:"#0a0a1a",icons:[{src:"/icon.svg",sizes:"any",type:"image/svg+xml",purpose:"any maskable"}]});

// ═══ SERVICE WORKER ═══
const SW = `self.addEventListener("install",function(){self.skipWaiting()});self.addEventListener("activate",function(e){e.waitUntil(self.clients.claim())});self.addEventListener("fetch",function(e){e.respondWith(fetch(e.request).catch(function(){return caches.match(e.request)}))});`;

// ═══ SVG ICON ═══
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="100" fill="#0a0a1a"/><circle cx="256" cy="200" r="80" fill="none" stroke="#00d4ff" stroke-width="12"/><path d="M160 380c0-53 43-96 96-96s96 43 96 96" fill="none" stroke="#00d4ff" stroke-width="12" stroke-linecap="round"/><circle cx="256" cy="200" r="30" fill="#7b2fff"/><path d="M200 420h112" stroke="#00d4ff" stroke-width="8" stroke-linecap="round"/></svg>`;

// ═══ HTTP + WS SERVER ═══
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') { res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(HTML); }
  else if (url === '/manifest.json') { res.writeHead(200, {'Content-Type':'application/manifest+json'}); res.end(MANIFEST); }
  else if (url === '/service-worker.js' || url === '/sw.js') { res.writeHead(200, {'Content-Type':'application/javascript'}); res.end(SW); }
  else if (url === '/icon.svg') { res.writeHead(200, {'Content-Type':'image/svg+xml'}); res.end(ICON); }
  else { res.writeHead(404); res.end('Not Found'); }
});

const wss = new WebSocket.Server({ server });
let clientId = 0;

wss.on('connection', (socket) => {
  const id = 'c' + (++clientId);
  const client = { id, ws: socket, profile: null, roomId: null };
  clients.set(id, client);

  socket.on('message', (raw) => {
    try {
      const { type, payload } = JSON.parse(raw);
      
      if (type === 'register') {
        client.profile = { ...payload, id };
        socket.send(JSON.stringify({ type: 'registered', payload: { clientId: id } }));
      }

      if (type === 'create-room') {
        const rid = 'r_' + Date.now().toString(36);
        const code = Math.random().toString(36).substr(2,6).toUpperCase();
        rooms.set(rid, { id: rid, name: payload.roomName || 'Room', joinCode: code, members: new Map(), messages: [], createdAt: Date.now(), isPrivate: !!payload.isPrivate });
        socket.send(JSON.stringify({ type: 'room-created', payload: { roomId: rid, joinCode: code } }));
        // Auto-join creator
        handleJoin(client, rid);
      }

      if (type === 'join-room') {
        const rid = payload.roomId;
        // Try by ID first, then by join code
        let room = rooms.get(rid);
        if (!room) {
          for (const [k, r] of rooms) { if (r.joinCode === rid) { room = r; break; } }
        }
        if (!room) { socket.send(JSON.stringify({ type: 'error', payload: { message: 'Room not found' } })); return; }
        handleJoin(client, room.id);
      }

      if (type === 'leave-room') {
        handleLeave(client);
      }

      if (type === 'list-rooms') {
        const list = [];
        rooms.forEach((r) => {
          list.push({ id: r.id, name: r.name, joinCode: r.joinCode, memberCount: r.members.size, isPrivate: r.isPrivate });
        });
        socket.send(JSON.stringify({ type: 'rooms-list', payload: { rooms: list } }));
      }

      if (type === 'chat-message') {
        const room = rooms.get(client.roomId);
        if (!room) return;
        const msg = { msgId: 'm_' + Date.now() + '_' + id, type: payload.messageType || 'text', text: payload.text || '', senderId: id, senderName: client.profile?.displayName || 'Anon', senderAvatar: client.profile?.avatar || '😎', senderColor: client.profile?.avatarColor || '#00d4ff', timestamp: Date.now(), replyTo: payload.replyTo || null };
        room.messages.push(msg);
        if (room.messages.length > MAX_MSG) room.messages = room.messages.slice(-MAX_MSG);
        broadcast(room, msg.type === 'text' ? 'chat-message' : 'chat-message', msg);
      }

      if (type === 'typing') {
        const room = rooms.get(client.roomId);
        if (!room) return;
        broadcastExcept(room, id, 'user-typing', { clientId: id, displayName: client.profile?.displayName, isTyping: payload.isTyping });
      }

      // File transfer relay
      if (type === 'file-start' || type === 'file-chunk' || type === 'file-end') {
        const room = rooms.get(client.roomId);
        if (!room) return;
        broadcastExcept(room, id, type === 'file-end' ? 'file-complete' : type === 'file-start' ? 'file-incoming' : 'file-chunk', { ...payload, senderId: id, senderName: client.profile?.displayName, senderAvatar: client.profile?.avatar, senderColor: client.profile?.avatarColor });
      }

      // WebRTC signaling relay
      if (type === 'webrtc-offer' || type === 'webrtc-answer' || type === 'webrtc-ice' || type === 'webrtc-reject') {
        const target = clients.get(payload.targetId);
        if (target && target.ws.readyState === WebSocket.OPEN) {
          target.ws.send(JSON.stringify({ type, payload: { ...payload, fromId: id, fromName: client.profile?.displayName } }));
        }
      }

      if (type === 'ping') { socket.send(JSON.stringify({ type: 'pong' })); }

    } catch (e) { /* ignore parse errors */ }
  });

  socket.on('close', () => {
    handleLeave(client);
    clients.delete(id);
  });
});

function handleJoin(client, rid) {
  const room = rooms.get(rid);
  if (!room) return;
  // Leave previous room
  if (client.roomId && client.roomId !== rid) handleLeave(client);
  client.roomId = rid;
  room.members.set(client.id, { id: client.id, ...(client.profile || {}) });
  // Send room data to joiner
  const memberList = [];
  room.members.forEach(m => memberList.push(m));
  client.ws.send(JSON.stringify({ type: 'room-joined', payload: { roomId: rid, roomName: room.name, joinCode: room.joinCode, memberCount: room.members.size, members: memberList, history: room.messages.slice(-50) } }));
  // Notify others
  broadcastExcept(room, client.id, 'member-joined', { clientId: client.id, profile: client.profile });
}

function handleLeave(client) {
  if (!client.roomId) return;
  const room = rooms.get(client.roomId);
  if (room) {
    room.members.delete(client.id);
    broadcastExcept(room, client.id, 'member-left', { clientId: client.id, displayName: client.profile?.displayName });
    if (room.members.size === 0 && Date.now() - room.createdAt > 3600000) rooms.delete(room.id);
  }
  client.roomId = null;
}

function broadcast(room, type, payload) {
  const msg = JSON.stringify({ type, payload });
  room.members.forEach((_, cid) => {
    const c = clients.get(cid);
    if (c && c.ws.readyState === WebSocket.OPEN) c.ws.send(msg);
  });
}

function broadcastExcept(room, exceptId, type, payload) {
  const msg = JSON.stringify({ type, payload });
  room.members.forEach((_, cid) => {
    if (cid === exceptId) return;
    const c = clients.get(cid);
    if (c && c.ws.readyState === WebSocket.OPEN) c.ws.send(msg);
  });
}

// ═══ STARTUP ═══
(async () => {
  const port = await findPort(PORT);
  const ip = getLocalIP();
  const url = `http://${ip}:${port}`;

  server.listen(port, '0.0.0.0', () => {
    console.clear();
    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║         🔗 CONNECT - Running!            ║');
    console.log('  ╠══════════════════════════════════════════╣');
    console.log(`  ║  Local:   http://localhost:${port}           ║`);
    console.log(`  ║  Network: ${url.padEnd(30)}║`);
    console.log('  ╠══════════════════════════════════════════╣');
    console.log('  ║  Scan QR code below to connect:         ║');
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');
    
    qrcode.generate(url, { small: true }, (qr) => {
      console.log(qr);
      console.log('');
      console.log('  📱 Other devices: Open browser → type the Network URL');
      console.log('  ⛔ Press Ctrl+C to stop the server');
      console.log('');
    });

    // Auto open browser on host
    setTimeout(() => openBrowser(`http://localhost:${port}`), 500);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n  👋 Shutting down...');
    broadcast({ members: clients }, 'server-shutdown', {});
    wss.close();
    server.close();
    process.exit(0);
  });
})();
