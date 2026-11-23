// Runs an app's own Vite dev server with Verbally on top, without a change to the app's config.
// Usage: node code/dev.mjs <app folder> [port]      (no port: the app's own, from its config, else Vite's 5173)      (MOCK=1 and other env pass through to the app's config)
// `verbally <app folder>` starts this script by itself.
// Two things are added:
//   - every JSX element in the app gets data-vsrc="src/file.tsx:line", so pointing at the page finds the source;
//   - the page loads /_v/overlay.js, and /_v/* goes to the Verbally server (127.0.0.1:8787).
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// The real path, past symbolic links: Vite names every file by its real path, and the marks compare with it.
const app = fs.realpathSync(path.resolve(process.argv[2] || '.'))
const need = createRequire(path.join(app, 'package.json')) // vite and the parser come from the app, not from Verbally
let vite
try { vite = await import(pathToFileURL(need.resolve('vite')).href) } catch {
  console.error(`verbally: no Vite in ${app}. Code mode needs a Vite + React app. Run "npm install" there first.`)
  process.exit(1)
}

// parse gives the syntax tree of a JSX or TSX file. Vite 8 has a parser of its own.
// An older Vite has none for JSX; there the app's React plugin brings Babel.
let parse
if (vite.rolldownVersion) parse = (code, file) => vite.parseAst(code, { lang: /\.tsx$/.test(file) ? 'tsx' : 'jsx' })
else {
  let babel
  try { babel = need('@babel/core') } catch {
    console.error('verbally: this app has Vite 7 or older and no @babel/core. Update to Vite 8, or run "npm install -D @babel/core".')
    process.exit(1)
  }
  parse = (code, file) => babel.parseSync(code, { filename: file, babelrc: false, configFile: false, parserOpts: { plugins: ['jsx', 'typescript', 'decorators-legacy'] } })
}

// mark writes data-vsrc="file:line" into HTML elements (lowercase tags) and into library parts like <Menu.Item>, not into other components.
// Library parts pass unknown attributes on to their HTML, and a menu or a popover lives in a portal outside the app's tree:
// without a mark of its own, pointing at an open dropdown found no source.
// The mark goes right after the tag name and holds no line break, so every line keeps its number.
function mark(code, rel, file = rel) {
  const at = []
  ;(function walk(n) {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (n.type === 'JSXOpeningElement') {
      const name = n.name
      const part = name.type === 'JSXMemberExpression' && !/^(React\.)?Fragment$/.test(name.object.name + '.' + name.property.name) && name.property.name !== 'Provider'
      // `<` after the name is a type argument (<Table.Row<T>>): an attribute cannot stand before it.
      if ((part || (name.type === 'JSXIdentifier' && /^[a-z]/.test(name.name))) && code[name.end] !== '<') at.push(name.end)
    }
    for (const k in n) if (k !== 'loc') walk(n[k])
  })(parse(code, file))
  const breaks = [...code.matchAll(/\n/g)].map(m => m.index)
  let line = breaks.length
  for (const i of at.sort((a, b) => b - a)) { // from the end, so the places before it do not move
    while (line && breaks[line - 1] >= i) line--
    code = code.slice(0, i) + ` data-vsrc="${rel}:${line + 1}"` + code.slice(i)
  }
  return code
}
// Self-check at start, with a non-Latin letter before the tags: a parser that counts bytes puts the marks in the wrong place.
const sample = mark('const a = <div>я\n<Menu.Item/><Big/><></></div>', 'f.tsx')
if (sample !== 'const a = <div data-vsrc="f.tsx:1">я\n<Menu.Item data-vsrc="f.tsx:2"/><Big/><></></div>') throw new Error('verbally self-check failed: mark gave ' + sample)

const verbally = {
  name: 'verbally',
  enforce: 'pre',
  apply: 'serve',
  transform(code, id) {
    const file = id.split('?')[0]
    if (!/\.[jt]sx$/.test(file) || file.includes('/node_modules/') || !file.startsWith(app + path.sep)) return
    // ponytail: no source map for the marks. Line numbers stay right; the columns of a marked line shift in the debugger.
    // A file that our parser cannot read (syntax that the app's own plugins handle) goes on without marks, not broken.
    try { return { code: mark(code, path.relative(app, file), file), map: null } } catch { return }
  },
  // /_v reaches a server that writes files and runs Claude Code. Only this machine may use it, whatever Host it names.
  configureServer(server) {
    server.middlewares.use('/_v', (req, res, next) => {
      if (/^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress || '')) return next()
      res.statusCode = 403
      res.end('Verbally answers only to this machine.')
    })
  },
  transformIndexHtml: () => [{ tag: 'script', attrs: { type: 'module', src: '/_v/overlay.js' }, injectTo: 'body' }],
}

const server = await vite.createServer({
  root: app, // Vite finds the app's own config file there
  plugins: [verbally],
  server: {
    // Loopback only, over the app's own `server.host`: the bar can write files, so other devices must not reach it.
    // `localhost`, not 127.0.0.1: the app keeps the address it always has, with its cookies, OAuth callbacks and CORS lists.
    host: 'localhost',
    // The app's own port, so the same address works; strict, so a second copy never lands on another port unnoticed.
    port: process.argv[3] ? +process.argv[3] : undefined, strictPort: true,
    open: !!process.env.VERBALLY_OPEN, // `verbally <app>` sets it: the browser opens when the app is ready
    proxy: { '/_v': { target: 'http://127.0.0.1:' + (process.env.VERBALLY_PORT || 8787), rewrite: p => p.slice(3) } },
  },
})
try { await server.listen() } catch (e) {
  if (e.code !== 'EADDRINUSE' && !/already in use/.test(e.message)) throw e
  const port = server.config.server.port
  console.error(`verbally: port ${port} is taken. Is your own dev server running? Stop it: Verbally runs the app at the same address.\nOr give Verbally another port: verbally ${path.basename(app)} 5180`)
  process.exit(1)
}
server.printUrls()
