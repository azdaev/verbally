// The engine owns edits. React owns controls. Snapshots contain UI state only.
export function createUIStore(code = false) {
  let state = { code, live: '', pointer: '', busy: false, recording: false, hears: false, waiting: false,
    mic: false, tools: code, canUndo: code, canRedo: code, canClear: false, settingsOpen: false,
    settings: { engine: 'claude', dictation: false, lang: 'en-US', model: 'claude-opus-5-5', talk: {} },
    tasks: [], picker: null }
  const listeners = new Set()
  const actions = {}
  const update = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn()) }
  let nextId = 0
  const task = (text, kind = '') => {
    const handle = { id: ++nextId, text, title: '', kind, cancelled: false, n: 0, stop: null,
      update(patch) { Object.assign(handle, patch); update({ tasks: state.tasks.map(t => t.id === handle.id ? { ...handle, handle } : t) }) },
      remove() { update({ tasks: state.tasks.filter(t => t.id !== handle.id) }) } }
    update({ tasks: [...state.tasks, { ...handle, handle }] })
    return handle
  }
  const choose = index => {
    const picker = state.picker, item = picker?.items[index]
    if (!item) return
    update({ picker: { ...picker, selected: index, chosen: true } })
    item.view()
  }
  return { getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    update, actions, task, choose,
    clearTasks() { update({ tasks: state.tasks.filter(t => t.kind === 'err' || t.kind === 'hint') }) },
    openPicker(title, wide, cancel) { update({ picker: { title, wide, cancel, items: [], selected: -1, chosen: false } }) },
    closePicker() { update({ picker: null }) },
    pickerTitle(title) { if (state.picker) update({ picker: { ...state.picker, title } }) },
    addChoice(thumb, view, keep, now) {
      const p = state.picker
      if (!p) return
      const index = p.items.length
      update({ picker: { ...p, selected: now ? index : p.selected, items: [...p.items, { thumb, view, keep }] } })
      // Nothing shown yet: the first ready version shows at once, so "Use this" works without a click.
      if (!now && p.selected < 0) choose(index)
    },
    keepChoice() { const p = state.picker; if (p?.chosen) p.items[p.selected]?.keep() },
    cancelChoice() { state.picker?.cancel() }
  }
}
