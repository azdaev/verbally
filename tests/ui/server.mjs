// Deterministic browser fixture. No microphone, model account, or project files are used.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
const root = resolve(import.meta.dirname, '../..')
let lastEngine = ''
let source = 'export const title = "Original"', undo = [], redo = [], preview = null
const body = async req => { let text = ''; for await (const chunk of req) text += chunk; return text }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost'), path = url.pathname.replace(/^\/_v/, '')
  const send = (text, type = 'text/plain', status = 200) => { res.writeHead(status, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(text) }
  try {
    if (path === '/reset') { source = 'export const title = "Original"'; undo = []; redo = []; preview = null; return send('ok') }
    if (path === '/api/setup') return send(JSON.stringify({ version: 'fixture', engine: 'codex', speech: 'dictation', app: 'Fixture', key: 'right ⌥', code: 'AltRight', others: 'Handy', claude: 'installed', codex: 'installed', codexModel: 'gpt-6.2-sol' }), 'application/json')
    if (path === '/api/log' || path === '/api/page') { await body(req); return send('ok') }
    if (path === '/api/root') return send('/fixture')
    if (path === '/api/release') { if (preview !== null) { source = preview; preview = null }; return send('') }
    if (path === '/api/file') {
      if (req.method === 'GET') return send(source)
      const next = await body(req)
      if (url.searchParams.has('noundo')) preview ??= source
      else { undo.push(preview ?? source); preview = null; redo = [] }
      source = next; return send('ok')
    }
    if (path === '/api/undo') {
      const from = url.searchParams.has('redo') ? redo : undo, to = from === redo ? undo : redo
      if (from.length) { to.push(source); source = from.pop() }
      return send('fixture.jsx')
    }
    if (path === '/api/triage') { const d = JSON.parse(await body(req)); return send(JSON.stringify({ versions: /versions/.test(d.text), filler: d.text === 'filler' }), 'application/json') }
    if (path === '/engine-used') return send(lastEngine)
    if (path === '/api/claude' || path === '/api/codex') {
      lastEngine = path.split('/').at(-1)
      const d = JSON.parse(await body(req)), prompt = d.messages.at(-1)?.content || ''
      if (d.messages.length < 2) return send('')
      const code = prompt.startsWith('Files:'), version = prompt.match(/This is version (\d+)/)?.[1]
      const slow = /slow/.test(prompt), fail = /request-error/.test(prompt)
      if (fail) return send('Fixture error', 'text/plain', 503)
      const label = version ? 'Version ' + version : 'Changed'
      const reply = code ? `<!-- task: ${label} -->\n<<< fixture.jsx\n${source}\n===\nexport const title = "${label}"\n>>>` : `<!-- task: ${label} --><section style="padding:60px;background:#f4f4f5"><h1>${label}</h1><p>A test page for the React controls.</p></section>`
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: '+JSON.stringify({ choices:[{delta:{content:reply.slice(0,26)}}] })+'\n\n')
      const timer = setTimeout(() => { if (!res.destroyed) res.end('data: '+JSON.stringify({choices:[{delta:{content:reply.slice(26)}}]})+'\n\n') }, slow ? 5000 : 100)
      res.on('close', () => clearTimeout(timer)); return
    }
    if (path === '/code') return send(`<!doctype html><html><meta charset="utf-8"><title>Verbally code fixture</title><style>body{font:16px system-ui;padding:40px}button{background:magenta!important;border:10px solid red!important;font-size:48px!important}#bar{display:none!important}main{padding:80px;background:#f4f4f5}</style><main data-vsrc="fixture.jsx:1"><h1 data-vsrc="fixture.jsx:1">Code fixture</h1><p>Host styles must not change the Verbally controls.</p><input aria-label="Host text field" value="Keep this text"></main><script type="module">await import('/overlay.js');const s=document.createElement('script');s.src='/tests/ui/scenarios.js';document.body.append(s)</script></html>`, 'text/html')
    let file = path === '/' ? 'index.html' : path.slice(1)
    const absolute = resolve(root, file)
    if (!absolute.startsWith(root + '/')) return send('Forbidden', 'text/plain', 403)
    let bytes = await readFile(absolute)
    if (file === 'index.html') bytes = bytes.toString().replace('</html>', '<script src="/tests/ui/scenarios.js"></script></html>')
    send(bytes, ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.mjs':'text/javascript' })[extname(file)] || 'text/plain')
  } catch { send('Not found', 'text/plain', 404) }
})
server.listen(18788, '127.0.0.1', () => console.log('UI fixtures: http://127.0.0.1:18788/ and /code'))
