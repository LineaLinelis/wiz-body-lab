import { BodyLab } from './model.js';
const lab = new BodyLab();
const $ = id => document.getElementById(id);
function render() {
  const c=lab.controller,s=c.state();
  $('mode').textContent=s.mode; $('phase').textContent=c.phase;
  $('connection').textContent=`${c.connected?'connected':'disconnected'} / ${c.obstacle?'obstacle present':'clear'}`;
  $('generation').textContent=s.generation; $('saved-generation').textContent=lab.saved?.generation ?? '未保存';
  $('replay').disabled=!lab.saved;
  $('caps').replaceChildren(...c.capabilities().map(cap=>{const e=document.createElement('span');e.textContent=cap;return e;}));
  document.body.classList.toggle('running',c.phase==='running' && s.mode==='ready');
  document.body.classList.toggle('latched',s.mode!=='ready');document.body.classList.toggle('obstacle',c.obstacle);
  $('obstacle').textContent=c.obstacle?'Obstacleを除去':'Obstacleを置く';
  $('disconnect').textContent=c.connected?'Disconnect':'Reconnect';
  const statuses=new Map();for(const e of [...lab.history].reverse()) if(e.kind==='result')statuses.set(e.value.commandId,e.value.status);
  $('lifecycle').replaceChildren(...[...statuses].map(([id,status])=>{const e=document.createElement('span');e.textContent=`${id}: ${status}`;return e;}));
  $('history').replaceChildren(...lab.history.map(e=>{const row=document.createElement('div');row.className=`event ${e.kind}`;const title=document.createElement('strong');title.textContent=`${e.time.slice(11,23)} · ${e.kind}`;const pre=document.createElement('pre');pre.textContent=JSON.stringify(e.value,null,2);row.append(title,pre);return row;}));
}
lab.onChange=render;
document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',async()=>{
  const action=button.dataset.action,c=lab.controller;
  try {
    if(action==='recover') await lab.recover();
    if(action==='wave') await lab.send();
    if(action==='start') c.start();
    if(action==='complete') c.finish();
    if(action==='fail') c.finish(true);
    if(action==='stop'||action==='emergency') await lab.send(lab.command({type:action==='stop'?'stop':'emergency_stop'}));
    if(action==='save') lab.save();
    if(action==='replay'&&lab.saved) await lab.send(structuredClone(lab.saved));
    if(action==='timeout'){c.timeoutNext=true;lab.record('fault',{nextAcceptance:'timeout',note:'次の有効な命令の受理応答を破棄'});}
    if(action==='obstacle'){await c.setObstacle(!c.obstacle);lab.record('sensor',{obstacle:c.obstacle});}
    if(action==='disconnect'){if(c.connected)await c.disconnect();else c.connected=true;lab.record('link',{connected:c.connected,autoRecover:false});}
    const recent=lab.history[0];$('feedback').textContent=recent?JSON.stringify(recent.value):'操作待ち';
  }catch(e){lab.record('error',{message:e.message});$('feedback').textContent=e.message;}
  render();
}));
$('wave-enabled').addEventListener('change',e=>{lab.controller.waveEnabled=e.target.checked;lab.record('capability',{wave:e.target.checked});render();});
render();
