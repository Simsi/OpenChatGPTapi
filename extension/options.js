// options.js v0.3.4
(async function(){
  const {wsUrl, debug} = await chrome.storage.local.get(['wsUrl','debug']);
  document.getElementById('wsUrl').value = wsUrl || 'ws://127.0.0.1:11435/bridge';
  document.getElementById('debug').checked = (typeof debug==='boolean') ? debug : true;
  document.getElementById('save').onclick = async () => {
    const v = document.getElementById('wsUrl').value.trim();
    const d = !!document.getElementById('debug').checked;
    await chrome.storage.local.set({wsUrl: v, debug: d});
    await chrome.runtime.sendMessage({type:'SET_DEBUG', value: d});
    document.getElementById('status').textContent = 'Сохранено';
  };
})();
