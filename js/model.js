// From speech to the model: Jev sorts a phrase, hear routes it to a section, pump and ask get the new HTML.

// triage asks Jev about a phrase. The answer is kept, so a question that was asked while the user still spoke costs no time at the end of the phrase.
const triaged = new Map()
let triageTimer

// The answer holds `secs`, the sections that Jev saw: `target` is a number in that list, 'new' or 'all'.
function triage(text) {
  if (!JEV) return Promise.resolve({})
  const secs = live()
  const key = secs.length + ' ' + text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() // the final text differs from the half-heard text in punctuation only
  if (!triaged.has(key)) triaged.set(key, fetch('/api/triage', { method: 'POST', body: JSON.stringify({ text, sections: secs.map(label) }) })
    .then(r => r.json()).catch(() => ({})).then(t => ({ ...t, secs })))
  return triaged.get(key)
}

// hear takes text from any source: microphone partial, microphone final, a test.
// A final phrase goes to Jev, then to its section:
//   1. the section that the user pointed at with ⌥ during the phrase;
//   2. the target that Jev names: a new section, every section, or one section by its name or place;
//   3. the section of the phrase before, when that phrase is at most 12 s old ("and make it blue");
//   4. the section in the middle of the screen.
let gate = Promise.resolve() // keeps the phrases in the order of speech while Jev answers
let spoke = null // the pointer that was there during this phrase
let last = { sec: null, at: 0 }
function inView() {
  const secs = live(), mid = innerHeight / 2
  return secs.find(sec => { const r = sec.getBoundingClientRect(); return r.top <= mid && r.bottom >= mid }) || secs.at(-1) || cur
}
// A new section goes to the end of the page, but above a footer.
const above = () => { const end = live().at(-1); return isFooter(end) ? end.previousSibling : end }
function hear(text, final) {
  const cmd = text.replace(/^[\s.,;:!?-]+/, '').trim() // the recognizer leaves punctuation at the start
  if (point) spoke = point
  UI.update({ live: final ? '' : cmd })
  if (!final) {
    if (!WAIT) { cur.partial = cmd; cur.heardAt = performance.now(); pump(cur) }
    // The user made a short stop: ask Jev now. The end of the phrase comes 0.5 s later and finds the answer ready.
    clearTimeout(triageTimer)
    if (cmd) triageTimer = setTimeout(() => triage(cmd), 200)
    return
  }
  cur.partial = ''
  if (!cmd) return
  const heardAt = performance.now(), pointed = spoke, seen = inView() // where the user points and looks now, not when Jev answers
  spoke = null
  const el = chip(cmd)
  tele({ event: 'heard', text: cmd })
  // The first build is still running: wait for its sections. Else the phrase joins the one empty section, that section
  // becomes the header after the split, and the phrase finds nothing there and goes to every other section.
  const built = async () => { while (!live().length && cur?.busy) await new Promise(r => setTimeout(r, 200)) }
  gate = gate.then(built).then(() => triage(cmd)).then(t => {
    if (el.cancelled) return
    if (t.filler) { // nothing to act on: Claude never gets it
      el.update({ kind: 'skip' })
      leave(el, 900)
      tele({ event: 'filler', text: cmd })
      return
    }
    const ok = sec => sec?.isConnected && sec
    const named = ok(t.secs?.[t.target]), recent = heardAt - last.at < 12000 && ok(last.sec)
    const one = !live().length ? cur : ok(pointed?.sec) || named || recent || ok(seen) || cur
    if (t.versions) {
      one.queued.push(cmd) // kept for a reload until the layout job starts and keeps itself
      keepTodo()
      versions(one, cmd, el).catch(e => note(e.message)) // not awaited: the layouts take a minute, and the phrases after this one must not wait for them
      return
    }
    const direct = !live().length || ok(pointed?.sec)
    const targets = !direct && t.target === 'all' ? live() : [!direct && t.target === 'new' ? newSection(above()) : one]
    tele({ event: 'route', text: cmd, by: direct ? (live().length ? 'pointer' : 'empty') : t.target ?? (recent ? 'recent' : 'view'), sections: targets.map(sec => [...$('canvas').children].indexOf(sec)) })
    el.n = targets.length
    for (const sec of targets) {
      if (t.look) { sec.look = true; el.update({ look: true }) }
      if (sec === pointed?.sec) sec.point = pointed.text, sec.zone = pointed.zone
      sec.heardAt = heardAt
      sec.pending = (sec.pending + ' ' + cmd).trim()
      sec.phrases.push({ text: cmd, el, all: targets.length > 1, pointed: sec === pointed?.sec })
    }
    keepTodo()
    select(targets[0])
    if (!targets[0].html) targets[0].scrollIntoView({ block: 'center', behavior: 'smooth' }) // a new section: show where it grows
    if (targets.length === 1) last = { sec: targets[0], at: heardAt }
    // A change of the whole page: the first section changes first, then the others see it and follow it.
    pump(targets[0]).then(() => targets.slice(1).forEach(pump))
  }).catch(e => note(e.message)) // one bad phrase must not stop the phrases after it
}

// pump keeps one request per section in flight. A request is never cancelled:
// with cancel, steady speech restarts the request on every word and the screen stays empty until a pause.
// When a request ends, pump starts the next one with all speech that arrived meanwhile.
async function pump(sec) {
  if (sec.busy) return
  const p = sec.preview
  // The shown HTML was built from final speech only: it becomes the new base.
  if (p && sec.pending.startsWith(p.cmd) && !/\S/.test(sec.pending[p.cmd.length] || ' ')) {
    sec.html = p.html
    sec.said = (sec.said + ' ' + p.cmd).trim()
    sec.pending = sec.pending.slice(p.cmd.length).trim()
    sec.preview = null
    sec.point = '' // the next speech needs a fresh pointer
    settle(sec)
    sweep(sec.getBoundingClientRect()) // the change is done: the band says so
    keepTodo() // save() writes the list only when the page changed; a phrase that changed nothing must leave the list too, or a reload says it again
    unpoint()
    if (sec.moveTo) { // the other sections keep their order; this one goes to its new place
      const others = live().filter(o => o !== sec), at = Math.max(0, Math.min(others.length, sec.moveTo - 1))
      const draw = () => others[at] ? others[at].before(sec) : others.at(-1)?.after(sec)
      smooth(draw)
      sec.moveTo = 0
      setTimeout(() => sec.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)
    }
    split(sec)
    save()
    offer()
    return pump(sec)
  }
  const cmd = (sec.pending + ' ' + sec.partial).trim()
  if (!cmd || p?.cmd === cmd) return // nothing new: the final text often equals the last partial text
  sec.busy = true
  sec.classList.add('busy')
  sec.asking = cmd
  sec.ac = new AbortController()
  const html = await ask(sec, cmd, false, '', sec.ac.signal)
  sec.busy = false
  sec.classList.remove('busy')
  if (sec.ac.signal.aborted) return pump(sec) // a phrase was cancelled: ask again with the speech that is left
  if (!html) return // the error is on screen; the next speech tries again
  // Claude found nothing to change here: the phrase came to the wrong section. Not for a phrase the user pointed with:
  // the place was chosen by hand, and an unfinished phrase ("here the word con-... no, nothing") must not go to every section.
  // Every other section gets it; each changes or says the same.
  if (html === sec.html && !sec.moveTo) for (const p of sec.phrases.filter(p => !p.all && !p.pointed && cmd.includes(p.text))) {
    p.all = true
    const others = live().filter(o => o !== sec)
    tele({ event: 'reroute', text: p.text, sections: others.length })
    p.el.n += others.length
    for (const o of others) {
      o.heardAt = sec.heardAt
      o.pending = (o.pending + ' ' + p.text).trim()
      o.phrases.push(p)
      pump(o)
    }
  }
  sec.preview = { cmd, html }
  return pump(sec)
}

// cancel drops a phrase that the user no longer wants. Its request stops, its preview leaves the page,
// and the section asks again with the other speech that waits. Cancel on a layout job closes the picker.
function cancel(el) {
  el.cancelled = true
  for (const sec of $('canvas').children) for (const p of sec.phrases.filter(p => p.el === el)) {
    sec.phrases.splice(sec.phrases.indexOf(p), 1)
    sec.pending = sec.pending.replace(p.text, '').replace(/\s+/g, ' ').trim()
    if (sec.preview?.cmd.includes(p.text)) { sec.preview = null; show(sec, sec.html) }
    if (sec.busy && sec.asking?.includes(p.text)) sec.ac?.abort()
  }
  el.stop?.()
  keepTodo()
  tele({ event: 'cancel', text: el.text })
  el.update({ kind: 'skip' })
  leave(el, 300)
}

// saidBefore is the speech that built the page: other sections first, this section last.
// So a wish that the user spoke for one section ("artwork, not a real photo") holds for the next one too.
// ponytail: the last 4000 characters. Keep a summary of standing wishes when pages get long.
const saidBefore = sec => [...$('canvas').children].filter(o => o !== sec).concat(sec).map(o => o.said).filter(Boolean).join('\n').slice(-4000)

// ask sends the base HTML and the new speech to the model, shows the answer and returns it. It returns '' after an error.
async function ask(sec, cmd, full, version, signal) { // version: text for one of several layouts; such a request draws nothing on the page
  const t0 = performance.now(), heardAt = sec.heardAt
  const look = sec.look // Jev said that this speech judges the look: Claude gets a screenshot
  const shown = shots(sec.zone) // what the user drew with ⌥: Claude gets the window with the ink on it
  sec.look = false
  sec.zone = null
  let html = '', first = 0
  // One telemetry line per request. `wait` and `total` count from the last heard word: that is the delay the user feels.
  const log = { id: Math.random().toString(36).slice(2, 10), engine: ENGINE, model: MODEL, effort: EFFORT, cmd,
    retry: !!full && !version, version: !!version, look, partial: !!sec.partial, pointer: !!sec.point, base_chars: sec.html.length, wait_ms: Math.round(t0 - heardAt) }
  UI.update({ busy: ++asks > 0 })
  if (sec.point && point?.sec === sec) for (const el of point.els) el.classList.add('glow') // the user points at it: it changes
  try {
    const res = await fetch(engineURL(), {
      signal, method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: log.id, model: MODEL, effort: EFFORT, look, shots: shown, window: document.title, stream: true, temperature: 0, reasoning: { effort: EFFORT },
        ...(ENGINE === 'openrouter' && PROVIDER && { provider: { only: [PROVIDER] } }),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Page font: ${pageFont || 'none'}\n\nOther sections of the page:\n${live().map((o, i) => o === sec ? '' : `[section ${i + 1}]\n${o.html}`).filter(Boolean).join('\n') || '(none)'}\n\nCurrent HTML${sec.html ? ` (section ${live().indexOf(sec) + 1} of ${live().length})` : ''}:\n${sec.html || '(empty)'}\n\nSaid before:\n${saidBefore(sec) || '(nothing)'}\n\nPointer:\n${sec.point || '(none)'}\n\nNew speech:\n${cmd}${siteStyled ? '\n\nThis page is an existing site with its own stylesheet. Build new parts from the classes that its sections already use, so they look the same; use Tailwind only for what those classes do not cover.' : ''}${full ? '\n\nReply with the full section.' : ''}${version || ''}` },
        ],
      }),
    })
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 200))
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += value
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) {
        if (!line.startsWith('data: {')) continue
        const d = JSON.parse(line.slice(6))
        if (d.reset) html = '' // the model used a tool: the text before it was not the reply
        html += d.choices?.[0]?.delta?.content || ''
      }
      // The reply starts with a name of the task: the cards of its phrases show it.
      const name = !version && html.match(/<!--\s*task:\s*([\s\S]*?)-->/)?.[1].trim()
      if (name) for (const p of sec.phrases) if (cmd.includes(p.text)) p.el.update({ title: name })
      if (html && !first) first = performance.now() - t0
      // A new section grows token by token. An edit swaps once at the end, so the section does not collapse and regrow.
      if (version) continue
      if (!sec.html && html.trimStart().startsWith('<')) show(sec, html.slice(0, html.lastIndexOf('>') + 1))
      // An edit names the text it replaces first. The element with that text glows until the edit lands.
      if (sec.html) for (const [, from] of html.matchAll(/<<<\n([\s\S]+?)\n===/g)) glow(sec, from)
    }
    const move = !version && +html.match(/<!--\s*move:\s*(\d+)\s*-->/)?.[1] // the speech moves this section to that place, counted from the top
    if (move) sec.moveTo = move
    html = clean(html)
    if (html === 'SAME') html = sec.html // nothing in this section must change
    Object.assign(log, { first_ms: Math.round(first), stream_ms: Math.round(performance.now() - t0), reply_chars: html.length, reply: html, kind: /^<<<$/m.test(html) ? 'edit' : 'full' }) // a full section can start with any tag: <header>, <footer>, <a> on an imported site
    if (log.kind === 'edit') log.fit = !!patch(sec.html, html)
    // A short reply holds edit blocks. Blocks that do not fit the base get one more request for the full section.
    if (log.kind === 'edit') html = patch(sec.html, html) || (full ? '' : await ask(sec, cmd, true, version, signal))
    if (!html) throw new Error('the model returned no HTML')
    if (!version) show(sec, html)
    return html
  } catch (e) {
    log.error = e.message
    if (e.name !== 'AbortError') note(e.message) // the user cancelled the layouts: no error
    return ''
  } finally {
    UI.update({ busy: --asks > 0 })
    log.done_ms = Math.round(performance.now() - t0)
    log.total_ms = Math.round(performance.now() - heardAt)
    tele(log)
  }
}
let asks = 0 // requests in flight


// patch applies edit blocks (<<< old === new >>>) to the base HTML. An edit of one class is 10 tokens, not the whole section.
// It returns '' when the reply has no block or a block does not match the base exactly once.
function patch(base, reply) {
  let n = 0
  for (const [, from, to] of reply.matchAll(/<<<\n([\s\S]*?)\n===\n([\s\S]*?)\n?>>>/g)) {
    if (!from || base.split(from).length !== 2) return ''
    base = base.replace(from, () => to)
    n++
  }
  return n ? base : ''
}
check(patch('<h1 class="a">x</h1><img>', '<<<\nclass="a"\n===\nclass="b"\n>>>\n<<<\n<img>\n===\n>>>') === '<h1 class="b">x</h1>', 'patch')
check(patch('<p><p>', '<<<\n<p>\n===\n<b>\n>>>') === '', 'patch must refuse a text that occurs twice')
