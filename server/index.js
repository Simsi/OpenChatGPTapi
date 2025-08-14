// index.js - v0.3.3 (same API, verbose logs)
import express from 'express';
import http from 'http';
import cors from 'cors';
import bodyParser from 'body-parser';
import { WebSocketServer } from 'ws';

const HTTP_PORT = process.env.PORT ? Number(process.env.PORT) : 11434;
const WS_PORT   = process.env.WS_PORT ? Number(process.env.WS_PORT) : 11435;
const DEBUG     = process.env.DEBUG === '1' || true;

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));

app.use((req, res, next) => {
  const t0 = process.hrtime.bigint();
  if (DEBUG) console.log(`[REQ] ${req.method} ${req.url}`);
  res.on('finish', () => {
    const dtMs = Number(process.hrtime.bigint() - t0) / 1e6;
    if (DEBUG) console.log(`[RES] ${req.method} ${req.url} -> ${res.statusCode} (${dtMs.toFixed(1)} ms)`);
  });
  next();
});

const wss = new WebSocketServer({ port: WS_PORT, path: '/bridge' });
let ext = null;
wss.on('connection', (socket, req) => {
  ext = socket;
  console.log(`[WS] extension connected from ${req.socket.remoteAddress}`);
  socket.on('close', () => { if (ext === socket) ext = null; console.log('[WS] extension disconnected'); });
  socket.on('message', (buf) => {
    try {
      const msg = JSON.parse(buf.toString('utf8'));
      if (DEBUG) console.log('[WS<-EXT]', msg.type);
      handleExtMessage(msg);
    } catch (e) { console.error('[WS] bad msg', e); }
  });
});

const pending = new Map();
function sendToExt(obj) {
  if (!ext || ext.readyState !== 1) throw new Error('EXTENSION_NOT_CONNECTED');
  if (DEBUG) console.log('[WS->EXT]', obj.type);
  ext.send(JSON.stringify(obj));
}
function newId() { return 'job_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
function handleExtMessage(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'delta') {
    const p = pending.get(msg.id); if (p && p.onDelta) p.onDelta(String(msg.delta || ''));
  } else if (msg.type === 'done') {
    const p = pending.get(msg.id); if (p) { p.resolve(String(msg.text || '')); pending.delete(msg.id); }
  } else if (msg.type === 'jobError') {
    const p = pending.get(msg.id); if (p) { p.reject(new Error(msg.error || 'UNKNOWN')); pending.delete(msg.id); }
  } else if (msg.type === 'jobStarted') {
    if (DEBUG) console.log(`[JOB] started id=${msg.id}`);
  } else if (msg.type === 'hello') {
    // ack
  }
}

async function askChatGPT(prompt, { stream = false, timeoutMs = 180000 } = {}) {
  const id = newId();
  if (DEBUG) console.log(`[JOB] enqueue id=${id}, stream=${stream}, prompt.len=${(prompt||'').length}`);
  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onDelta: null, createdAt: Date.now() });
    try { sendToExt({ type: 'job', id, prompt, stream, timeoutMs }); }
    catch (e) { pending.delete(id); reject(e); }
  });
  return { id, promise };
}
function askChatGPTStreaming(prompt, { timeoutMs = 180000 } = {}) {
  const id = newId(); let onDelta = null;
  if (DEBUG) console.log(`[JOB] enqueue-stream id=${id}, prompt.len=${(prompt||'').length}`);
  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onDelta: s => onDelta && onDelta(s), createdAt: Date.now() });
    try { sendToExt({ type: 'job', id, prompt, stream: true, timeoutMs }); }
    catch (e) { pending.delete(id); reject(e); }
  });
  return { id, promise, onDeltaSetter: f => { onDelta = f; } };
}

// Ollama-like
app.post('/api/generate', async (req, res) => {
  const { prompt = '', stream = true, model = 'chatgpt-web' } = req.body || {};
  if (DEBUG) console.log('[API] /api/generate body =', req.body);
  res.setHeader('X-Bridge', 'chatgpt-web');

  if (stream) {
    res.setHeader('Content-Type', 'application/x-ndjson');
    const { promise, onDeltaSetter } = askChatGPTStreaming(prompt);
    onDeltaSetter((delta) => {
      res.write(JSON.stringify({ model, created_at:new Date().toISOString(), response:delta, done:false }) + '\n');
    });
    try {
      const full = await promise;
      res.write(JSON.stringify({ model, created_at:new Date().toISOString(), response:'', done:true, total_duration:0, eval_count: full.length }) + '\n');
      res.end();
    } catch (e) {
      console.error('[API] /api/generate error:', e);
      res.status(500).json({ error: String(e.message || e) });
    }
  } else {
    try {
      const { promise } = await askChatGPT(prompt, { stream:false });
      const full = await promise;
      res.json({ model, created_at:new Date().toISOString(), response:full, done:true, total_duration:0, eval_count: full.length });
    } catch (e) {
      console.error('[API] /api/generate error:', e);
      res.status(500).json({ error: String(e.message || e) });
    }
  }
});

app.post('/api/chat', async (req, res) => {
  const { messages = [], stream = true, model = 'chatgpt-web' } = req.body || {};
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const prompt = lastUser ? (Array.isArray(lastUser.content) ? lastUser.content.map(c => c.text || '').join('\n') : lastUser.content || '') : (req.body && req.body.prompt) || '';
  if (!prompt) return res.status(400).json({ error: 'No prompt' });
  req.body = { prompt, stream, model };
  return app._router.handle(req, res, () => {});
});

// OpenAI minimal
app.get('/v1/models', (req, res) => {
  res.json({ data: [{ id: 'chatgpt-web', object: 'model', owned_by: 'local' }] });
});
app.post('/v1/chat/completions', async (req, res) => {
  const { messages = [], stream = false, model = 'chatgpt-web' } = req.body || {};
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const prompt = lastUser ? (Array.isArray(lastUser.content) ? lastUser.content.map(c => c.text || '').join('\n') : lastUser.content || '') : '';
  if (!prompt) return res.status(400).json({ error: { message: 'No user message' } });

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const { promise, onDeltaSetter } = askChatGPTStreaming(prompt);
    onDeltaSetter((delta) => {
      const data = { id:newId(), object:'chat.completion.chunk', created:Math.floor(Date.now()/1000), model,
        choices:[{ index:0, delta:{ role:'assistant', content:delta }, finish_reason:null }] };
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    });
    try { await promise; res.write('data: [DONE]\n\n'); res.end(); }
    catch (e) { res.write(`data: ${JSON.stringify({ error: String(e.message || e) })}\n\n`); res.end(); }
  } else {
    try {
      const { promise } = await askChatGPT(prompt, { stream:false });
      const full = await promise;
      res.json({ id:newId(), object:'chat.completion', created:Math.floor(Date.now()/1000), model,
        choices:[{ index:0, message:{ role:'assistant', content: full }, finish_reason:'stop' }] });
    } catch (e) { res.status(500).json({ error: { message: String(e.message || e) } }); }
  }
});

app.get('/healthz', (req, res) => {
  res.json({ ok:true, extension_connected: !!ext, pending_jobs: pending.size, now:new Date().toISOString() });
});
app.get('/__routes', (req, res) => {
  const out = []; app._router.stack.forEach((m)=>{ if (m.route) out.push({ path:m.route.path, methods:Object.keys(m.route.methods).join(',').toUpperCase() }); });
  res.json(out);
});
app.all('*', (req, res) => { console.error(`[404] ${req.method} ${req.url} (маршрут не найден)`); res.status(404).json({ error: `Cannot ${req.method} ${req.url}` }); });

const server = http.createServer(app);
server.listen(HTTP_PORT, '127.0.0.1', () => { console.log(`[HTTP] listening on http://127.0.0.1:${HTTP_PORT}`); });
console.log(`[WS] listening on ws://127.0.0.1:${WS_PORT}/bridge`);
