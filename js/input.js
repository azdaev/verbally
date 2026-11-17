// Input: pointing with ⌥ Option, the microphone, keys and the bar buttons.

// Pointing: hold ⌥ Option and move the mouse. Only then the model sees the mouse, so "here" and "this one" work.
// The mouse can pass over several elements ("these cards"): the model gets all of them, up to 8.
// The trail tells the user that the mouse is seen now. The marked elements stay marked until the next speech uses them.
let point = null // { sec, els, text, zone } - what the user pointed at last
let pointTimer
// The zone is the box that the mouse covers while ⌥ is held. The user picks a place with the eyes, not by elements:
// the model gets a picture of the zone first, and the elements under it as extra detail.
let zone = null // { l, t, r, b } in page-window pixels
const zoneBox = UI.root.appendChild(Object.assign(document.createElement('div'), { id: 'zone' }))
// Marks: the mouse stops for 0.4 s with ⌥ held, and a numbered square ① ② appears there. The words that the user said
// at that moment get the same number ("this ① is bad, make it like this ②"), so the model knows which place each word means.
// Accidental stops are fine: the model gets every mark with the words around it and ignores a mark that no word needs.
const NUM = '①②③④⑤⑥⑦⑧⑨'
let marks = [], stillTimer, markCount = 0
function addMark(x, y) {
  const last = marks.at(-1)
  if (last && Math.hypot(last.x - x, last.y - y) < 60) return // the same place: one mark
  const w = 300, h = 200, l = Math.max(0, Math.min(x - w / 2, innerWidth - w)), t = Math.max(0, Math.min(y - h / 2, innerHeight - h))
  let el = document.elementFromPoint(x, y)?.closest(CODE ? '[data-vsrc]' : '#canvas > div *')
  if (el?.closest('verbally-ui')) el = null
  const m = { n: NUM[Math.min(markCount++, 8)], x, y, l, t, r: l + w, b: t + h, at: performance.now() - 400, el, html: el ? bare(el) : '' }
  m.box = UI.root.appendChild(Object.assign(document.createElement('div'), { className: 'vb-mark', innerHTML: `<span>${m.n}</span>` }))
  Object.assign(m.box.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' })
  marks.push(m)
  if (marks.length > 4) marks.shift().box.remove() // ponytail: the last 4 stops; a longer tour of the page is rare
  if (point) point.text = pointText()
}
// bare gives the HTML of an element without the tool's own classes, short.
function bare(o, n = 300) {
  const copy = o.cloneNode(true)
  for (const c of [copy, ...copy.querySelectorAll('.point, .glow')]) { c.classList.remove('point', 'glow'); if (!c.classList.length) c.removeAttribute('class') }
  return copy.outerHTML.slice(0, n)
}
let pointBase = ''
const pointText = () => pointBase + marks.map(m => `\nMark ${m.n}, the element in its middle: ${m.html || '(none)'}`).join('')
const trail = $('trail'), ink = trail.getContext('2d')
let dots = []

addEventListener('mousemove', e => {
  if (!e.altKey || UI.isUIEvent(e) || settingsOpen()) return
  if (!dots.length) requestAnimationFrame(drawTrail)
  dots.push({ x: e.clientX, y: e.clientY, t: performance.now() })
  const x0 = e.clientX, y0 = e.clientY
  zone = zone ? { l: Math.min(zone.l, x0), t: Math.min(zone.t, y0), r: Math.max(zone.r, x0), b: Math.max(zone.b, y0) } : { l: x0, t: y0, r: x0, b: y0 }
  const pad = 16 // the drawn box holds the stroke with some air around it
  Object.assign(zoneBox.style, { left: zone.l - pad + 'px', top: zone.t - pad + 'px', width: zone.r - zone.l + 2 * pad + 'px', height: zone.b - zone.t + 2 * pad + 'px' })
  zoneBox.classList.add('on')
  if (point) point.zone = zone
  clearTimeout(stillTimer)
  stillTimer = setTimeout(() => addMark(x0, y0), 400)
  const el = e.target.closest(CODE ? '[data-vsrc]' : '#canvas > div *')
  if (!el || el.closest('#bar, #tasks')) return
  const sec = CODE ? document.body : el.closest('#canvas > div') // code mode has no sections: the whole app is one place
  if (!CODE && sec !== cur) select(sec)
  if (point?.sec !== sec) unpoint() // one phrase, one section: the last section wins
  point ||= { sec, els: [], text: '', zone, marks }
  // On the way from one element to the next the mouse crosses the box that holds them. So an element that holds a marked element does not count.
  const els = [...new Set([...point.els, el])].filter((a, _, all) => !all.some(b => a !== b && a.contains(b))).slice(-8)
  for (const o of point.els) o.classList.remove('point')
  for (const o of els) o.classList.add('point')
  const r = sec.getBoundingClientRect()
  const x = Math.round((e.clientX - r.left) / r.width * 100), y = Math.round((e.clientY - r.top) / r.height * 100)
  point.els = els
  pointBase = (els.length > 1 ? `The mouse passed over ${els.length} elements:\n` : '') + els.map(o => bare(o, els.length > 1 ? 200 : 300)).join('\n') + `\nMouse position now: ${x}% from the left, ${y}% from the top of the section.`
  point.text = pointText()
  const name = els.length > 1 ? els.length + ' elements' : el.innerText.trim().slice(0, 18) || el.localName
  if (UI.getSnapshot().pointer !== name) UI.update({ pointer: name })
  clearTimeout(pointTimer)
  // Nobody spoke: forget it. While the microphone is on, the user still talks about it.
  // A dictation app gives its text only after the speech, so there the pointer waits longer.
  pointTimer = setTimeout(() => on || unpoint(), dictation ? 30000 : 8000)
})
// The place of the mouse, with or without ⌥: a phrase with no pointer is about the element under the mouse.
let mouse = null
addEventListener('mousemove', e => { mouse = { x: e.clientX, y: e.clientY } }, true)
const underMouse = () => {
  const el = mouse && document.elementFromPoint(mouse.x, mouse.y)
  return el && !el.closest('verbally-ui') ? el : null
}

function unpoint() {
  for (const el of point?.els || []) el.classList.remove('point')
  point = null
  zone = null
  zoneBox.classList.remove('on')
  clearTimeout(stillTimer)
  for (const m of marks) m.box.remove()
  marks = []
  markCount = 0
  UI.update({ pointer: '' })
}

function drawTrail() {
  const now = performance.now(), dpr = devicePixelRatio
  if (trail.width !== innerWidth * dpr) { trail.width = innerWidth * dpr; trail.height = innerHeight * dpr }
  dots = dots.filter(d => now - d.t < 600)
  ink.setTransform(dpr, 0, 0, dpr, 0, 0)
  ink.clearRect(0, 0, innerWidth, innerHeight)
  ink.lineCap = 'round'
  for (const [colour, width] of [['255,255,255', 9], ['99,102,241', 5]]) { // white under indigo: visible on any background
    for (let i = 1; i < dots.length; i++) {
      const age = 1 - (now - dots[i].t) / 600
      ink.strokeStyle = `rgba(${colour},${age * .9})`
      ink.lineWidth = width * age
      ink.beginPath()
      ink.moveTo(dots[i - 1].x, dots[i - 1].y)
      ink.lineTo(dots[i].x, dots[i].y)
      ink.stroke()
    }
  }
  if (dots.length) requestAnimationFrame(drawTrail)
}

// Dictation: the user's own dictation app (Hex, Handy, Wispr Flow) listens, and its text arrives as a paste (⌘V).
// Then Verbally's own microphone stays off for the keys: ⌥ only points, Space is a plain key. A click on the microphone still starts it.
// Tested with Hex: its paste reaches a page that has no text field in focus.
// The server finds a running dictation app (GET /api/setup). ?speech=mic or ?speech=dictation in the address wins.
let LANG = q.get('lang') || localStorage.getItem('verbally.lang') || 'en-US' // for the recognizer of Chrome; Soniox and a dictation app find the language themselves
let dictation = q.get('speech') === 'dictation'
let talk = {} // { app, key, code, recognizer } from the server: the dictation app that runs, and its talk key

// Settings (the gear): a window with three parts: voice, model, keys.
// A choice stays in the browser. ?speech=, ?lang= and ?model= in the address win over it.
const settingsOpen = () => UI.getSnapshot().settingsOpen
function showSettings() {
  UI.update({ settings: { dictation, lang: LANG, model: MODEL, talk } })
}
showSettings()
UI.actions.setting = (name, value) => {
  localStorage.setItem('verbally.' + name, value)
  if (name === 'speech') dictation = value === 'dictation'
  if (name === 'lang') LANG = value
  if (name === 'model') MODEL = value
  showSettings()
}
fetch(VB + '/api/setup').then(r => r.json()).then(d => {
  const once = name => !sessionStorage.getItem(name) && (sessionStorage.setItem(name, 1), true) // once for a tab, not at each reload after an edit
  if (d.update && once('verbally.update')) { // a newer release: say it, change nothing
    const c = chip('To get it, run in the terminal: verbally update', 'done')
    c.update({ title: `Verbally ${d.update} is out` })
    leave(c, 9000)
  }
  talk = d
  // Who wins: ?speech= in the address, then the user's choice in the settings, then what the server found.
  dictation = (q.get('speech') || (d.app && localStorage.getItem('verbally.speech')) || d.speech) === 'dictation'
  showSettings()
  if (!dictation || !once('verbally.told')) return
  const c = chip(d.key ? `Hold ${d.key}, point and talk` : 'Use its key, point with the mouse and talk', 'done')
  c.update({ title: 'Speech: ' + (d.app || 'your dictation app') })
  leave(c, 7000)
}).catch(() => {})
addEventListener('paste', e => {
  if (!dictation || settingsOpen() || UI.isUIEvent(e)) return
  // A paste into a text field of the app is the app's own business.
  if (isTextInput(e)) return
  const text = (e.clipboardData?.getData('text/plain') || '').trim()
  // ponytail: any ⌘V outside a text field counts as speech. The size limit keeps a pasted file out; undo covers the rest.
  if (!text || text.length > 1000) return
  e.preventDefault()
  e.stopPropagation()
  tele({ event: 'dictation', chars: text.length })
  hearsDone()
  hear(text, true)
}, true)

// Microphone. Soniox gives fast partial text. A phrase ends when the talk key goes up or the microphone goes off. Without a working Soniox key the browser recognizer takes over.
let on = false, stopMic = () => {}
async function toggleMic() {
  on = !on
  UI.update({ mic: on })
  on ? waveOn() : waveOff()
  if (!on) return stopMic()
  const t0 = performance.now()
  const stop = await soniox().then(s => (tele({ event: 'mic', recognizer: 'soniox', start_ms: Math.round(performance.now() - t0) }), s))
    .catch(e => { tele({ event: 'mic', recognizer: 'browser', why: e.message }); return webSpeech() })
  if (on) stopMic = stop
  else stop() // the key went up while the microphone started
}

// Wave: five bars next to the microphone while someone listens, so the user sees that the speech goes in.
// Verbally's microphone: the bars follow the real loudness. A dictation app: Verbally has no audio of it,
// so the bars move while the app's talk key is held, and the bar waits for its text after that.
const bars = [...$('wave').children]
let waveCtx = null, hearsAt = 0, hearsTimer
async function waveOn() {
  UI.update({ recording: true })
  try { micStream ||= await navigator.mediaDevices.getUserMedia({ audio: true }) } catch { return }
  if (!on || waveCtx) return
  const ctx = waveCtx = new AudioContext(), an = ctx.createAnalyser(), data = new Uint8Array(32)
  an.fftSize = 64
  ctx.createMediaStreamSource(micStream).connect(an)
  const draw = () => {
    if (waveCtx !== ctx) return
    an.getByteFrequencyData(data) // the voice is in the low bins
    bars.forEach((b, i) => b.style.scale = `1 ${.2 + Math.min(1, data[1 + i * 2] / 200) * .8}`)
    requestAnimationFrame(draw)
  }
  draw()
}
function waveOff() {
  UI.update({ recording: false })
  waveCtx?.close()
  waveCtx = null
  for (const b of bars) b.style.scale = ''
}
const says = text => UI.update({ live: text })
function hearsOn() {
  clearTimeout(hearsTimer)
  hearsAt = performance.now()
  UI.update({ waiting: false })
  UI.update({ hears: true })
  says(talk.app + ' is listening…')
}
function hearsOff() {
  if (!hearsAt) return
  const held = performance.now() - hearsAt
  hearsAt = 0
  UI.update({ hears: false })
  if (held < 400) return hearsDone() // a tap: the app records nothing
  UI.update({ waiting: true })
  says('Waiting for ' + talk.app + '…')
  hearsTimer = setTimeout(() => {
    hearsDone()
    const c = chip(`Check that ${talk.app} has a microphone, and that it can paste into Chrome.`, 'err')
    c.update({ title: talk.app + ' gave no text' })
    leave(c, 7000)
  }, 8000)
}
function hearsDone() {
  clearTimeout(hearsTimer)
  UI.update({ hears: false, waiting: false })
  if (/ is listening…$|^Waiting for /.test(UI.getSnapshot().live)) says('')
}

// The first word must not be lost, so nothing may wait between the key press and the recording:
// - the microphone stream stays open after its first use;
// - prime starts the recording at the key press and keeps the audio until the Soniox socket is open;
// - a short-lived Soniox key is fetched before it is needed.
// The last word must not be lost either: stop sends the end of the audio and waits for the words that are still on their way.
// ponytail: the browser shows its microphone sign as long as the tab is open. Close the stream after idle time if that disturbs.
let micStream, primed, nextKey
async function prime() {
  micStream ||= await navigator.mediaDevices.getUserMedia({ audio: true })
  const rec = new MediaRecorder(micStream), chunks = []
  rec.ondataavailable = e => chunks.push(e.data)
  rec.start(100)
  return { rec, chunks, at: performance.now() } // Soniox times each word from the start of this recording
}
function fetchKey() {
  const key = fetch(VB + '/api/soniox').then(r => r.ok ? r.json() : Promise.reject(new Error('Soniox ' + r.status))).then(d => d.api_key)
  key.catch(() => {})
  return { at: performance.now(), key }
}
nextKey = fetchKey()
function sonioxKey() { // a key lives 10 minutes: use one that is at most 8 minutes old, and fetch the next one at once
  const k = nextKey && performance.now() - nextKey.at < 8 * 60e3 ? nextKey : fetchKey()
  nextKey = fetchKey()
  return k.key
}
async function soniox() {
  const take = primed || prime()
  primed = null
  let api_key
  try { api_key = await sonioxKey() } catch (e) { take.then(p => p.rec.stop()); throw e }
  const { rec, chunks, at } = await take
  const ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket')
  // The phrase ends only when the user lets the key go (or switches the microphone off): a pause to think never sends it.
  let words = [], live = '' // final words of the phrase with the time of each; the words that can still change
  let closed = false
  const close = () => { // the end of the audio and the 2 s timer both come here: the phrase goes once
    if (closed) return
    closed = true
    ws.close()
    const text = marked(words, marks) + live
    if (text.trim()) hear(text, true)
    words = [], live = ''
  }
  const stop = () => {
    if (rec.state === 'inactive') return close()
    rec.onstop = () => ws.readyState === 1 ? ws.send('') : close() // an empty frame tells Soniox that the audio is complete
    rec.stop()
    setTimeout(close, 2000) // Soniox did not answer: use the words that came
  }
  ws.onopen = () => {
    ws.send(JSON.stringify({ api_key, model: 'stt-rt-v5', audio_format: 'auto', language_hints: ['en', 'ru'],
      // Words the recognizer gets wrong without a hint. ?terms=Onest,Fujifilm adds the names of your own project.
      context: { terms: ['hero section', 'lorem ipsum', ...(q.get('terms') || '').split(',').filter(Boolean)] } }))
    for (const c of chunks) ws.send(c) // the audio from before the socket was open
    rec.ondataavailable = e => ws.readyState === 1 && ws.send(e.data)
  }
  ws.onclose = e => e.code !== 1000 && e.code !== 1005 && tele({ event: 'mic', closed: e.code, reason: e.reason })
  ws.onmessage = e => {
    const d = JSON.parse(e.data)
    if (d.error_message) { // for example a wrong key: continue with the browser recognizer
      rec.state !== 'inactive' && rec.stop()
      close()
      tele({ event: 'mic', recognizer: 'browser', why: d.error_message })
      if (on) stopMic = webSpeech()
      return
    }
    live = ''
    for (const t of d.tokens || []) {
      if (t.is_final) words.push({ text: t.text, at: at + t.start_ms })
      else live += t.text
    }
    if (d.finished) return close()
    const text = marked(words, marks) + live
    if (text.trim()) hear(text, false)
  }
  return stop
}

// marked puts the number of each mark into the words where the mouse stopped: "this ① is bad, like this ②".
// A mark goes before the first word that started after the stop, at a word border (Soniox splits words into pieces).
function marked(words, marks) {
  if (!words.length) return '' // marks without words are no phrase
  let text = '', i = 0
  for (const w of words) {
    while (i < marks.length && marks[i].at <= w.at && (/^\s/.test(w.text) || !text)) text += ' ' + marks[i++].n
    text += w.text
  }
  while (i < marks.length) text += ' ' + marks[i++].n
  return text
}
check(marked([{ text: 'вот', at: 0 }, { text: ' э', at: 100 }, { text: 'то', at: 150 }, { text: ' плохо', at: 300 }], [{ n: '①', at: 120 }]) === 'вот это ① плохо', 'marked word border')
check(marked([{ text: 'вот', at: 0 }, { text: ' это', at: 100 }, { text: ' плохо', at: 300 }], [{ n: '①', at: 200 }]) === 'вот это ① плохо', 'marked')

// ponytail: Web Speech API, Chrome only, audio goes to Google, the end of a phrase arrives late.
function webSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) { note('This browser has no speech recognition. Open the page in Chrome.'); return () => {} }
  const rec = new SR()
  rec.lang = LANG
  rec.continuous = true
  rec.interimResults = true
  let done = '', partial = '' // the phrase goes out at stop, like with Soniox
  rec.onresult = e => {
    partial = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) done += e.results[i][0].transcript + ' '
      else partial += e.results[i][0].transcript
    }
    hear(done + partial, false)
  }
  rec.onerror = e => { if (e.error !== 'no-speech') note('Microphone: ' + e.error) }
  rec.onend = () => on && rec.start() // Chrome stops after silence
  rec.start()
  return () => { on = false; rec.stop(); if ((done + partial).trim()) hear(done + partial, true); done = partial = '' }
}

UI.actions.mic = toggleMic
UI.actions.undo = () => travel(-1)
UI.actions.redo = () => travel(1)
UI.actions.cancel = task => cancel(task)
// Clear needs no question: it is one more step of the history, so undo brings the page back.
UI.actions.clear = () => smooth(() => { paint([]); save() })
// ⌘Z in a text field is the field's own undo, not the page's.
addEventListener('keydown', e => { if (!settingsOpen() && e.metaKey && e.code === 'KeyZ' && !isTextInput(e)) { e.preventDefault(); travel(e.shiftKey ? 1 : -1) } })
// The model cannot check an image address. A broken image gets a photo from the local photo store, found by its alt text.
$('canvas')?.addEventListener('error', e => {
  const img = e.target
  if (img.tagName !== 'IMG' || img.dataset.retried) return
  img.dataset.retried = 1
  tele({ event: 'broken_image', url: img.getAttribute('src'), alt: img.alt })
  if (!img.getAttribute('src')?.startsWith('/photo')) img.src = '/photo?q=' + encodeURIComponent(img.alt || 'photograph')
}, true)
// Space: hold to talk (push to talk), or tap to switch the microphone on and off.
let downAt = 0, wasOn = false
addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.target !== document.body || settingsOpen()) return
  if (dictation) { if (e.altKey) e.preventDefault(); return } // a dictation key like ⌥ Space must not scroll the page
  e.preventDefault()
  if (e.repeat) return
  downAt = performance.now()
  wasOn = on
  if (!on) toggleMic()
})
addEventListener('keyup', e => {
  if (e.code !== 'Space' || !downAt) return
  const held = performance.now() - downAt > 350
  downAt = 0
  if (on && (held || wasOn)) toggleMic()
})

// ⌥ Option held: point and talk with one key. The 0.2 s wait keeps shortcuts like ⌥⌘I and ⌥-letters from switching the microphone on.
let cmdTimer, cmdTalk = false, deaf
addEventListener('keydown', e => {
  clearTimeout(cmdTimer)
  primed?.then(p => p.rec.stop()) // another key came: this is a shortcut, not speech
  primed = null
  if (e.key !== 'Alt' || on || settingsOpen()) return
  if (!e.repeat) unpoint() // a new press starts a new pointing
  if (dictation) { // the dictation app listens; here ⌥ only points
    if (talk.code === e.code && !e.repeat) hearsOn()
    // The other ⌥ than the app's talk key draws the trail too, so it looks like speech goes in. Say that nobody listens.
    if (talk.code && e.code !== talk.code && !e.repeat && !UI.getSnapshot().tasks.some(t => t.id === deaf?.id)) {
      deaf = chip(`To talk, hold ${talk.key}. This ⌥ only points.`, 'err')
      deaf.update({ title: talk.app + ' does not hear this key' })
      leave(deaf, 5000)
    }
    return
  }
  primed = prime() // record from the key press, so the first word is kept during the 0.2 s wait
  primed.catch(() => {})
  cmdTimer = setTimeout(() => { cmdTalk = true; toggleMic() }, 200)
})
const cmdUp = () => {
  clearTimeout(cmdTimer)
  if (!cmdTalk) { primed?.then(p => p.rec.stop()); primed = null }
  if (cmdTalk && on) toggleMic()
  cmdTalk = false
}
addEventListener('keyup', e => { if (e.key === 'Alt') { cmdUp(); if (e.code === talk.code) hearsOff() } })
addEventListener('blur', () => { cmdUp(); hearsOff() }) // switching windows leaves the window and the key-up never arrives
if (!CODE) $('canvas').onclick = e => { const sec = e.target.closest('#canvas > div'); if (sec) select(sec) }
// Test hook: ?vclick=css selector clicks it first (opens a menu); ?vmove=x,y;x,y moves the mouse with ⌥ held and stops at each point for 0.5 s, so marks ① ② appear without hands.
if (q.get('vmove')) setTimeout(async () => {
  document.querySelector(q.get('vclick'))?.click()
  await new Promise(r => setTimeout(r, 600))
  for (const [x, y] of q.get('vmove').split(';').map(p => p.split(',').map(Number))) {
    document.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, altKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 500))
  }
}, 3000)
