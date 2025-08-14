// popup.js v0.3.4
function log(t){ const el = document.getElementById('log'); el.textContent += t + "\n"; el.scrollTop = el.scrollHeight; }
async function refresh(){
  try {
    const st = await chrome.runtime.sendMessage({type:'GET_STATUS'});
    document.getElementById('wsUrl').textContent = st.wsUrl || '—';
    document.getElementById('ws').textContent = st.wsConnected ? 'Connected' : 'Disconnected';
    document.getElementById('ws').style.color = st.wsConnected ? 'green' : 'red';
    document.getElementById('tab').textContent = st.chatTabOpen ? 'Open' : 'Closed';
    document.getElementById('tab').style.color = st.chatTabOpen ? 'green' : 'red';
    document.getElementById('ct').textContent = st.contentScriptAlive ? 'Alive' : 'No';
    document.getElementById('ct').style.color = st.contentScriptAlive ? 'green' : 'red';
  } catch(e){ log('GET_STATUS error: ' + e); }
  try {
    const r = await fetch('http://127.0.0.1:11434/healthz', {cache:'no-store'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    document.getElementById('health').textContent = j.ok ? ('OK; ext=' + j.extension_connected + '; pending=' + j.pending_jobs) : 'Bad';
    document.getElementById('health').style.color = j.ok ? 'green' : 'red';
  } catch(e){
    document.getElementById('health').textContent = 'OFF';
    document.getElementById('health').style.color = 'red';
    log('healthz error: ' + e);
  }
}
document.getElementById('btnOpen').onclick = async ()=>{ await chrome.runtime.sendMessage({type:'OPEN_CHAT'}); log('Opened ChatGPT'); setTimeout(refresh, 1000); };
document.getElementById('btnInject').onclick = async ()=>{ const r = await chrome.runtime.sendMessage({type:'INJECT'}); log(r && r.ok ? 'Injected' : ('Inject failed: ' + (r && r.error))); setTimeout(refresh, 500); };
document.getElementById('btnTest').onclick = async ()=>{ const r = await chrome.runtime.sendMessage({type:'TEST_PROMPT', prompt: "Проверка моста: ответь 'OK' одним словом."}); log(r && r.ok ? 'Test prompt sent' : ('Test failed: ' + (r && r.error))); };
document.getElementById('btnRefresh').onclick = refresh;
refresh();
