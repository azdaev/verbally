// The same React interface runs on the page and on a development app.
window.VERBALLY_CODE = true
window.VERBALLY_BASE = '/_v'
const effects = document.createElement('link')
effects.rel = 'stylesheet'
effects.href = '/_v/ui.css'
document.head.append(effects)
document.body.classList.add('vb-code')
for (const name of ['ui', 'core', 'input', 'picker', 'code'])
  await new Promise((done, fail) => document.body.append(Object.assign(document.createElement('script'), { src: `/_v/js/${name}.js`, onload: done, onerror: fail })))
