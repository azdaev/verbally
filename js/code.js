// Code mode: a phrase changes the source files of the element that the user points at, and the app's dev server shows the change.
// The pointer (⌥ + mouse) finds data-vsrc="file:line" marks that code/dev.mjs puts on every JSX element.
// Without a pointer the element under the mouse counts. Each phrase is its own request; they run side by side.

fetch(VB + '/prompt-code.txt').then(r => r.text()).then(t => system = t) // `system` lives in core.js
let spoke = null // the pointer that was there during this phrase
// said: the last phrases and what they changed. The user often says the same thing again because the change did not work;
// without this the model sees each phrase as new and repeats the same small change.
// It lives in the browser storage, so a reload (or Vite's full reload after an edit) keeps it.
let said = []
try { said = JSON.parse(sessionStorage.getItem('verbally.said') || '[]') } catch {}

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
  $('live').textContent = final ? '' : cmd
  fit()
  if (!final || !cmd) return
  const pointed = spoke
  spoke = null
  const el = chip(cmd)
  const t0 = performance.now()
  change(cmd, pointed, el).then(n => {
    if (el.cancelled) return
    el.classList.add(n ? 'done' : 'skip')
    leave(el, n ? 1400 : 900)
  }).catch(e => {
    if (el.cancelled) return
    el.classList.add('err')
    el.querySelector('small').textContent = e.message
    leave(el, 6000)
    tele({ event: 'code_edit', cmd, error: e.message, ms: Math.round(performance.now() - t0) })
  }).finally(unpoint)
}

// change runs one phrase: the files, the model, the edit. It returns the number of changed files.
async function change(cmd, pointed, el) {
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
  try {
    const texts = await Promise.all(paths.map(read))
    const user = 'Files:\n' + paths.map((p, i) => `--- ${p}\n${texts[i]}`).join('\n\n')
      + (said.length ? `\n\nSaid before, oldest first. Each was done. When the new speech repeats one, that change did not work: do it another way, and enough to be visible:\n${said.join('\n')}` : '')
      + `\n\nPointer:\n${pointed?.text || `(the user held no key to point. The element ${hover ? 'under the mouse' : 'in the middle of the screen'}: ${bare(target)})`}\n\nSpeech:\n${cmd}`
    if (t.versions) return await versions(cmd, user, Object.fromEntries(paths.map((p, i) => [p, texts[i]])), ac.signal, el)
    const reply = await ask(user, ac.signal, name => el.querySelector('b').textContent = name, shots(pointed?.zone, pointed?.marks))
    if (/^\s*(<!--[\s\S]*?-->\s*)?SAME\s*$/.test(reply)) return 0
    const blocks = edits(reply)
    if (!blocks.length) throw new Error('The model gave no edit')
    const byFile = Map.groupBy(blocks, b => b[1])
    // Read each file again: another phrase may have changed it while this one waited. The blocks name their text, so they still fit.
    const next = await Promise.all([...byFile].map(async ([file, bs]) => [file, apply(await read(file), bs.map(b => [b[2], b[3]]))]))
    const bad = next.find(([, text]) => !text)
    if (bad) throw new Error('The edit did not fit ' + bad[0])
    if (el.cancelled) return 0
    const shown = pointed?.els?.length ? pointed.els : [target]
    await sweep(box(shown.filter(e => e.isConnected)), async () => { for (const [file, text] of next) await write(file, text) })
    said = [...said, `- "${cmd}" → ${blocks.map(b => b[1]).filter((f, i, a) => a.indexOf(f) === i).join(', ')}: ${blocks.map(b => b[3].trim().slice(0, 120).replace(/\s+/g, ' ')).join(' | ')}`].slice(-5)
    try { sessionStorage.setItem('verbally.said', JSON.stringify(said)) } catch {}
    // One long phrase can hold several requests: the model names each task, and each one gets its own card.
    for (const [, name] of [...reply.matchAll(/<!--\s*task:\s*([\s\S]*?)-->/g)].slice(1)) {
      const c = chip('', 'done')
      c.querySelector('b').textContent = name.trim()
      leave(c, 1400)
    }
    tele({ event: 'code_edit', cmd, files: next.map(n => n[0]), blocks: blocks.length, ms: Math.round(performance.now() - t0) })
    return next.length
  } finally {
    for (const e of pointed?.els || [target]) e.classList.remove('glow')
  }
}

const edits = reply => [...reply.matchAll(/<<< *(\S+)\n([\s\S]*?)\n===\n([\s\S]*?)\n?>>>/g)]
const write = (file, text, noundo) => fetch(VB + '/api/file?path=' + encodeURIComponent(file) + (noundo ? '&noundo=1' : ''), { method: 'POST', body: text })

// versions builds several versions of a change side by side and shows them in the picker. A click writes that version
// into the files, so the dev server shows it on the live app. "Use this" keeps it as one undo step; "Cancel" puts the files back.
// ponytail: another phrase on the same files while the picker is open is lost on Cancel. Lock the files if that happens.
const CODE_IDEAS = [
  'the most compact and quiet one',
  'the most visual one: icons, colour, a clear state',
  'a different arrangement of the same content',
  'the boldest one, that a person notices at once',
  'the most familiar one, as in well-known products',
]
function versions(cmd, user, base, signal, el) {
  const n = Math.min(CODE_IDEAS.length, howMany(cmd))
  let shown = base, built = 0, writes = Promise.resolve()
  // Writes go one after another: two writes of one file at once can land in either order.
  const queue = job => writes = writes.then(job)
  const show = files => queue(async () => { for (const [f, text] of Object.entries(files)) if (text !== shown[f]) await write(f, text, true); shown = { ...shown, ...files } })
  return new Promise((done, fail) => {
    const finish = keep => {
      $('pick').hidden = true
      el.stop = null
      show(base) // the files as they were; a kept version is then written once more, as one step to undo
      queue(async () => { if (keep) for (const [f, text] of Object.entries(keep)) if (text !== base[f]) await write(f, text) })
        .then(() => done(keep ? Object.keys(keep).length : 0))
    }
    el.stop = () => { $('pick').hidden = true; show(base) }
    pickOpen(`Building ${n} versions…`, false, () => finish(null))
    Promise.all(CODE_IDEAS.slice(0, n).map(async (idea, k) => {
      const reply = await ask(user + `\n\nThe speaker will choose from ${n} versions. This is version ${k + 1}: ${idea}. Make it clearly different from the others.`, signal, () => {}).catch(() => '')
      const byFile = Map.groupBy(edits(reply), b => b[1])
      const files = Object.fromEntries([...byFile].map(([f, bs]) => [f, apply(base[f] ?? '', bs.map(b => [b[2], b[3]]))]))
      if (!byFile.size || Object.values(files).some(t => !t) || $('pick').hidden) return
      const name = reply.match(/<!--\s*task:\s*([\s\S]*?)-->/)?.[1].trim() || 'Version ' + (k + 1)
      pickAdd(Object.assign(document.createElement('span'), { className: 'label', textContent: name }), () => show(files), () => finish(files))
      $('pickTitle').textContent = ++built < n ? `Building ${n} versions… ${built} ready` : 'Pick a version'
    })).then(() => { if (!built && !$('pick').hidden) { $('pick').hidden = true; fail(new Error('No version fit the files')) } })
  })
}

// ask streams the reply of the design engine. The reply starts with the task name; onName shows it at once.
// ponytail: a copy of the stream reading in model.js. Share it when a third mode needs it.
async function ask(user, signal, onName, shown) {
  const res = await fetch(VB + '/api/claude', { signal, method: 'POST', headers: { 'Content-Type': 'application/json' },
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
  tele({ event: 'cancel', text: el.querySelector('small').textContent })
  el.classList.add('skip')
  leave(el, 300)
}

// Undo puts back the file from before the last change; redo puts the change back. Clear belongs to the page mode.
function travel(step) {
  fetch(VB + '/api/undo' + (step > 0 ? '?redo=1' : ''), { method: 'POST' })
    .then(r => r.text().then(t => r.ok ? leave(chip((step > 0 ? 'Redone: ' : 'Undone: ') + t, 'done'), 1400) : note(t)))
}
$('tools').classList.add('open')
$('clear').hidden = true
$('back').disabled = $('fwd').disabled = false
$('back').dataset.tip = 'Undo the last code change · ⌘Z'
$('fwd').dataset.tip = 'Redo · ⇧⌘Z'
// Start the engine now, so the first phrase does not wait for it.
fetch(VB + '/prompt-code.txt').then(r => r.text()).then(t => fetch(VB + '/api/claude', { method: 'POST', body: JSON.stringify({ model: MODEL, effort: EFFORT, messages: [{ content: t }] }) })).catch(() => {})
// Test hooks: ?vsay=phrase&vpoint=css selector&vwait=ms says a phrase while pointing at that element, without hands.
if (q.get('vsay')) setTimeout(() => {
  const t = q.get('vpoint') && document.querySelector(q.get('vpoint'))
  if (t) point = { sec: document.body, els: [t], text: t.outerHTML.slice(0, 300) }
  hear(q.get('vsay'), true)
}, +(q.get('vwait') || 4000))
// ?vpick=N&vkeep=1: when the versions are ready, show version N; with vkeep, press "Use this" 4 s later.
if (q.get('vpick')) {
  const wait = setInterval(() => {
    const b = $('pick').querySelectorAll('.grid button')[q.get('vpick') - 1]
    if (!b || $('pick').hidden) return
    clearInterval(wait)
    b.click()
    if (q.get('vkeep')) setTimeout(() => $('pickUse').click(), 4000)
  }, 500)
}
