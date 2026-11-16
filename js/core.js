// Settings from the address, small helpers, telemetry and the task cards above the bar.

const q = new URLSearchParams(location.search)
// Calibration without a code edit: ?engine= ?model= ?provider= ?effort=
// The default engine is the local Claude Code CLI: best HTML, 3-5 s per request, no OpenRouter cost.
// ?engine=openrouter uses a fast model through OpenRouter: about 0.5 s per request, weaker HTML.
const CLAUDE = q.get('engine') !== 'openrouter'
const MODEL = q.get('model') || (CLAUDE ? 'claude-opus-5-5' : 'openai/gpt-oss-120b')
// The default provider belongs to the default model. Another model gets any provider unless ?provider= names one.
const PROVIDER = q.get('provider') || (q.get('model') ? '' : 'cerebras')
// Measured with Opus 5.5 on one hero section: medium thinks 10 s before the first token (22 s in all), low starts after 1.7 s (8-10 s in all).
const EFFORT = q.get('effort') || 'low'
// Claude needs 2-3 s for any request, so a request for a half-heard phrase ("Uh", "But") only blocks the real one.
// With Claude the model gets a phrase when the recognizer says it is complete. ?partial=1 brings back requests on half-heard speech.
const WAIT = CLAUDE && !q.get('partial')
// Jev, a fast yes/no model, reads each phrase before Claude. It drops filler ("okay", "uh") and tells when Claude must see the page ("this is ugly").
// ?nojev=1 switches it off.
const JEV = CLAUDE && !q.get('nojev')
// The page gives its window a name of its own, so the server can take a screenshot of the right window.
// Code mode: the tool runs as a widget on a running app (overlay.js) and changes its source files. VB is the address of the tool there.
const CODE = !!window.VERBALLY_CODE, VB = window.VERBALLY_BASE || ''
if (!CODE) document.title = 'Verbally ' + Math.random().toString(36).slice(2, 6)

const $ = id => document.getElementById(id)
// tele adds one event to telemetry.jsonl, so a lost phrase or a silent change of recognizer can be found later.
const tele = v => fetch(VB + '/api/log', { method: 'POST', body: JSON.stringify(v), keepalive: true }).catch(() => {})
// A script error goes to the telemetry too: a broken page after a change shows there, not only in the browser console.
addEventListener('error', e => tele({ event: 'js_error', error: e.message, at_line: (e.filename || '').split('/').pop() + ':' + e.lineno }))
addEventListener('unhandledrejection', e => tele({ event: 'js_error', error: String(e.reason?.message || e.reason) }))
// check is a self-check that runs at load: a failed one throws, so it lands in the telemetry as a js_error.
const check = (ok, name) => { if (!ok) throw new Error('self-check failed: ' + name) }
// screenRect turns a box in the page into points on the screen, for a screenshot of that part of the screen.
// ponytail: the browser bar is taken as outerHeight - innerHeight; docked DevTools at the bottom shift it.
// shots: what Claude sees of the pointing — the zone around the whole mouse path, and a square at each stop of the mouse (① ②).
const shots = (zone, marks = []) => [...(zone ? [{ ...screenRect(zone), label: 'The zone: the box around the whole path of the mouse' }] : []),
  ...marks.map(m => ({ ...screenRect(m), label: `Mark ${m.n}: the mouse stopped here` }))]
const screenRect = z => z && { x: Math.round(screenX + z.l - 16), y: Math.round(screenY + outerHeight - innerHeight + z.t - 16), w: Math.round(z.r - z.l + 32), h: Math.round(z.b - z.t + 32) }
// sweep: a glimm band (lib/glimm.js, MIT, glimm.dev) passes over the changed box, and the change shows behind it.
// swap runs when the band covers the box; sweep returns what swap returns. No WebGL or reduced motion: swap at once.
let glimm
async function sweep(r, swap = () => {}) {
  if (r) { // only the part in the window: a band below the fold is not seen
    const l = Math.max(0, r.left), t = Math.max(0, r.top)
    r = { left: l, top: t, width: Math.min(innerWidth, r.left + r.width) - l, height: Math.min(innerHeight, r.top + r.height) - t }
  }
  // A hidden tab gets no animation frames: the band would never reach its middle, and the change would wait until the user comes back.
  if (!(r?.width > 0 && r.height > 0) || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return swap()
  glimm ||= import(VB + '/lib/glimm.js')
  const { createShader, playSweep } = await glimm.catch(() => ({}))
  const canvas = document.body.appendChild(Object.assign(document.createElement('canvas'), { className: 'sweep' }))
  Object.assign(canvas.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' })
  const ctrl = createShader?.({ canvas })
  if (!ctrl) { canvas.remove(); return swap() }
  let out, ran = false
  const once = async () => { ran = true; out = await swap() }
  // midpoint .35: in code mode the dev server needs about 0.2 s to show the written file, so the change lands while the band still covers it.
  await playSweep(ctrl, { sweepMs: 800, midpoint: .35, palette: 'prism', onMidpoint: once,
    onComplete: () => { ctrl.destroy(); canvas.remove() } }).midpoint
  if (!ran) await once() // the band broke before its middle: the change still lands
  return out
}
// box: the box around some elements, in window pixels.
const box = els => els.length && els.map(e => e.getBoundingClientRect()).reduce((a, b) => {
  const l = Math.min(a.left, b.left), t = Math.min(a.top, b.top)
  return { left: l, top: t, width: Math.max(a.right, b.right) - l, height: Math.max(a.bottom, b.bottom) - t, right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) }
})

// smooth swaps the page with a short cross-fade where the browser can do it.
const smooth = draw => document.startViewTransition ? document.startViewTransition(draw) : draw()

// The bar shows speech as it is used: one chip per finished phrase, then the words that can still change.
// fit gives the bar the width of its content, so it grows and shrinks with one smooth move.
function fit() {
  $('say').style.width = $('live').textContent ? $('heard').offsetWidth + 'px' : '0px'
  $('say').classList.toggle('over', $('heard').offsetWidth > 420)
}
new ResizeObserver(fit).observe($('heard')) // a late font or a check mark changes the width
function chip(text, kind) {
  const el = Object.assign(document.createElement('div'), { className: 'ph ' + (kind || '') })
  el.append(document.createElement('b'), Object.assign(document.createElement('small'), { textContent: text }))
  if (kind !== 'err') el.append(Object.assign(document.createElement('button'), { className: 'x', textContent: '×', title: 'Cancel', onclick: () => cancel(el) }))
  $('tasks').append(el)
  return el
}
function leave(el, after) {
  setTimeout(() => el.classList.add('out'), after)
  setTimeout(() => el.remove(), after + 300)
}
// keepTodo keeps the phrases that Claude has not finished, so a reload does not lose them: the page says them again.
const keepTodo = () => PAGE && localStorage.setItem('verbally.' + PAGE + '.todo',
  JSON.stringify([...new Set([...$('canvas').children].flatMap(sec => [...sec.phrases.map(p => p.text), ...sec.queued]))]))
// settle marks the phrases that are on the page now as done. `pending` holds the phrases that still wait.
function settle(sec) {
  while (sec.phrases.length && !sec.pending.endsWith(sec.phrases.map(p => p.text).join(' '))) {
    const { el } = sec.phrases.shift()
    if (--el.n > 0) continue // a phrase for the whole page: its chip waits for the last section
    el.classList.add('done')
    leave(el, 1400)
  }
}

const note = text => leave(chip(text, 'err'), 5000) // a problem the user must know about
let system = ''
let cur // the section that speech changes now
