// The same React interface runs on the page and on a development app.
window.VERBALLY_CODE = true
window.VERBALLY_BASE = '/_v'
// The font face must live in the document: @font-face inside a shadow root does not load.
for (const href of ['/_v/ui.css', 'https://fonts.googleapis.com/css2?family=Inter:wght@400..600&display=swap'])
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }))
document.body.classList.add('vb-code')
for (const name of ['ui', 'core', 'input', 'picker', 'code'])
  await new Promise((done, fail) => document.body.append(Object.assign(document.createElement('script'), { src: `/_v/js/${name}.js`, onload: done, onerror: fail })))
