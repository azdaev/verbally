// overlay.js puts Verbally on a running app in code mode. The app's dev server loads it from /_v/overlay.js (code/dev.mjs).
// It takes the bar and the task cards from the tool's own index.html, so the widget and the tool never drift apart.
window.VERBALLY_CODE = true
window.VERBALLY_BASE = '/_v'
document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="/_v/ui.css"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@500&display=swap">'
  + '<style>#bar, #tasks, #trail, #pick, #zone, .vb-mark, canvas.sweep { z-index: 2147483000 !important; }</style>') // above the app's own dialogs
const tool = new DOMParser().parseFromString(await (await fetch('/_v/index.html')).text(), 'text/html')
for (const id of ['trail', 'pick', 'bar', 'tasks']) document.body.append(tool.getElementById(id))
document.body.classList.add('vb-code')
for (const name of ['core', 'input', 'picker', 'code'])
  await new Promise((done, fail) => document.body.append(Object.assign(document.createElement('script'), { src: `/_v/js/${name}.js`, onload: done, onerror: fail })))
