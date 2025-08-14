
// content.js v0.3.8 — clean extraction, auto-retry on error, bugfix in listener
(function(){
  let DEBUG = true;
  const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));
  function L(...a){ if (DEBUG) console.log('[CT]', ...a); }

  function isVisible(el){
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (el.offsetParent === null && style.position !== 'fixed') return false;
    return true;
  }

  function findComposer(){
    const sels = [
      'textarea[data-testid="prompt-textarea"]:not([disabled])',
      'textarea[placeholder*="Message"]:not([disabled])',
      'textarea[placeholder*="Отправьте"]:not([disabled])',
      'textarea:not([disabled])',
      'div[contenteditable="true"][data-testid*="prompt"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]'
    ];
    for (const sel of sels){
      const el = document.querySelector(sel);
      if (el && isVisible(el)) {
        const type = el.tagName.toLowerCase() === 'textarea' ? 'textarea' : 'contenteditable';
        return { el, type };
      }
    }
    return { el: null, type: null };
  }
  function getComposerText(el, type){ return !el ? '' : (type==='textarea' ? (el.value||'') : (el.innerText||el.textContent||'')).trim(); }

  function findSendButton(){
    const btn = document.querySelector('button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="Отправить"]');
    return btn || null;
  }
  function sendButtonEnabled(btn){ return !!btn && !btn.disabled && (btn.getAttribute('aria-disabled') !== 'true'); }

  function dispatchInput(el, data, inputType){
    try { el.dispatchEvent(new InputEvent('input', {bubbles:true, data, inputType: inputType||'insertFromPaste'})); } catch {}
    el.dispatchEvent(new Event('change', {bubbles:true}));
  }

  async function setComposerValue(el, type, value){
    if (!el) throw new Error('COMPOSER_NOT_FOUND');
    el.focus();
    if (type === 'textarea'){
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value); else el.value = value;
      dispatchInput(el, value, 'insertFromPaste');
    } else {
      try { document.execCommand('selectAll', false, null); document.execCommand('delete', false, null); } catch {}
      let ok=false; try { ok = document.execCommand('insertText', false, value); } catch {}
      if (!ok){ el.textContent = value; }
      dispatchInput(el, value, 'insertFromPaste');
    }
  }

  // Assistant message accessors
  function getAssistantBlocks(){
    return [...document.querySelectorAll('[data-message-author-role="assistant"]')].filter(isVisible);
  }
  function cleanText(s){
    if (!s) return '';
    // Drop UI garbage
    s = s.replace(/getNodeByIdOrMessageId[\\s\\S]*?(Повторить|Retry)?/gi, '').trim();
    s = s.replace(/Ответь одним словом:[^\\n]+/gi, '').trim();
    s = s.replace(/\\b(Повторить|Retry)\\b/g, '').trim();
    return s.trim();
  }
  function extractAssistantText(el){
    // Try narrow content container
    const preferred = el.querySelector('.markdown, .prose, [data-testid="assistant-message-content"]');
    let text = '';
    const scope = preferred || el;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
    let node; while ((node = walker.nextNode())) {
      const s = node.nodeValue;
      if (!s) continue;
      // ignore hidden/utility nodes
      if (node.parentElement && (node.parentElement.closest('button, [role="button"], nav, header, footer, [aria-live]'))) continue;
      text += s;
    }
    if (text.trim().length < 3) text = scope.innerText || '';
    return cleanText(text);
  }
  function getAssistantSnapshot(){
    const blocks = getAssistantBlocks();
    const last = blocks[blocks.length - 1] || null;
    const text = last ? extractAssistantText(last) : '';
    return { count: blocks.length, text, lastEl: last };
  }

  function isGenerating(){
    if (document.querySelector('button[aria-label*="Stop"], button[aria-label*="Останов"], button[aria-label*="Стоп"]')) return true;
    if (document.querySelector('[data-testid="stop-button"], [data-testid*="stop"]')) return true;
    return false;
  }

  function pressEnter(el){
    const opts = { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  async function maybeRetry(lastEl){
    if (!lastEl) return false;
    // Look for Retry/Повторить button in the last assistant message
    const btn = lastEl.querySelector('button, [role="button"]');
    if (btn && /Повторить|Retry/i.test(btn.textContent||'')){
      btn.click();
      return true;
    }
    // Look for error text and a global retry nearby
    if ((lastEl.innerText||'').includes('getNodeByIdOrMessageId')){
      const retry = [...document.querySelectorAll('button')].find(b => /Повторить|Retry/i.test(b.textContent||''));
      if (retry){ retry.click(); return true; }
    }
    return false;
  }

  async function sendPromptText(prompt){
    const { el, type } = findComposer();
    if (!el) throw new Error('COMPOSER_NOT_FOUND');
    await setComposerValue(el, type, prompt);

    // Wait for send-ready then click; fallback to Enter
    const t0 = Date.now();
    while (Date.now() - t0 < 3000){
      const btn = findSendButton();
      if (sendButtonEnabled(btn)){ btn.click(); break; }
      await sleep(60);
    }
    if (!isGenerating()){ pressEnter(el); }
  }

  async function waitForCompletionAndStream(id, stream, timeoutMs){
    const start = Date.now();
    let snap = getAssistantSnapshot(); // baseline
    let prevText = snap.text;
    let started = false;
    let lastChangeAt = Date.now();
    let retriesLeft = 2;

    while (Date.now() - start < timeoutMs){
      const now = getAssistantSnapshot();
      // detect start
      if (!started){
        if (now.count > snap.count || now.text.length > snap.text.length || isGenerating()){
          started = true; prevText = now.text; lastChangeAt = Date.now();
          if (stream && now.text) chrome.runtime.sendMessage({type:'DELTA', id, delta: now.text});
        }
      } else {
        if (now.text.length > prevText.length){
          const delta = now.text.slice(prevText.length);
          prevText = now.text;
          lastChangeAt = Date.now();
          if (stream) chrome.runtime.sendMessage({type:'DELTA', id, delta});
        }
        // auto-retry on known error inside the same assistant bubble
        if (/getNodeByIdOrMessageId/i.test(now.text) && retriesLeft > 0){
          const did = await maybeRetry(now.lastEl);
          if (did){ retriesLeft--; await sleep(400); continue; }
        }
        if (!isGenerating() && Date.now() - lastChangeAt > 900){
          return cleanText(prevText);
        }
      }
      await sleep(120);
    }
    return cleanText(prevText);
  }

  async function handleSendPrompt(req){
    try {
      await sendPromptText(req.prompt);
      const text = await waitForCompletionAndStream(req.id, !!req.stream, req.timeoutMs || 180000);
      chrome.runtime.sendMessage({type:'DONE', id:req.id, text});
      return true;
    } catch (e){
      chrome.runtime.sendMessage({type:'ERROR', id:req.id, error: (e && e.message) || String(e)});
      throw e;
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'SEND_PROMPT') { handleSendPrompt(msg).then(()=>respond({ok:true})).catch(err=>respond({ok:false,error:String(err)})); return true; }
    if (msg.type === 'PING_CT') { respond({ok:true}); }
    if (msg.type === 'TEST_PROMPT') { sendPromptText(msg.prompt || "Проверка моста: ответь 'OK' одним словом.").then(()=>respond({ok:true})).catch(err=>respond({ok:false,error:String(err)})); return true; }
    if (msg.type === 'SET_DEBUG') { DEBUG = !!msg.value; respond({ok:true}); } // fixed typo
  });

  chrome.runtime.sendMessage({type:'PING_BG'});
})();
