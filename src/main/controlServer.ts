// Opt-in HTTP control server: drive Nexus from a browser or script on your LAN.
// Electron-free — index.ts injects the app-side capabilities via `deps`. Every request
// (page and API) must present the shared token, so binding to the LAN is gated by a secret.
//
// Routes:
//   GET  /                 -> the built-in control web page (needs ?token=…)
//   GET  /api/status       -> instances, models, project folder
//   GET  /api/history      -> recent run summaries
//   POST /api/chat         -> { baseUrl, model, prompt } -> { text }
//   POST /api/run          -> { task } -> { runId }  (auto-picks the best local/cloud models)

import http from 'node:http'
import type { OllamaInstance, RunSummary } from '../shared/types'

export interface ControlDeps {
  token: string
  getInstances: () => OllamaInstance[]
  listRuns: () => Promise<RunSummary[]>
  getProjectFolder: () => string | null
  complete: (baseUrl: string, model: string, prompt: string) => Promise<string>
  /** Start an orchestrator run for `task`; returns a runId, or null if it can't (no models/folder). */
  startRun: (task: string) => string | null
}

export interface ControlServer {
  stop: () => Promise<void>
  port: number
}

const MAX_BODY = 1_000_000 // 1 MB cap on request bodies

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > MAX_BODY) {
        reject(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!data.trim()) return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function tokenFrom(req: http.IncomingMessage, url: URL): string {
  const header = req.headers['x-nexus-token']
  if (typeof header === 'string' && header) return header
  return url.searchParams.get('token') ?? ''
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function startControlServer(host: string, port: number, deps: ControlDeps): Promise<ControlServer> {
  const server = http.createServer((req, res) => {
    handle(req, res, deps).catch((err) => {
      sendJson(res, 500, { error: (err as Error).message })
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.removeListener('error', reject)
      resolve({
        port,
        stop: () =>
          new Promise<void>((r) => {
            server.close(() => r())
          })
      })
    })
  })
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, deps: ControlDeps): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const path = url.pathname

  // Auth gate — constant string compare is fine here; the token is a random UUID.
  if (tokenFrom(req, url) !== deps.token) {
    if (path === '/' || path === '/index.html') {
      res.writeHead(401, { 'Content-Type': 'text/html' })
      res.end('<h2>Nexus control</h2><p>Add <code>?token=YOUR_TOKEN</code> to the URL (see Settings → Remote control).</p>')
    } else {
      sendJson(res, 401, { error: 'missing or invalid token' })
    }
    return
  }

  if ((path === '/' || path === '/index.html') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(controlPage(deps.token))
    return
  }

  if (path === '/api/status' && req.method === 'GET') {
    const instances = deps.getInstances().map((i) => ({
      id: i.id,
      online: i.online,
      source: i.source,
      baseUrl: i.baseUrl,
      models: i.models.map((m) => m.name)
    }))
    sendJson(res, 200, { ok: true, project: deps.getProjectFolder(), instances })
    return
  }

  if (path === '/api/history' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, runs: await deps.listRuns() })
    return
  }

  if (path === '/api/chat' && req.method === 'POST') {
    const body = await readJson(req)
    const baseUrl = String(body.baseUrl ?? '')
    const model = String(body.model ?? '')
    const prompt = String(body.prompt ?? '')
    if (!baseUrl || !model || !prompt) return sendJson(res, 400, { error: 'baseUrl, model and prompt are required' })
    // Only allow talking to a known instance — never an arbitrary URL (prevents the token
    // holder from turning Nexus into an SSRF proxy).
    const known = deps.getInstances().find((i) => i.baseUrl === baseUrl && i.models.some((m) => m.name === model))
    if (!known) return sendJson(res, 400, { error: 'unknown baseUrl/model — must be one from /api/status' })
    const text = await deps.complete(baseUrl, model, prompt)
    sendJson(res, 200, { ok: true, text })
    return
  }

  if (path === '/api/run' && req.method === 'POST') {
    const body = await readJson(req)
    const task = String(body.task ?? '').trim()
    if (!task) return sendJson(res, 400, { error: 'task is required' })
    const runId = deps.startRun(task)
    if (!runId) return sendJson(res, 409, { error: 'cannot start: set a project folder and have at least one model online' })
    sendJson(res, 200, { ok: true, runId })
    return
  }

  sendJson(res, 404, { error: 'not found' })
}

/** The single-file control page. Token is injected so its own fetches carry it. */
function controlPage(token: string): string {
  const t = JSON.stringify(token)
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nexus control</title><style>
:root{color-scheme:dark}body{font-family:system-ui,sans-serif;background:#0e0f13;color:#e6e6e6;margin:0;padding:16px;max-width:820px;margin:0 auto}
h1{font-size:20px}h2{font-size:15px;margin:18px 0 8px;color:#9aa}
button{background:#2a2d3a;color:#e6e6e6;border:1px solid #3a3d4a;border-radius:6px;padding:8px 12px;cursor:pointer}
button.primary{background:#4b5bd6;border-color:#4b5bd6}
select,input,textarea{background:#15171e;color:#e6e6e6;border:1px solid #3a3d4a;border-radius:6px;padding:8px;width:100%;box-sizing:border-box;font:inherit}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.card{border:1px solid #2a2d3a;border-radius:8px;padding:12px;margin-bottom:12px}
pre{white-space:pre-wrap;background:#15171e;border:1px solid #2a2d3a;border-radius:6px;padding:10px;max-height:340px;overflow:auto}
.muted{color:#889;font-size:13px}
</style></head><body>
<h1>⬡ Nexus control</h1><p class="muted">Remote control panel. Served over your LAN — anyone with this URL + token can use it.</p>

<h2>Status</h2>
<div class="card"><div class="row"><button onclick="loadStatus()">Refresh</button><span id="proj" class="muted"></span></div><pre id="status">…</pre></div>

<h2>Chat with a model</h2>
<div class="card">
  <div class="row"><select id="model"></select></div>
  <textarea id="prompt" rows="3" placeholder="Prompt…" style="margin-top:8px"></textarea>
  <div class="row" style="margin-top:8px"><button class="primary" onclick="doChat()">Send</button><span id="chatMsg" class="muted"></span></div>
  <pre id="reply" style="display:none"></pre>
</div>

<h2>Trigger a project run</h2>
<div class="card">
  <textarea id="task" rows="2" placeholder="Task for the agents (uses the project folder + best available models)…"></textarea>
  <div class="row" style="margin-top:8px"><button class="primary" onclick="doRun()">Start run</button><span id="runMsg" class="muted"></span></div>
</div>

<script>
const TOKEN=${t};
const H={'Content-Type':'application/json','X-Nexus-Token':TOKEN};
let models=[];
async function loadStatus(){
  const r=await fetch('/api/status',{headers:H}); const d=await r.json();
  document.getElementById('status').textContent=JSON.stringify(d,null,2);
  document.getElementById('proj').textContent=d.project?('project: '+d.project):'no project folder set';
  models=[]; const sel=document.getElementById('model'); sel.innerHTML='';
  (d.instances||[]).filter(i=>i.online).forEach(i=>i.models.forEach(m=>{
    models.push({baseUrl:i.baseUrl,model:m});
    const o=document.createElement('option'); o.value=models.length-1; o.textContent=m+' @ '+i.id; sel.appendChild(o);
  }));
}
async function doChat(){
  const idx=document.getElementById('model').value; const m=models[idx];
  if(!m){document.getElementById('chatMsg').textContent='no model';return}
  const prompt=document.getElementById('prompt').value.trim(); if(!prompt)return;
  document.getElementById('chatMsg').textContent='…thinking'; const rep=document.getElementById('reply'); rep.style.display='none';
  try{
    const r=await fetch('/api/chat',{method:'POST',headers:H,body:JSON.stringify({baseUrl:m.baseUrl,model:m.model,prompt})});
    const d=await r.json(); document.getElementById('chatMsg').textContent='';
    rep.style.display='block'; rep.textContent=d.text||('error: '+(d.error||'unknown'));
  }catch(e){document.getElementById('chatMsg').textContent='error: '+e.message}
}
async function doRun(){
  const task=document.getElementById('task').value.trim(); if(!task)return;
  document.getElementById('runMsg').textContent='…starting';
  const r=await fetch('/api/run',{method:'POST',headers:H,body:JSON.stringify({task})});
  const d=await r.json();
  document.getElementById('runMsg').textContent=d.ok?('started (runId '+d.runId+') — watch the app / History'):('error: '+(d.error||'unknown'));
}
loadStatus();
</script></body></html>`
}
