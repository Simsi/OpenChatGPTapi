
// background.js v0.3.4 — WS status, keepalive, auto-inject content script
const DEF_WS_URL = 'ws://127.0.0.1:11435/bridge';
let ws = null;
let wsUrl = DEF_WS_URL;
let jobQueue = [];
let currentJob = null;
let DEBUG = true;

let wsConnected = false;
let reconnectTimer = null;

function L(...a){ if (DEBUG) console.log('[BG]', ...a); }
function setBadge(ok){ chrome.action.setBadgeText({text: ok ? 'ON' : 'OFF'}); chrome.action.setBadgeBackgroundColor({color: ok ? '#2ecc71' : '#e74c3c'}); }

chrome.runtime.onInstalled.addListener(()=> chrome.storage.local.set({ wsUrl: DEF_WS_URL, debug: true }));
chrome.runtime.onStartup.addListener(()=> ensureWS());

async function getChatTab() {
  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*","https://chat.openai.com/*"] });
  return tabs[0] || null;
}

function scheduleReconnect(){
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(ensureWS, 1200);
}

function ensureWS(){
  try { ws?.close(); } catch {}
  ws = new WebSocket(wsUrl);
  ws.onopen = () => { wsConnected = true; setBadge(true); L('WS connected', wsUrl); send({type:'hello', from:'extension', version:'0.3.4'}); };
  ws.onclose = () => { wsConnected = false; setBadge(false); L('WS closed'); scheduleReconnect(); };
  ws.onerror = (e) => { L('WS error', e?.message || e); };
  ws.onmessage = (ev) => { try {
      const msg = JSON.parse(ev.data);
      L('WS <-', msg.type);
      handleWsMessage(msg);
    } catch(e) { console.error('WS bad msg', e); } };
}

function send(obj){ try { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); } catch {} }

async function handleWsMessage(msg){
  if (msg.type === 'ping') { send({type:'pong'}); return; }
  if (msg.type === 'configure' && msg.wsUrl) { wsUrl = msg.wsUrl; chrome.storage.local.set({wsUrl}); ensureWS(); return; }
  if (msg.type === 'job') { jobQueue.push(msg); processQueue(); }
}

async function processQueue(){
  if (currentJob || jobQueue.length===0) return;
  currentJob = jobQueue.shift();
  const job = currentJob;
  const tab = await getChatTab();
  if (!tab){
    send({type:'jobError', id: job.id, error:'NO_CHAT_TAB'});
    currentJob = null; processQueue(); return;
  }
  try {
    await ensureContentInjected(tab.id);
    await chrome.tabs.sendMessage(tab.id, {type:'SEND_PROMPT', id: job.id, prompt: job.prompt, stream: !!job.stream, timeoutMs: job.timeoutMs || 180000});
    send({type:'jobStarted', id: job.id, tabId: tab.id});
  } catch (e) {
    send({type:'jobError', id: job.id, error:'INJECTION_FAILED', detail: String(e?.message||e)});
    currentJob = null; processQueue();
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || !message.type) return;
  if (message.type === 'DELTA') send({type:'delta', id: message.id, delta: message.delta});
  if (message.type === 'DONE')  { send({type:'done', id: message.id, text: message.text}); currentJob = null; processQueue(); }
  if (message.type === 'ERROR') { send({type:'jobError', id: message.id, error: message.error||'UNKNOWN'}); currentJob = null; processQueue(); }

  if (message.type === 'GET_STATUS') { getStatus().then(s => respond(s)); return true; }
  if (message.type === 'TEST_PROMPT') {
    runTestPrompt(message.prompt || "Проверка моста: ответь 'OK' одним словом.")
      .then(ok => respond({ok:true, detail: ok}))
      .catch(err => respond({ok:false, error: String(err?.message||err)}));
    return true;
  }
  if (message.type === 'OPEN_CHAT') { chrome.tabs.create({ url: "https://chatgpt.com/" }); respond({ok:true}); }
  if (message.type === 'INJECT') {
    getChatTab().then(tab => tab ? ensureContentInjected(tab.id) : Promise.reject(new Error('Нет вкладки ChatGPT')))
      .then(()=>respond({ok:true})).catch(e=>respond({ok:false, error:String(e)}));
    return true;
  }
  if (message.type === 'SET_DEBUG') { DEBUG = !!message.value; respond({ok:true}); }
});

async function pingContent(tabId){
  try {
    const r = await chrome.tabs.sendMessage(tabId, {type:'PING_CT'});
    return !!r && !!r.ok;
  } catch { return false; }
}

async function ensureContentInjected(tabId){
  const alive = await pingContent(tabId);
  if (alive) return true;
  L('Injecting content.js into tab', tabId);
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  // wait a bit and ping again
  await new Promise(r=>setTimeout(r, 200));
  const alive2 = await pingContent(tabId);
  if (!alive2) throw new Error('CONTENT_NOT_INJECTED');
  return true;
}

async function getStatus(){
  const tab = await getChatTab();
  const contentOk = tab ? await pingContent(tab.id) : false;
  return { wsUrl, wsConnected, chatTabOpen: !!tab, contentScriptAlive: contentOk };
}

async function runTestPrompt(prompt){
  const tab = await getChatTab();
  if (!tab) throw new Error('Нет открытой вкладки ChatGPT');
  await ensureContentInjected(tab.id);
  const r = await chrome.tabs.sendMessage(tab.id, {type:'TEST_PROMPT', prompt});
  if (!r || !r.ok) throw new Error(r && r.error || 'TEST_PROMPT failed');
  return true;
}

// Keepalive
chrome.alarms.create('keepalive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a)=>{ if (a.name === 'keepalive') ensureWS(); });

chrome.storage.local.get(['wsUrl','debug']).then(({wsUrl: saved, debug}) => {
  if (saved) wsUrl = saved;
  if (typeof debug==='boolean') DEBUG = debug;
  ensureWS();
});
