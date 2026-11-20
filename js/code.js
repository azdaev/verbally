// Code mode: a phrase changes the source files of the element that the user points at, and the app's dev server shows the change.
// The pointer (⌥ + mouse) finds data-vsrc="file:line" marks that code/dev.mjs puts on every JSX element.
// Without a pointer the element under the mouse counts. Each phrase is its own request; they run side by side.

const codeReady = Promise.all([setupReady, fetch(VB + '/prompt-code.txt').then(r => r.text())]).then(([, t]) => system = t) // `system` lives in core.js
let spoke = null // the pointer that was there during this phrase
// said: the last phrases and what they changed. The user often says the same thing again because the change did not work;
// without this the model sees each phrase as new and repeats the same small change.
// It lives in the browser storage, so a reload (or Vite's full reload after an edit) keeps it.
let said = []
try { said = JSON.parse(sessionStorage.getItem('verbally.said') || '[]') } catch {}
// One picker at a time, and no phrase writes a file while the picker shows versions of it:
//   - a phrase that comes while the picker is open waits for the choice, then changes the chosen version;
//   - a request for versions waits for the changes in flight, so the versions start from their result.
// ponytail: one lock for all files, in this page only. Two browser tabs on one app can still write over each other.
let pickOn = false, flying = 0
const sleep = ms => new Promise(r => setTimeout(r, ms))
// The model can name a file by its full path or with ./ in front. inApp gives the path inside the app, so one file has one name.
let root = ''
fetch(VB + '/api/root').then(r => r.ok ? r.text() : '').then(t => root = t).catch(() => {})
const inApp = f => (root && f.startsWith(root + '/') ? f.slice(root.length + 1) : f).replace(/^\.\//, '')

// files gives the source of an element and of the component around it: [the file that writes it, the next file up].
function files(el) {
  const out = []
  for (let e = el?.closest('[data-vsrc]'); e && out.length < 2; e = e.parentElement?.closest('[data-vsrc]')) {
    const file = e.dataset.vsrc.replace(/:\d+$/, '')
    if (!out.includes(file)) out.push(file)
  }
  return out
}

const read = file => fetch(VB + '/api/file?path=' + encodeURIComponent(file)).then(r => r.ok ? r.text() : Promise.reject(new Error(file + ': ' + r.status)))

// apply puts the edit blocks of one file into its text. It returns '' when a block does not match exactly once.
function apply(text, blocks) {
  for (const [from, to] of blocks) {
    if (!from || text.split(from).length !== 2) return ''
    text = text.replace(from, () => to)
  }
  return text
}
check(apply('a b c', [['b', 'x']]) === 'a x c' && apply('b b', [['b', 'x']]) === '', 'apply')

function hear(text, final) {
  const cmd = text.replace(/^[\s.,;:!?-]+/, '').trim()
  if (point) spoke = point
  UI.update({ live: final ? '' : cmd })
  if (!final || !cmd) return
  const pointed = spoke
  spoke = null
  const el = chip(cmd)
  const t0 = performance.now()
  change(cmd, pointed, el).then(n => {
    if (el.cancelled) return
    el.update({ kind: n ? 'done' : 'skip' })
    leave(el, n ? 1400 : 900)
  }).catch(e => {
    if (el.cancelled) return
    el.update({ kind: 'err' })
    el.update({ text: e.message })
    leave(el, 6000)
    tele({ event: 'code_edit', cmd, error: e.message, ms: Math.round(performance.now() - t0) })
  }).finally(() => { if (point === pointed) unpoint() }) // the user may point for the next phrase already: that pointer stays
}

// change runs one phrase: the files, the model, the edit. It returns the number of changed files.
async function change(cmd, pointed, el) {
  await codeReady
  const t = await fetch(VB + '/api/triage', { method: 'POST', body: JSON.stringify({ text: cmd }) }).then(r => r.json()).catch(() => ({}))
  if (t.filler) return 0
  // No pointing with ⌥: the element under the mouse. No mouse yet: the middle of the screen.
  const hover = !pointed && underMouse()?.closest('[data-vsrc]')
  const target = pointed?.els.at(-1) || hover || document.elementFromPoint(innerWidth / 2, innerHeight / 2)
  // The files of the pointed element, then the file of each mark: "make this ① like that ②" can span two components.
  const paths = [...new Set([...files(target), ...(pointed?.marks || []).flatMap(m => files(m.el).slice(0, 1))])].slice(0, 4)
  if (!paths.length) throw new Error('No source code here. Hold ⌥ Option and point at the app.')
  for (const e of pointed?.els || [target]) e.classList.add('glow')
  const ac = new AbortController()
  el.stop = () => ac.abort()
  const t0 = performance.now()
  let locked = false
  try {
    while (!el.cancelled && (pickOn || (t.versions && flying))) await sleep(200)
    if (el.cancelled) return 0
    locked = true // no `await` stands between the check above and the lock below, so two phrases cannot both pass
    if (t.versions) pickOn = true
    else flying++
    const ask1 = async more => {
      const texts = await Promise.all(paths.map(read))
      const user = 'Files:\n' + paths.map((p, i) => `--- ${p}\n${texts[i]}`).join('\n\n')
        + (said.length ? `\n\nSaid before, oldest first. Each was done. When the new speech repeats one, that change did not work: do it another way, and enough to be visible:\n${said.join('\n')}` : '')
        + `\n\nPointer:\n${pointed?.text || `(the user held no key to point. The element ${hover ? 'under the mouse' : 'in the middle of the screen'}: ${bare(target)})`}\n\nSpeech:\n${cmd}`
      if (t.versions) return versions(cmd, user, Object.fromEntries(paths.map((p, i) => [p, texts[i]])), ac, el)
      return ask(user + more, ac.signal, name => el.update({ title: name }), shots(pointed?.zone))
    }
    if (t.versions) return await ask1('')
    let reply, blocks, byFile
    for (let more = '', tries = 0; ; tries++) {
      reply = await ask1(more)
      if (/^\s*(<!--[\s\S]*?-->\s*)?SAME\s*$/.test(reply)) return 0
      blocks = edits(reply)
      if (!blocks.length) throw new Error('The model gave no edit')
      if (el.cancelled) return 0
      byFile = Map.groupBy(blocks, b => b[1])
      const shown = pointed?.els?.length ? pointed.els : [target]
      const done = await sweep(box(shown.filter(e => e.isConnected)), () => commit(byFile).then(bad => ({ bad }), error => ({ error })))
      if (done.error) throw done.error
      if (!done.bad) break
      // The blocks did not fit: another phrase changed the same text meanwhile, or an old text was not exact. One more try with the files as they are now.
      if (tries) throw new Error('The edit did not fit ' + done.bad)
      tele({ event: 'code_retry', cmd, file: done.bad })
      if (!paths.includes(done.bad)) paths.push(done.bad)
      more = `\n\nYour edit blocks did not fit ${done.bad}: an old text was not exact, or it occurs more than once, or the file changed. "Files" above holds the files as they are now. Write the edit blocks again.`
    }
    said = [...said, `- "${cmd}" → ${[...byFile.keys()].join(', ')}: ${blocks.map(b => b[3].trim().slice(0, 120).replace(/\s+/g, ' ')).join(' | ')}`].slice(-5)
    try { sessionStorage.setItem('verbally.said', JSON.stringify(said)) } catch {}
    // One long phrase can hold several requests: the model names each task, and each one gets its own card.
    for (const [, name] of [...reply.matchAll(/<!--\s*task:\s*([\s\S]*?)-->/g)].slice(1)) {
      const c = chip('', 'done')
      c.update({ title: name.trim() })
      leave(c, 1400)
    }
    tele({ event: 'code_edit', cmd, files: [...byFile.keys()], blocks: blocks.length, ms: Math.round(performance.now() - t0) })
    return byFile.size
  } finally {
    if (locked && t.versions) pickOn = false
    else if (locked) flying--
    for (const e of pointed?.els || [target]) e.classList.remove('glow')
  }
}

// commit puts edit blocks into the files as they are at this moment, and writes them. One commit runs at a time:
// two phrases that end together read and write one after the other, so neither writes over the other.
// It returns '' when all is written, or the name of the file that the blocks do not fit; then no file is written.
let commits = Promise.resolve()
const commit = byFile => commits = commits.catch(() => {}).then(async () => {
  const next = await Promise.all([...byFile].map(async ([file, bs]) => [file, apply(await read(file), bs.map(b => [b[2], b[3]]))]))
  const bad = next.find(([, text]) => !text)
  if (bad) return bad[0]
  for (const [file, text] of next) await write(file, text)
  return ''
})

// edits reads the blocks of a reply: [, file, old text, new text]. A block ends with >>> alone on a line:
// the new text itself can hold >>> (a shift in JavaScript), and a path can hold a space.
const edits = reply => [...reply.matchAll(/^<<< *(.+)\n([\s\S]*?)\n===\n([\s\S]*?)\n?^>>>[ \t]*$/gm)].map(b => (b[1] = inApp(b[1].trim()), b))
check(String(edits('<!--task: a-->\n<<< my app/a.jsx \nx\n===\ny >>> 1\n>>>\n<<< ./b.css\nz\n===\n>>>').map(b => b.slice(1))) === 'my app/a.jsx,x,y >>> 1,b.css,z,', 'edits')
// write fails when the server refuses the text: the error says why (the file changed outside Verbally, or it is gone).
const write = (file, text, noundo) => fetch(VB + '/api/file?path=' + encodeURIComponent(file) + (noundo ? '&noundo=1' : ''), { method: 'POST', body: text })
  .then(async r => { if (!r.ok) throw new Error(file + ': ' + (await r.text()).trim()) })
// release ends every preview of the picker: the server puts each file back as it was before the picker.
const release = () => fetch(VB + '/api/release', { method: 'POST' }).then(r => r.ok ? r.text() : '').catch(() => '')
// The page loaded again while the picker showed a version (the user's reload, or the dev server's after a change): the files go back.
release().then(names => names && note('The page loaded again during a choice of versions. Back as before: ' + names))

// versions builds several versions of a change side by side and shows them in the picker. A click writes that version
// into the files as a preview, so the dev server shows it on the live app. "Use this" keeps it as one undo step; "Cancel" puts the files back.
// The server holds the text from before the picker (code.go), so Cancel, a reload and a change from another program lose nothing.
// ponytail: after a reload of the page the picker is gone and the files are back. Keep the built versions in sessionStorage if users ask.
const CODE_IDEAS = [
  'the most compact and quiet one',
  'the most visual one: icons, colour, a clear state',
  'a different arrangement of the same content',
  'the boldest one, that a person notices at once',
  'the most familiar one, as in well-known products',
]
function versions(cmd, user, base, ac, el) {
  const n = Math.min(CODE_IDEAS.length, howMany(cmd))
  const shown = { ...base } // what each file holds now
  let built = 0, open = true, writes = Promise.resolve()
  // Writes go one after another: two writes of one file at once can land in either order.
  const queue = job => writes = writes.catch(() => {}).then(job)
  return new Promise((done, fail) => {
    const close = () => { // the versions that are not ready are not needed now: their engine processes stop
      open = false
      UI.closePicker()
      el.stop = null
      ac.abort()
    }
    const show = files => queue(async () => {
      if (!open) return
      const want = { ...base, ...files } // a file that only the version before changed goes back to its base
      for (const f in want) if (want[f] !== shown[f]) { await write(f, want[f], true); shown[f] = want[f] }
    }).catch(e => { // the server refused a preview: the picker closes, and every other file goes back
      if (!open) return
      close()
      release().then(() => fail(e))
    })
    const finish = (keep, name) => {
      if (!open) return
      close()
      tele({ event: 'code_versions', cmd, built, picked: name || null })
      queue(async () => {
        // One write per kept file. The server counts the undo step from the text before the picker; then every other preview ends.
        try { for (const [f, text] of Object.entries(keep || {})) if (text !== base[f]) await write(f, text) } finally { await release() }
      }).then(() => done(keep ? Object.keys(keep).length : 0), fail)
    }
    el.stop = () => finish(null)
    pickOpen(`Building ${n} versions…`, false, () => finish(null))
    Promise.all(CODE_IDEAS.slice(0, n).map(async (idea, k) => {
      const reply = await ask(user + `\n\nThe speaker will choose from ${n} versions. This is version ${k + 1}: ${idea}. Make it clearly different from the others.`, ac.signal, () => {}).catch(() => '')
      const byFile = Map.groupBy(edits(reply), b => b[1])
      // A version can change a file that is not one of the pointed ones (a stylesheet that the model found): its base is read now.
      for (const f of byFile.keys()) if (!(f in base)) {
        const text = await read(f).catch(() => '')
        if (!(f in base)) shown[f] = base[f] = text // another version can name the same file meanwhile: the first text wins
      }
      const files = Object.fromEntries([...byFile].map(([f, bs]) => [f, apply(base[f], bs.map(b => [b[2], b[3]]))]))
      if (!open || !byFile.size || Object.values(files).some(t => !t)) return
      const name = reply.match(/<!--\s*task:\s*([\s\S]*?)-->/)?.[1].trim() || 'Version ' + (k + 1)
      pickAdd(Object.assign(document.createElement('span'), { className: 'label', textContent: name }), () => show(files), () => finish(files, name))
      UI.pickerTitle(++built < n ? `Building ${n} versions… ${built} ready` : 'Pick a version')
    })).then(() => { if (open && !built) { close(); fail(new Error('No version fit the files')) } })
  })
}

// ask streams the reply of the design engine. The reply starts with the task name; onName shows it at once.
// ponytail: a copy of the stream reading in model.js. Share it when a third mode needs it.
async function ask(user, signal, onName, shown) {
  const res = await fetch(engineURL(), { signal, method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: Math.random().toString(36).slice(2, 10), model: MODEL, effort: EFFORT, shots: shown, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) })
  if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 200))
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = '', text = '', named = false
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return text
    buf += value
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!line.startsWith('data: {')) continue
      const d = JSON.parse(line.slice(6))
      if (d.reset) text = ''
      text += d.choices?.[0]?.delta?.content || ''
    }
    const name = !named && text.match(/<!--\s*task:\s*([\s\S]*?)-->/)?.[1].trim()
    if (name) named = true, onName(name)
  }
}

function cancel(el) {
  el.cancelled = true
  el.stop?.()
  tele({ event: 'cancel', text: el.text })
  el.update({ kind: 'skip' })
  leave(el, 300)
}

// Undo puts back the file from before the last change; redo puts the change back. Clear belongs to the page mode.
function travel(step) {
  if (pickOn) return note('Versions are open. Use one or cancel, then undo.') // a step now would mix with the version on the screen
  fetch(VB + '/api/undo' + (step > 0 ? '?redo=1' : ''), { method: 'POST' })
    .then(r => r.text().then(t => r.ok ? leave(chip((step > 0 ? 'Redone: ' : 'Undone: ') + t, 'done'), 1400) : note(t)))
}
UI.update({ tools: true, canUndo: true, canRedo: true })
// Start the engine now, so the first phrase does not wait for it.
codeReady.then(() => { if (ENGINE === 'claude') return fetch(engineURL(), { method: 'POST', body: JSON.stringify({ model: MODEL, effort: EFFORT, messages: [{ content: system }] }) }) }).catch(() => {})
// Test hooks: ?vsay=phrase&vpoint=css selector&vwait=ms says a phrase while pointing at that element, without hands.
if (q.get('vsay')) setTimeout(() => {
  const t = q.get('vpoint') && document.querySelector(q.get('vpoint'))
  if (t) point = { sec: document.body, els: [t], text: t.outerHTML.slice(0, 300) }
  hear(q.get('vsay'), true)
}, +(q.get('vwait') || 4000))
// ?vpick=N&vkeep=1: when the versions are ready, show version N; with vkeep, press "Use this" 4 s later.
if (q.get('vpick')) {
  const wait = setInterval(() => {
    const b = $('pick')?.querySelectorAll('.grid button')[q.get('vpick') - 1]
    if (!b || !UI.getSnapshot().picker) return
    clearInterval(wait)
    b.click()
    if (q.get('vkeep')) setTimeout(() => $('pickUse').click(), 4000)
  }, 500)
}
