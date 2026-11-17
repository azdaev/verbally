// These scenarios exercise the actual engine scripts and React controls in visible Chrome.
// The fixture server replaces only external services and the editable code file.
const panel = document.createElement('aside')
panel.style.cssText = 'position:relative;z-index:1;font:14px/1.6 system-ui;background:#fff;padding:20px;border:1px solid #ddd;margin:20px;max-width:700px'
panel.innerHTML = '<h2>Verbally UI checks</h2><p>Fixture coverage. No real speech recognition or model requests.</p><button id="run-checks" style="all:initial;cursor:pointer;font:inherit;padding:10px;border:1px solid #aaa;border-radius:8px">Run checks</button><ol id="results"></ol>'
document.body.prepend(panel)
const results = panel.querySelector('#results'), run = panel.querySelector('button')
const waitFor = async (predicate, name) => {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(r => setTimeout(r, 50)) }
  throw new Error('Timeout: ' + name)
}
const clickUI = async id => { await waitFor(() => $(id), id); $(id).click(); await new Promise(r => setTimeout(r, 30)) }
const row = (name, ok, error = '') => { const li = document.createElement('li'); li.textContent = `${ok ? 'PASS' : 'FAIL'}: ${name}${error ? ' — ' + error : ''}`; li.style.color = ok ? '#166534' : '#b91c1c'; results.append(li) }
const scenario = async (name, job) => { try { await job(); row(name, true) } catch(e) { row(name, false, e.message); throw e } }
const assert = (condition, msg) => { if (!condition) throw new Error(msg) }
const codeRead = () => fetch('/api/file?path=fixture.jsx').then(r=>r.text())
const pointCode = () => { if (CODE) { const el = document.querySelector('[data-vsrc] h1'); point = {sec:document.body, els:[el], text:el.outerHTML} } }
const say = text => { pointCode(); hear(text, true) }
run.onclick = async () => {
  run.disabled = true; results.replaceChildren()
  try {
    await waitFor(() => UI.actions.mic && (CODE || cur), 'initialization')
    if (!CODE) { paint([]); save() }
    else await fetch('/reset', { method: 'POST' })
    await scenario('Settings open, switch tabs, save model, and close', async () => {
      await clickUI('more')
      assert($('menu').open, 'dialog does not open')
      const modelTab = UI.root.querySelector('[role=tab][id$="model"]'); modelTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      await waitFor(() => UI.root.querySelector('[role=radio][value="claude-sonnet-5-5"]'), 'model tab')
      UI.root.querySelector('[role=radio][value="claude-sonnet-5-5"]').click()
      await waitFor(() => MODEL === 'claude-sonnet-5-5', 'model change')
      assert(localStorage.getItem('verbally.model') === MODEL, 'model not saved')
      UI.root.querySelector('[aria-label="Close settings"]').click()
      await waitFor(() => !$('menu').open, 'dialog close')
    })
    await scenario('Host CSS cannot change toolbar controls', async () => {
      assert(UI.root instanceof ShadowRoot, 'no shadow root')
      assert(getComputedStyle($('more')).width === '40px', 'host style changes button size')
      assert(getComputedStyle($('bar')).display === 'flex', 'host hides toolbar')
    })
    await scenario('Partial speech appears in the toolbar', async () => {
      hear('Partial speech', false)
      await waitFor(() => $('live').textContent === 'Partial speech', 'partial text')
    })
    await scenario('Final speech changes the page or code', async () => {
      say('change title')
      await waitFor(async () => CODE ? (await codeRead()).includes('Changed') : live().some(s=>s.html.includes('Changed')), 'edit result')
      await waitFor(() => UI.getSnapshot().tasks.some(t=>t.kind === 'done'), 'done card')
    })
    await scenario('Undo and redo preserve the edit', async () => {
      await clickUI('back')
      await waitFor(async () => CODE ? (await codeRead()).includes('Original') : !live().length, 'undo')
      await clickUI('fwd')
      await waitFor(async () => CODE ? (await codeRead()).includes('Changed') : live().some(s=>s.html.includes('Changed')), 'redo')
    })
    await scenario('Keyboard undo works while a toolbar button has focus', async () => {
      $('back').focus()
      $('back').dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', metaKey: true, bubbles: true, composed: true }))
      await waitFor(async () => CODE ? (await codeRead()).includes('Original') : !live().length, 'keyboard undo')
      $('fwd').dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', metaKey: true, shiftKey: true, bubbles: true, composed: true }))
      await waitFor(async () => CODE ? (await codeRead()).includes('Changed') : live().some(s=>s.html.includes('Changed')), 'keyboard redo')
    })
    await scenario('Versions preview and cancel restore the original result', async () => {
      say('two versions')
      await waitFor(() => UI.getSnapshot().picker?.items.length === 2, 'versions')
      UI.root.querySelectorAll('#pick .grid button')[0].click()
      await waitFor(async () => CODE ? (await codeRead()).includes('Version') : $('canvas').textContent.includes('Version'), 'preview')
      await clickUI('pickKeep')
      await waitFor(async () => CODE ? (await codeRead()).includes('Changed') : $('canvas').textContent.includes('Changed'), 'restore')
    })
    await scenario('Versions keep the selection and undo restores the base', async () => {
      say('two versions')
      await waitFor(() => UI.getSnapshot().picker?.items.length === 2, 'versions')
      UI.root.querySelectorAll('#pick .grid button')[1].click()
      await waitFor(() => !$('pickUse').disabled, 'enabled use button')
      await clickUI('pickUse')
      await waitFor(() => !UI.getSnapshot().picker, 'picker close')
      await waitFor(async () => CODE ? !pickOn : !picking, 'finish writes')
      await clickUI('back')
      await waitFor(async () => CODE ? (await codeRead()).includes('Changed') : $('canvas').textContent.includes('Changed'), 'undo choice')
    })
    await scenario('Cancel stops a pending request', async () => {
      say('slow change')
      await waitFor(() => UI.getSnapshot().tasks.some(t => t.text === 'slow change'), 'pending card')
      await new Promise(r=>setTimeout(r,150))
      UI.root.querySelector('[aria-label="Cancel slow change"]').click()
      await waitFor(() => UI.getSnapshot().tasks.some(t=>t.text === 'slow change' && t.kind === 'skip'), 'cancelled card')
      await waitFor(() => CODE ? flying === 0 : !cur.busy, 'abort request')
    })
    await scenario('Request errors remain visible', async () => {
      say('request-error')
      await waitFor(() => UI.getSnapshot().tasks.some(t=>t.kind === 'err' && /503/.test(t.text)), 'error card')
    })
    if (!CODE) await scenario('Clear removes the page and undo restores it', async () => {
      await clickUI('clear'); await waitFor(()=>!live().length,'clear')
      await clickUI('back'); await waitFor(()=>live().length,'undo clear')
    })
  } catch {} finally { run.disabled = false }
}
