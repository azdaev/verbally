// The page: its sections, how a reply is drawn, and the history (undo, redo, reload).

const live = () => [...$('canvas').children].filter(sec => sec.html)
// The name of a section for Jev: what it is and what it says. A speaker says "the hero" or "the reviews"; the heading alone often has no such word.
const isFooter = sec => /<footer\b|©|&copy;/i.test(sec.html)
// The role comes from the HTML: the speaker says "the hero" or "the header", and these words are rarely in the text.
const role = sec => isFooter(sec) ? 'footer' : /<h1\b/i.test(sec.html) ? 'hero' : /<nav\b/i.test(sec.html) ? 'header' : ''
const label = (sec, i) => [i ? '' : 'top of the page', role(sec), sec.firstElementChild?.id, sec.textContent].filter(Boolean).join(': ').replace(/\s+/g, ' ').slice(0, 140)

// The page is a list of sections, top to bottom. Each phrase changes one section, so two phrases for two sections run side by side,
// and a change reads and writes one section, not the whole page.
// A section holds four texts:
//   html    - the base: HTML that holds only final speech
//   said    - final speech that is already in html
//   pending - final speech that is not in html yet
//   partial - speech that the recognizer can still change
function newSection(after) {
  const sec = document.createElement('div')
  Object.assign(sec, { html: '', said: '', pending: '', partial: '', phrases: [], queued: [], look: false, busy: false, preview: null, shown: '', point: '', heardAt: 0 })
  after ? after.after(sec) : $('canvas').append(sec)
  return sec
}

// split runs when a reply becomes the base of a section. One reply can hold several <section> elements
// ("a landing page with a hero, prices and a footer"): each becomes a section of its own. An empty <section> removes the section.
function split(sec) {
  const t = document.createElement('template')
  t.innerHTML = sec.html
  if (!t.content.querySelector('section > *, :not(section)') && !t.content.textContent.trim()) {
    sec.html = ''
    if ($('canvas').children.length > 1) sec.remove()
    else show(sec, '')
    if (!cur.isConnected) select($('canvas').firstChild)
    return
  }
  const parts = ['']
  let has = false
  for (const n of t.content.childNodes) { // a <style> next to a section stays with it
    if (n.nodeName === 'SECTION') { if (has) parts.push(''); has = true }
    parts[parts.length - 1] += n.outerHTML ?? n.textContent
  }
  if (parts.length < 2) return
  for (const [i, html] of parts.entries()) {
    if (i) sec = newSection(sec)
    sec.html = html
    show(sec, html)
  }
}

// The page lives in this browser's storage, so a reload keeps it. Only final speech is saved, never a preview.
// ?page=name keeps a separate page. A ?say= test run without a page name saves nothing, so it cannot overwrite real work.
const PAGE = q.get('page') || (q.get('say') ? '' : 'main')
// history holds every saved state of the page, like the back and forward list of a browser tab.
// save adds a state after the current one and drops the states that were undone.
// ponytail: the last 60 states in browser storage. Move it to the server when pages get heavy.
let history = [], at = -1
function save() {
  const page = [...$('canvas').children].filter(sec => sec.html).map(sec => ({ html: sec.html, said: sec.said }))
  const state = JSON.stringify(page)
  if (state === history[at]) return
  history = [...history.slice(0, at + 1), state].slice(-60)
  at = history.length - 1
  store()
}

function store() {
  UI.update({ canUndo: at > 0, canRedo: at < history.length - 1, canClear: history[at] !== '[]', tools: history.length > 1 })
  if (!PAGE) return
  keepTodo()
  for (;;) {
    try { localStorage.setItem('verbally.' + PAGE + '.history', JSON.stringify({ history, at })); break } catch (e) {
      // Browser storage is full (about 5 MB). Drop the oldest half of the history; the current page always stays.
      if (history.length < 2) { note('The page is too large to save in this browser.'); break }
      const drop = Math.min(at, Math.ceil(history.length / 2))
      if (drop) history = history.slice(drop), at -= drop
      else history = history.slice(0, Math.ceil(history.length / 2)) // the current page is the oldest state: drop redo states

    }
  }
  // The server keeps a copy in pages/, so the page can be reviewed and compared with the telemetry.
  fetch('/api/page?name=' + encodeURIComponent(PAGE), { method: 'POST', body: history[at], keepalive: true }).catch(() => {})
}

// travel moves through the history: -1 is undo, +1 is redo.
function travel(step) {
  if (!history[at + step]) return
  at += step
  const draw = () => paint(JSON.parse(history[at]))
  smooth(draw)
  store()
}

function paint(page) {
  $('canvas').replaceChildren()
  cur = null
  if (picking) { // undo or clear while a layout choice was open: the versions belonged to the old page
    picking = null
    UI.closePicker()
    localStorage.removeItem('verbally.' + PAGE + '.versions')
  }
  UI.clearTasks() // their sections are gone
  UI.update({ live: '' })
  for (const { html, said } of page) {
    const sec = newSection()
    Object.assign(sec, { html, said })
    show(sec, html)
  }
  select($('canvas').firstChild || newSection())
  offer()
}

// importSite opens an existing static site (VERBALLY_SITE on the server) as a page of sections.
// Its stylesheets and its script files come along and stay with the page. Each top-level block, and each block of <main>, is a section.
// The scripts run: a site often places its header or starts its video from a script. Inline scripts (mostly analytics) stay out.
let siteStyled = false // the page is an imported site with its own stylesheet
async function importSite() {
  const res = await fetch('/api/site')
  if (!res.ok) return note('No site to import: start the server with VERBALLY_SITE=folder')
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html')
  const head = [...doc.head.querySelectorAll('link[rel=stylesheet], style')].map(el => el.outerHTML).join('\n')
  const scripts = [...doc.querySelectorAll('script[src]')].map(el => el.getAttribute('src'))
  if (PAGE) localStorage.setItem('verbally.' + PAGE + '.head', head), localStorage.setItem('verbally.' + PAGE + '.scripts', JSON.stringify(scripts))
  document.head.insertAdjacentHTML('beforeend', head)
  siteStyled = !!head
  const blocks = [...doc.body.children].flatMap(el => el.localName === 'main' ? [...el.children] : [el]).filter(el => el.localName !== 'script')
  paint(blocks.map(el => ({ html: el.outerHTML, said: '' })))
  save()
  runSite(scripts)
}

// runSite loads the site's scripts in order after its sections are on the page. They wait for DOMContentLoaded,
// which fired long ago, so they get it once more. A script that fails (an analytics file that is not in the folder) is skipped.
// ponytail: a script holds the elements it found at start; an element that the model replaces loses its behaviour until a reload.
// siteScripts gives the saved script list; a page imported before scripts were kept reads it from the site now.
async function siteScripts() {
  const kept = localStorage.getItem('verbally.' + PAGE + '.scripts')
  if (kept) return JSON.parse(kept)
  const res = await fetch('/api/site').catch(() => null)
  if (!res?.ok) return []
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html')
  const scripts = [...doc.querySelectorAll('script[src]')].map(el => el.getAttribute('src'))
  localStorage.setItem('verbally.' + PAGE + '.scripts', JSON.stringify(scripts))
  return scripts
}
async function runSite(scripts) {
  for (const src of scripts) await new Promise(done => document.body.append(Object.assign(document.createElement('script'), { src, onload: done, onerror: done })))
  if (scripts.length) document.dispatchEvent(new Event('DOMContentLoaded'))
}

async function restore() {
  const head = PAGE && localStorage.getItem('verbally.' + PAGE + '.head') // the styles of an imported site
  if (head) document.head.insertAdjacentHTML('beforeend', head), siteStyled = true
  const saved = JSON.parse(PAGE && localStorage.getItem('verbally.' + PAGE + '.history') || 'null')
  const todo = JSON.parse(PAGE && localStorage.getItem('verbally.' + PAGE + '.todo') || '[]') // read it before store() writes the empty list
  // Browser storage is empty (cleared, or another browser): take the copy of the page that the server keeps in pages/.
  const copy = !saved && PAGE && await fetch('pages/' + encodeURIComponent(PAGE) + '.json').then(r => r.ok ? r.text() : '').catch(() => '')
  if (saved) ({ history, at } = saved)
  else history = ['[]', ...(copy && copy !== '[]' ? [copy] : [])], at = history.length - 1
  paint(JSON.parse(history[at]))
  store()
  if (head) runSite(await siteScripts())
  // The user reloaded the page before the choice of a layout: show the built versions again.
  const v = JSON.parse(PAGE && localStorage.getItem('verbally.' + PAGE + '.versions') || 'null')
  const sec = v && $('canvas').children[v.index]
  if (sec) versions(sec, v.cmd, null, { n: v.n, built: v.built.filter(b => b.html) })
  // Phrases that Claude had not finished before the reload: say them again.
  // ponytail: a phrase that the user pointed with loses its pointer. Keep the pointer text with the phrase if that hurts.
  if (todo.length) tele({ event: 'replay', texts: todo }) // phrases said again after a reload: a phrase here that was done is a bug
  for (const text of new Set(todo.map(p => p.text || p))) hear(text, true)
}

function select(sec) {
  cur?.classList.remove('cur')
  cur = sec
  cur.classList.add('cur')
}

const clean = html => html.replace(/^\s*```(html)?/, '').replace(/```\s*$/, '').trim().replace(/^(\s*<!--\s*(task|move):[\s\S]*?-->)+\s*/, '')

// morph makes the live nodes equal to the new ones and keeps every node that did not change.
// A kept node keeps its running animations and loaded images: an edit of one heading no longer replays the whole section.
// ponytail: nodes are matched by position. An element added at the top changes the nodes after it; match by id if that blinks.
function morph(from, to) {
  if (to.attributes) {
    for (const a of [...from.attributes]) if (!to.hasAttribute(a.name)) from.removeAttribute(a.name)
    for (const a of to.attributes) if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value)
  }
  const old = [...from.childNodes], now = [...to.childNodes]
  now.forEach((n, i) => {
    const o = old[i]
    if (!o) from.append(n)
    else if (o.nodeName !== n.nodeName) o.replaceWith(n)
    else if (n.nodeType === 1) morph(o, n)
    else if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue
  })
  for (const o of old.slice(now.length)) o.remove()
}
{ // check: an unchanged node stays the same object, a changed text and attribute update, extra nodes go
  const a = document.createElement('div'), t = document.createElement('template')
  a.innerHTML = '<h1 class="x">A</h1><p>B</p><i></i>'
  const h1 = a.firstChild
  t.innerHTML = '<h1 class="y">A</h1><p>C</p>'
  morph(a, t.content)
  check(a.firstChild === h1 && a.innerHTML === '<h1 class="y">A</h1><p>C</p>', 'morph')
}
// ponytail: innerHTML trusts the model output. Enough for a local prototype; sanitize before other people use it.
function show(sec, html) {
  sec.shown = clean(html)
  const t = document.createElement('template')
  t.innerHTML = sec.shown
  morph(sec, t.content)
  for (const [, font] of html.matchAll(/font-family:\s*['"]([A-Za-z0-9 ]+)['"]/g)) loadFont(font.trim())
}

const fonts = new Set()
let pageFont = '' // the font of the newest section; later sections keep it
function loadFont(name) {
  pageFont = name
  if (fonts.has(name)) return
  fonts.add(name)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  const url = 'https://fonts.googleapis.com/css2?display=swap&family=' + name.replace(/ /g, '+')
  link.href = url + ':wght@400;500;700;800;900'
  link.onerror = () => { link.onerror = null; link.href = url } // a font without these weights fails as a whole: load its regular weight
  document.head.append(link)
}

// glow marks the element that holds the text `from` of the base HTML.
// The n-th opening tag in the HTML text is the n-th element of the section, so a text position gives an element.
function glow(sec, from) {
  const i = sec.html.indexOf(from)
  if (i < 0 || sec.shown !== sec.html) return // the screen shows a preview, not the base: positions do not match
  const n = [...sec.html.slice(0, i + 2).matchAll(/<[a-zA-Z]/g)].length
  sec.querySelectorAll('*')[n - 1]?.classList.add('glow')
}
