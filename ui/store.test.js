import test from 'node:test'
import assert from 'node:assert/strict'
import { createUIStore } from './store.js'

test('a renamed task keeps the original cancellation handle', () => {
  const ui = createUIStore(), task = ui.task('Change title')
  let stopped = false
  task.stop = () => { stopped = true }
  task.update({ title: 'Writing title' })
  const shown = ui.getSnapshot().tasks[0]
  shown.handle.cancelled = true
  shown.handle.stop()
  assert.equal(task.cancelled, true)
  assert.equal(stopped, true)
  task.update({ kind: 'skip' })
  assert.equal(ui.getSnapshot().tasks[0].kind, 'skip')
})
test('picker keeps the selected version and ignores late choices after close', () => {
  const ui = createUIStore(), calls = []
  ui.openPicker('Versions', false, () => calls.push('cancel'))
  ui.addChoice(null, () => calls.push('view1'), () => calls.push('keep1'), true)
  ui.addChoice(null, () => calls.push('view2'), () => calls.push('keep2'))
  ui.keepChoice()
  assert.deepEqual(calls, [])
  ui.choose(1); ui.keepChoice()
  assert.deepEqual(calls, ['view2', 'keep2'])
  ui.cancelChoice()
  assert.equal(calls.at(-1), 'cancel')
  ui.closePicker(); ui.addChoice(null, () => {}, () => {})
  assert.equal(ui.getSnapshot().picker, null)
})
test('the first ready version shows at once and can be kept', () => {
  const ui = createUIStore(), calls = []
  ui.openPicker('Versions', true, () => calls.push('cancel'))
  ui.addChoice(null, () => calls.push('view1'), () => calls.push('keep1'))
  ui.addChoice(null, () => calls.push('view2'), () => calls.push('keep2'))
  assert.deepEqual(calls, ['view1']) // the second one waits for a choice
  ui.keepChoice()
  assert.deepEqual(calls, ['view1', 'keep1'])
})
test('clearing a page removes tasks but keeps errors and independent controls', () => {
  const ui = createUIStore()
  ui.task('Waiting'); ui.task('Connection failed', 'err')
  ui.update({ recording: true, live: 'hello' })
  ui.clearTasks()
  assert.equal(ui.getSnapshot().tasks.length, 1)
  assert.equal(ui.getSnapshot().tasks[0].kind, 'err')
  assert.equal(ui.getSnapshot().recording, true)
  assert.equal(ui.getSnapshot().live, 'hello')
})
