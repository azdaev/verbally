// Start: load the prompt, restore the page, warm the engine, then run the test hooks from the address.

fetch('prompt.txt').then(r => r.text()).then(async t => {
  await setupReady
  system = t
  // Start the Claude Code process now, so the first speech does not wait for it. It needs only the prompt, not the page.
  if (ENGINE === 'claude') fetch('/api/claude', { method: 'POST', body: JSON.stringify({ model: MODEL, effort: EFFORT, messages: [{ content: system }] }) })
  await restore()
  // ?import=1 opens the site from VERBALLY_SITE on an empty page. ?import=again loads it fresh over the page as one more step: undo brings the page back.
  if (q.get('import') && (!live().length || q.get('import') === 'again')) await importSite()
  // ?cancel=ms: at that time after the start, press × on the newest card that is not done.
  if (q.get('cancel')) setTimeout(() => [...$('tasks').querySelectorAll('.ph:not(.done, .skip) .x')].at(-1)?.click(), +q.get('cancel'))
  // ?say=first phrase|second phrase plays phrases without a microphone.
  for (const phrase of (q.get('say') || '').split('|').filter(Boolean)) {
    hear(phrase, true)
    await new Promise(r => setTimeout(r, +(q.get('gap') || 2500))) // ?gap=ms: the time between the phrases
  }
  // ?point=img moves a pretend mouse with ⌥ over that element, to test pointing without hands.
  const target = q.get('point') && document.querySelector('#canvas ' + q.get('point'))
  if (target) {
    await new Promise(r => setTimeout(r, +(q.get('wait') || 3000)))
    const r = target.getBoundingClientRect()
    for (let i = 0; i < 14; i++) {
      const x = r.left - 260 + i * 26, y = r.top + 60 + Math.sin(i / 2) * 40
      document.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, altKey: true, clientX: x, clientY: y }))
    }
    if (q.get('then')) hear(q.get('then'), true)
  }
  if (q.get('mic')) { toggleMic(); setTimeout(toggleMic, +q.get('mic')) } // ?mic=ms holds the microphone on for that time
  if (q.get('pick')) { await new Promise(r => setTimeout(r, +(q.get('wait') || 3000))); UI.choose(q.get('pick') - 1); await new Promise(r => setTimeout(r, 6000)); UI.keepChoice() } // ?pick=2&wait=ms picks the second version
  if (q.get('reload')) setTimeout(() => location.replace('?page=' + PAGE), +q.get('reload')) // ?reload=ms tests what a reload keeps
  if (q.get('click')) { await new Promise(r => setTimeout(r, 1500)); $(q.get('click')).click() } // ?click=clear tests a bar button
  if (q.get('undo')) { await new Promise(r => setTimeout(r, +q.get('undo'))); travel(-1) } // ?undo=ms tests the history
})
