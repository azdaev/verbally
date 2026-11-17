// The picker: versions of an image or of a section layout, to choose one.

// The picker shows versions to choose from, in a strip above the bar.
// A click on a version shows it on the page and keeps the picker open, so the user can look, scroll and compare.
// "Use this" keeps the shown version. "Cancel" brings the page back as it was. Keys: arrows move, Enter uses, Esc cancels.
// It serves two cases: the images that the model offers for one <img> (data-choices), and layouts of a section built side by side.
let picking = null // the section whose layouts the picker shows now
const pickOpen = (title, wide, cancel) => UI.openPicker(title, wide, cancel)
const pickAdd = (thumb, view, keep, now) => UI.addChoice(thumb, view, keep, now)
addEventListener('keydown', e => {
  const p = UI.getSnapshot().picker
  if (!p || UI.getSnapshot().settingsOpen || isTextInput(e)) return
  if (e.key === 'Enter' && !UI.isUIEvent(e)) UI.keepChoice()
  else if (e.key === 'Escape') UI.cancelChoice()
  else if (e.key === 'ArrowRight') UI.choose(Math.min(p.items.length - 1, p.selected + 1))
  else if (e.key === 'ArrowLeft') UI.choose(Math.max(0, p.selected - 1))
  else return
  e.preventDefault()
})

// offer shows the picker when a saved section holds an image with versions to choose from (data-choices).
// "Use this" keeps a version: the image gets that address and loses its choices.
// The user can also choose by voice ("the third one"): the model sees the choices in the HTML.
function offer() {
  if (picking) return
  const sec = [...$('canvas').children].find(s => s.html && /<img\b[^>]*\bdata-choices="/.test(s.html))
  if (!sec) return UI.closePicker()
  const img = () => sec.querySelector('img[data-choices]')
  const now = img().getAttribute('src')
  const options = [...new Set([now, ...img().dataset.choices.split('|').map(o => o.trim()).filter(Boolean)])]
  const keep = src => {
    sec.html = sec.html.replace(/<img\b[^>]*\bdata-choices="[^"]*"[^>]*>/, tag =>
      tag.replace(/\sdata-choices="[^"]*"/, '').replace(/\bsrc="[^"]*"/, () => 'src="' + src.replace(/&/g, '&amp;') + '"'))
    show(sec, sec.html)
    save()
    tele({ event: 'picked', picked: src, of: options.length })
    offer() // one more image can wait for a choice
  }
  pickOpen('Pick a photo', false, () => keep(now))
  for (const src of options) pickAdd(Object.assign(new Image(), { src, alt: '' }), () => img()?.setAttribute('src', src), () => keep(src), src === now)
  img().scrollIntoView({ block: 'center', behavior: 'smooth' })
}

// versions builds several layouts of one section at the same time, each from its own layout idea, and lets the user pick.
// The requests run side by side, so five layouts need the time of the slowest one, not the sum.
// ponytail: fixed layout ideas. Let the model name the ideas when the picks look alike.
const IDEAS = [
  'type only: the words carry the section, very large, no image or a very small one',
  'full-bleed image or colour field with the text set over it',
  'asymmetric split: a narrow column and a wide one, with an offset that breaks the grid',
  'a strict modular grid of unequal cells, like a poster or a timetable',
  'editorial, like a magazine spread: columns, a pull quote or a caption, fine rules',
  'centred and quiet: one small block in a lot of empty space',
]
function howMany(text) {
  const words = { two: 2, three: 3, four: 4, five: 5, six: 6, два: 2, три: 3, четыре: 4, пять: 5, шесть: 6 }
  const m = text.toLowerCase().match(/\d+|two|three|four|five|six|два|три|четыре|пять|шесть/)
  return Math.min(IDEAS.length, Math.max(2, m ? +m[0] || words[m[0]] : 4))
}
// layouts opens the picker for one section and returns a function that adds a built version to it.
// The built versions are kept in browser storage until the user decides, so a reload brings the picker back.
function layouts(sec, cmd, n, built, el) {
  const key = 'verbally.' + PAGE + '.versions'
  const keepAll = () => PAGE && localStorage.setItem(key, JSON.stringify({ index: [...$('canvas').children].indexOf(sec), cmd, n, built }))
  sec.busy = true // speech that comes now waits and changes the version that the user picks
  picking = sec
  const end = html => {
    if (html) {
      sec.html = html
      sec.said = (sec.said + ' ' + cmd).trim()
    }
    show(sec, sec.html)
    if (html) split(sec)
    save()
    tele({ event: 'picked_layout', picked: !!html, of: built.length })
    if (el) el.update({ kind: 'done' }), leave(el, 1400)
    localStorage.removeItem(key)
    sec.stop?.() // the layouts that are not ready are not needed now: their Claude processes stop
    sec.busy = false
    picking = null
    UI.closePicker()
    offer()
    pump(sec)
  }
  const title = () => UI.pickerTitle(built.length < n ? `Building ${n} layouts… ${built.length} ready` : 'Pick a layout')
  const add = (v, old) => { // v: { k: the number of its layout idea, html }
    if (picking !== sec) return
    if (!old) built.push(v), keepAll()
    const thumb = Object.assign(document.createElement('div'), { className: 'thumb' })
    show(thumb.appendChild(document.createElement('div')), v.html)
    pickAdd(thumb, () => show(sec, v.html), () => end(v.html))
    title()
  }
  pickOpen('', true, () => end(''))
  title()
  keepAll() // the job is kept from its start, so a reload in the first seconds builds the versions again
  keepTodo()
  for (const v of built) add(v, true)
  return { add, end }
}
let leaving = false
addEventListener('beforeunload', () => leaving = true)
addEventListener('pagehide', () => leaving = true)
// old: a job from before a reload. Its built versions come back, and the versions that were not ready are built now.
async function versions(sec, cmd, el, old) {
  if (!old) while (sec.busy || picking) await new Promise(r => setTimeout(r, 200)) // a change in flight ends first: the versions start from its result
  if (el?.cancelled) return void (sec.queued = sec.queued.filter(t => t !== cmd), keepTodo())
  const n = old ? old.n : howMany(cmd), built = old ? old.built : []
  sec.queued = sec.queued.filter(t => t !== cmd)
  const ac = new AbortController()
  sec.stop = () => ac.abort()
  const { add, end } = layouts(sec, cmd, n, built, el)
  if (el) el.stop = () => end('')
  const have = new Set(built.map(v => v.k))
  // Not a forced full reply: "two other headers" in a 20 KB section is an edit of the header, 10 s instead of 60 s.
  await Promise.all(IDEAS.slice(0, n).map(async (idea, k) => {
    if (have.has(k)) return
    const html = await ask(sec, cmd, false, `\n\nThe speaker will choose from ${n} versions. This is version ${k + 1}. Change only the part that the speech names, or the whole section when it names no part. Make that part boldly different from the current one, with this layout idea adapted to it: ${idea}. Keep the subject, the content and the direction of the page.`, ac.signal)
    if (html) add({ k, html })
  }))
  sec.stop = null
  if (leaving) return // the page reloads and its requests break: the job stays in storage and goes on after the reload
  if (picking === sec && !built.length) end('') // every request failed; the error is in the bar
  else if (picking === sec) UI.pickerTitle('Pick a layout')
}
