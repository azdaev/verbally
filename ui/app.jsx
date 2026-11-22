import React, { useSyncExternalStore, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Mic, Undo2, Redo2, Trash2, Settings, X, Sparkles, Keyboard, ArrowUpRight, Check } from 'lucide-react'
import { Button } from './components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs'
import { RadioGroup, RadioGroupItem } from './components/ui/radio-group'
import { createUIStore } from './store'
import css from './compiled.css'

const host = document.createElement('verbally-ui')
host.id = 'verbally-ui'
// Keep the host out of the app's layout and above its ordinary stacking contexts.
host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483000;color-scheme:light;'
document.body.append(host)
const shadow = host.attachShadow({ mode: 'open' })
const sheet = document.createElement('style')
sheet.textContent = css
shadow.append(sheet)
const mount = document.createElement('div')
shadow.append(mount)
const ui = createUIStore(!!window.VERBALLY_CODE)
ui.root = shadow
ui.host = host
ui.isUIEvent = e => e.composedPath().includes(host)
window.VerballyUI = ui
const useUI = () => useSyncExternalStore(ui.subscribe, ui.getSnapshot)

// Off a Mac the keys are Ctrl and Alt (js/input.js takes Ctrl+Z there).
const MAC = /Mac/.test(navigator.platform), CMD = MAC ? '⌘' : 'Ctrl', OPT = MAC ? '⌥' : 'Alt'
// tip: the bar's own tooltip (data-tip in styles.css). Buttons outside the bar keep the native title.
function IconButton({ label, tip, icon: Icon, ...props }) {
  return <Button variant="ghost" size="icon" aria-label={label} {...(tip ? { 'data-tip': tip } : { title: label })} {...props}><Icon aria-hidden="true" /></Button>
}
function Toolbar() {
  const s = useUI(), heard = useRef(null), [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = heard.current, measure = () => setWidth(el.offsetWidth)
    const observer = new ResizeObserver(measure)
    observer.observe(el); measure()
    return () => observer.disconnect()
  }, [])
  return <div id="bar" role="toolbar" aria-label="Verbally" className={[s.busy && 'busy', s.recording && 'rec', s.hears && 'hears', s.waiting && 'wait'].filter(Boolean).join(' ')}>
    <IconButton id="mic" label="Microphone" tip={s.settings.dictation ? "Verbally's own microphone · click" : `Talk · hold ${MAC ? '⌥ Option' : 'Alt'} or Space`} icon={Mic} className={s.mic ? 'on' : ''} aria-pressed={s.mic} onClick={() => ui.actions.mic?.()} />
    <span id="wave" aria-hidden="true">{[0,1,2,3,4].map(i => <i key={i} />)}</span>
    {s.typing ? <TypeField /> : <IconButton id="type" label="Type a phrase" tip="Type instead of talking · /" icon={Keyboard} onClick={() => ui.update({ typing: true })} />}
    <div id="say" className={width > 420 ? 'over' : ''} style={{ width: s.live ? width : 0 }}><div id="heard" ref={heard} aria-live="polite"><span id="live">{s.live}</span></div></div>
    <span id="pt" title="The model sees this element">{s.pointer}</span>
    <div id="tools" className={s.tools ? 'open' : ''}>
      <span className="sep" />
      <IconButton id="back" label="Undo" tip={(s.code ? 'Undo the last code change · ' : 'Undo · ') + (MAC ? '⌘Z' : 'Ctrl+Z')} icon={Undo2} disabled={!s.canUndo} onClick={() => ui.actions.undo?.()} />
      <IconButton id="fwd" label="Redo" tip={'Redo · ' + (MAC ? '⇧⌘Z' : 'Shift+Ctrl+Z')} icon={Redo2} disabled={!s.canRedo} onClick={() => ui.actions.redo?.()} />
      {!s.code && <IconButton id="clear" label="Clear the page" tip="Clear the page" icon={Trash2} disabled={!s.canClear} onClick={() => ui.actions.clear?.()} />}
    </div>
    <IconButton id="more" label="Settings" tip="Settings" icon={Settings} onClick={() => ui.update({ settingsOpen: true })} />
  </div>
}
// A phrase typed instead of spoken: for an office, a café or a call. Enter sends it the way speech goes, Esc closes.
function TypeField() {
  const [text, setText] = useState('')
  const close = () => ui.update({ typing: false })
  return <form id="typed" onSubmit={e => { e.preventDefault(); if (text.trim()) ui.actions.type?.(text.trim()); close() }}>
    <input autoFocus aria-label="Type a phrase" placeholder="Say it in words…" value={text} onChange={e => setText(e.target.value)}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close() } }} onBlur={() => text.trim() || close()} />
  </form>
}
const rawError = text => /Codex/.test(text) ? 'Codex could not make the change'
  : /claude/i.test(text) ? 'Claude Code could not make the change'
  : /^\d{3}\b|fetch|network/i.test(text) ? 'The engine did not answer' : ''
function Tasks() {
  const { tasks } = useUI()
  // Until the model names the task, the spoken phrase is the title and the card says that it works.
  // A raw engine error gets a plain title; its details stay in the second line.
  return <div id="tasks" aria-live="polite">{tasks.map(t => {
    const pending = !['err', 'done', 'skip', 'hint'].includes(t.kind)
    const title = t.title || (t.kind === 'err' && rawError(t.text)) || ''
    return <div key={t.id} className={`ph ${t.kind} ${pending ? 'wip' : ''} ${t.look ? 'look' : ''} ${t.out ? 'out' : ''}`}>
      <b>{title || t.text}</b>{title ? <small>{t.text}</small> : pending && <small>Working…</small>}
      {t.files?.length > 0 && <span className="files">{t.files.map(f => <button key={f.file} type="button" title="Open in your editor" onClick={() => ui.actions.open?.(f)}>{f.file}:{f.line} ↗</button>)}</span>}
      {pending && <IconButton className="x" label={`Cancel ${t.text}`} icon={X} onClick={() => ui.actions.cancel?.(t.handle)} />}
      {t.kind === 'err' && <IconButton className="x" label="Dismiss" icon={X} onClick={() => t.handle.remove()} />}
    </div>
  })}</div>
}
// Engine thumbnails are copied into a sandboxed frame. Their CSS cannot reach the controls.
function Preview({ node }) {
  const [preview] = useState(() => {
    if (!node.classList.contains('thumb')) return null
    const html = document.implementation.createHTMLDocument('Layout preview')
    const base = html.createElement('base'); base.href = document.baseURI; html.head.append(base)
    for (const style of document.head.querySelectorAll('style, link[rel="stylesheet"]')) html.head.append(style.cloneNode(true))
    html.body.innerHTML = node.firstElementChild.innerHTML
    // Only the page's Tailwind compiler runs here. Generated scripts are not needed for a thumbnail.
    html.querySelectorAll('script').forEach(script => script.remove())
    html.querySelectorAll('*').forEach(el => [...el.attributes].forEach(attr => { if (attr.name.startsWith('on')) el.removeAttribute(attr.name) }))
    const tailwind = html.createElement('script'); tailwind.src = 'https://cdn.tailwindcss.com'; html.head.append(tailwind)
    // The frame tells its content height, so a short section sits in the middle of the thumbnail instead of a strip at the top.
    const size = html.createElement('script')
    size.textContent = 'new ResizeObserver(() => parent.postMessage({ vbThumb: document.body.scrollHeight }, "*")).observe(document.body)'
    html.body.append(size)
    return '<!doctype html>' + html.documentElement.outerHTML
  })
  const frame = useRef(null), [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const listen = e => { if (e.source === frame.current?.contentWindow && e.data?.vbThumb) setHeight(e.data.vbThumb) }
    addEventListener('message', listen)
    return () => removeEventListener('message', listen)
  }, [])
  const scale = .1375 // 1280 px of page in a 176 px thumbnail
  const top = height ? Math.max(0, (110 - height * scale) / 2) : 0
  if (preview) return <span className="thumb"><iframe ref={frame} title="Layout preview" tabIndex={-1} sandbox="allow-scripts" srcDoc={preview}
    style={{ transform: `translateY(${top}px) scale(${scale})` }} /></span>
  if (node.tagName === 'IMG') return <img src={node.src} alt="" />
  return <span className="label">{node.textContent}</span>
}
function Picker() {
  const { picker } = useUI()
  return picker ? <PickerPanel p={picker} /> : null
}
// The picker sits above the bar, and the task cards above the picker: --vb-pick-h lifts them by its height.
function PickerPanel({ p }) {
  const panel = useRef(null)
  useLayoutEffect(() => {
    const el = panel.current, lift = () => host.style.setProperty('--vb-pick-h', el.offsetHeight + 8 + 'px')
    const observer = new ResizeObserver(lift)
    observer.observe(el); lift()
    return () => { observer.disconnect(); host.style.setProperty('--vb-pick-h', '0px') }
  }, [])
  return <div id="pick" ref={panel} className={p.wide ? 'wide' : ''} role="region" aria-label="Versions">
    <header><b id="pickTitle" aria-live="polite">{p.title}</b><span>
      <Button id="pickKeep" variant="ghost" onClick={ui.cancelChoice}>Cancel</Button>
      {p.chosen && <Button id="pickUse" onClick={ui.keepChoice}><Check />Use this</Button>}{/* a grey button with a ✓ before any choice read as broken */}
    </span></header>
    <div className="grid">{p.items.map((item, i) => <button key={i} type="button" aria-label={`Version ${i + 1}`} aria-pressed={p.selected === i} className={p.selected === i ? 'now' : ''} onClick={() => ui.choose(i)}>
      <Preview node={item.thumb} /><i>{i + 1}</i>
    </button>)}</div>
    <footer><Key>←</Key><Key>→</Key> compare <Key>Enter</Key> use <Key>Esc</Key> cancel</footer>
  </div>
}
const languages = { 'en-US': 'English', 'ru-RU': 'Русский', 'es-ES': 'Español', 'de-DE': 'Deutsch', 'fr-FR': 'Français', 'pt-BR': 'Português', 'zh-CN': '中文', 'ja-JP': '日本語' }
const Key = ({ children }) => <kbd>{children}</kbd>
const TalkKey = ({ settings: s }) => s.dictation ? (s.talk.key ? <>hold <Key>{s.talk.key}</Key></> : 'the key of your app') : <>hold <Key>{OPT}</Key> or <Key>Space</Key></>
function Choice({ value, title, detail, disabled, tag }) {
  const id = React.useId()
  return <label className={`item opt ${disabled ? 'off' : ''}`} htmlFor={id}>
    <RadioGroupItem id={id} value={value} disabled={disabled} />
    <span><b>{title}</b>{detail && <small>{detail}</small>}</span>{tag && <i className={tag === 'Running' ? 'run' : ''}>{tag}</i>}
  </label>
}
function SettingsWindow() {
  const state = useUI(), s = state.settings, d = s.talk, dialog = useRef(null)
  const change = (name, value) => ui.actions.setting?.(name, value)
  useLayoutEffect(() => {
    const el = dialog.current
    if (state.settingsOpen && !el.open) el.showModal()
    if (!state.settingsOpen && el.open) el.close()
  }, [state.settingsOpen])
  return <dialog id="menu" ref={dialog} aria-labelledby="m-title" onClose={() => ui.update({ settingsOpen: false })} onClick={e => { if (e.target === e.currentTarget) ui.update({ settingsOpen: false }) }}>
    <Tabs defaultValue="voice" orientation="vertical" className="settings-layout">
      <nav><h2 id="m-title" tabIndex={-1} autoFocus>Settings</h2>
        <TabsList className="settings-tabs">
          <TabsTrigger value="voice"><Mic />Voice</TabsTrigger>
          <TabsTrigger value="model"><Sparkles />Model</TabsTrigger>
          <TabsTrigger value="keys"><Keyboard />Keys</TabsTrigger>
        </TabsList>
        <footer>Verbally {d.version}<br />{d.update && <span>{d.update} is available<br /></span>}<a href="https://github.com/azdaev/verbally/blob/main/docs/DETAILS.md" target="_blank" rel="noopener">Docs <ArrowUpRight /></a></footer>
      </nav>
      <div className="content">
        <IconButton className="x" label="Close settings" icon={X} onClick={() => ui.update({ settingsOpen: false })} />
        <TabsContent value="voice"><h3>Voice</h3><div className="group"><h4>Who listens</h4>
          <RadioGroup className="list" value={s.dictation ? 'dictation' : 'mic'} onValueChange={v => change('speech', v)} aria-label="Who listens">
            {d.app && <Choice value="dictation" title={d.app} detail="Your dictation app. It listens with its own model." tag="Running" />}
            <Choice value="mic" title="Verbally's microphone" detail="Built in. Needs no other app." />
            {(d.others || '').split(', ').filter(Boolean).map(name => <Choice key={name} value={name} title={name} tag="Not running" disabled />)}
          </RadioGroup><p className="note">Start a dictation app, then reload the page to choose it.</p></div>
          {/* The keys live on the Keys tab only; here is what each listener needs. */}
          {s.dictation ? <div className="group"><h4>{d.app || 'Your dictation app'}</h4>
            <p className="note">The app hears you and pastes the text. Verbally uses the text as the phrase. {d.key ? <>To talk, hold <Key>{d.key}</Key>.</> : 'To talk, use its own key.'}</p></div>
          : <div className="group"><h4>Verbally's microphone</h4><div className="list">
            <div className="item"><span>Recognizer<small>{d.recognizer === 'Soniox' ? 'Uses your Soniox connection.' : 'The audio goes to Google.'}</small></span><span>{d.recognizer === 'Soniox' ? 'Soniox' : 'Chrome'}</span></div>
            {d.recognizer !== 'Soniox' && <label className="item"><span>Language you speak</span><select aria-label="Language you speak" value={s.lang} onChange={e => change('lang', e.target.value)}>{Object.entries({ ...languages, ...(!languages[s.lang] ? { [s.lang]: s.lang } : {}) }).map(([v, name]) => <option key={v} value={v}>{name}</option>)}</select></label>}
          </div></div>}
        </TabsContent>
        <TabsContent value="model"><h3>Model</h3><div className="group"><h4>Engine</h4>
          <RadioGroup className="list" aria-label="Engine" value={s.engine} onValueChange={v => change('engine', v)}>
            {/* d.version: the server answered; before that nothing is known about the CLIs. */}
            <Choice value="claude" title="Claude Code" detail="Uses your Claude Code login." disabled={d.version && !d.claude && s.engine !== 'claude'} tag={d.version && !d.claude ? 'Not installed' : ''} />
            <Choice value="codex" title="Codex CLI" detail="Uses your Codex CLI login." disabled={d.version && !d.codex && s.engine !== 'codex'} tag={d.version && !d.codex ? 'Not installed' : ''} />
          </RadioGroup></div>
          <div className="group"><h4>Writes the changes</h4>
          {s.engine === 'claude' ? <>
            <RadioGroup className="list" aria-label="Model" value={s.model} onValueChange={v => change('model', v)}>
              <Choice value="claude-opus-5-5" title="Opus" detail="The best result. Uses more of your Claude plan." />
              <Choice value="claude-sonnet-5-5" title="Sonnet" detail="Faster, and lighter on your Claude plan." />
            </RadioGroup><p className="note">Uses Claude Code on your machine, with your subscription.</p>
          </> : <>
            <label className="item list"><span>Model<small>{s.engine === 'codex' ? (d.codexModel ? `Empty: ${d.codexModel}, from your Codex config.` : 'Empty: the Codex default.') : 'A model ID of OpenRouter.'}</small></span>
              <input className="model-name" aria-label="Model name" placeholder={s.engine === 'codex' ? d.codexModel || 'Codex default' : 'Model ID'} value={s.model} onChange={e => change('model', e.target.value)} />
            </label><p className="note">{s.engine === 'codex' ? 'Codex reads the project. Verbally applies each change and keeps undo available.' : 'Uses your OpenRouter connection.'}</p>
          </>}
          </div></TabsContent>
        <TabsContent value="keys"><h3>Keys</h3><div className="list">
          <div className="item"><span>Talk</span><span><TalkKey settings={s} /></span></div>
          <div className="item"><span>Point at a thing</span><span>hold <Key>{OPT}</Key>, move the mouse</span></div>
          <div className="item"><span>Mark a place ① ②</span><span>hold <Key>{OPT}</Key>, stop the mouse</span></div>
          <div className="item"><span>Undo</span><span><Key>{CMD}</Key><Key>Z</Key></span></div>
          <div className="item"><span>Redo</span><span><Key>{MAC ? '⇧' : 'Shift'}</Key><Key>{CMD}</Key><Key>Z</Key></span></div>
        </div></TabsContent>
      </div>
    </Tabs>
  </dialog>
}
flushSync(() => createRoot(mount).render(<><canvas id="trail" /><Toolbar /><Tasks /><Picker /><SettingsWindow /></>))
