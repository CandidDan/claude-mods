import { expect, mock, test } from 'claude-code/testing'

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const planJson = JSON.stringify({
  headline: 'Two clear hours, then the call.',
  blocks: [
    { start: '14:00', end: '16:00', label: 'Runlist', kind: 'work' },
    { start: '16:00', end: '16:30', label: 'Call with Matt', kind: 'fixed' },
  ],
  next: [
    { title: 'Finish the conference runlist', why: 'gates everything before Friday', minutes: 60, who: 'claude' },
    { title: 'Reply to Leah', why: 'she asked yesterday', minutes: 10, who: 'you' },
  ],
  sources: ['session'],
})

/** The world beneath the plugin: no MCP tools, a pane that opens, a status line, a prompt box. */
function world(on: Parameters<Parameters<typeof test>[1]>[1], isPlaced = true) {
  on('tool.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('command.register', () => ({ value: {} }))
  on('prompt.fill', () => ({ value: undefined }))
}

const PANE = { plugin: 'day', component: 'Pane', requestId: 'day' } as const
const paneProps = {
  title: 'Today',
  isFocused: false,
  bodyColumns: 48,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}
const BAND = { plugin: 'day', component: 'AbovePrompt' } as const
const bandProps = { hasSurvey: false, isWorking: false, maxRows: 10, columns: 100 }

test('/today plans from a fork: now, then and schedule in the pane on each surface', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 8, 3, 0) })
  world(on)
  on('model.fork', () => ({ value: { isAnswered: true as const, text: planJson, usage } }))

  const ran = await $.command.run({ command: 'today', args: '' })
  expect(ran.text).toBe('Now: Finish the conference runlist. The rest is in the Today pane.')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface, props: paneProps })
    expect((await ui.find({ key: 'now' }))?.text).toContain('Finish the conference runlist')
    expect(await ui.find({ type: 'Text', text: /60m · claude/ })).toBeDefined()
    const rest = await ui.find({ key: 'plan' })
    expect(rest?.text).toContain('Reply to Leah')
    expect(rest?.text).not.toContain('Finish the conference runlist')
    expect(await ui.find({ type: 'Text', text: /14:00 Runlist · 16:00 Call with Matt/ })).toBeDefined()
    expect(await ui.find({ key: 'start' })).toBeDefined()
    await ui.unmount()
  }
})

test('Done moves the next item up, in the pane and the band', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 8, 3, 0) })
  world(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('model.fork', () => ({ value: { isAnswered: true as const, text: planJson, usage } }))
  await $.command.run({ command: 'today', args: '' })

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop', props: paneProps })
  await pane.press({ key: 'done' })
  expect((await pane.find({ key: 'now' }))?.text).toContain('Reply to Leah')
  expect(await pane.find({ key: 'plan' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /1 done/ })).toBeDefined()
  await pane.unmount()

  const band = await $.ui.mount({ ...BAND, surface: 'desktop', props: bandProps })
  expect(await band.find({ type: 'Text', text: /Reply to Leah/ })).toBeDefined()
  await band.press({ key: 'band-done' })
  await band.unmount()

  const after = await $.ui.mount({ ...PANE, surface: 'desktop', props: paneProps })
  expect(await after.find({ type: 'Text', text: /All done/ })).toBeDefined()
  await after.unmount()
})

test('a replan is told what was done and starts the list afresh', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 8, 3, 0) })
  world(on)
  let asked = ''
  on('model.fork', ($, e) => {
    asked = e.prompt
    return { value: { isAnswered: true as const, text: planJson, usage } }
  })
  await $.command.run({ command: 'today', args: '' })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop', props: paneProps })
  await pane.press({ key: 'done' })
  await pane.unmount()

  await $.command.run({ command: 'today', args: '' })
  expect(asked).toContain('Already done since the last plan')
  expect(asked).toContain('- Finish the conference runlist')
  const again = await $.ui.mount({ ...PANE, surface: 'desktop', props: paneProps })
  expect((await again.find({ key: 'now' }))?.text).toContain('Finish the conference runlist')
  await again.unmount()
})

test('the band is empty with no plan, and after /today off', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 8, 3, 0) })
  world(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('model.fork', () => ({ value: { isAnswered: true as const, text: planJson, usage } }))

  const empty = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps })
  expect(await empty.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await empty.unmount()

  await $.command.run({ command: 'today', args: '' })
  const shown = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps })
  expect(await shown.find({ type: 'Text', text: /Finish the conference runlist/ })).toBeDefined()
  await shown.unmount()

  const off = await $.command.run({ command: 'today', args: 'off' })
  expect(off.text).toContain('hidden')
  const hidden = await $.ui.mount({ ...BAND, surface: 'terminal', props: bandProps })
  expect(await hidden.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await hidden.unmount()
})

test('/today eod widens the window to the end of the day', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 8, 3, 0) }) // 03:00 UTC
  world(on)
  let askedFor = ''
  on('model.fork', ($, e) => {
    askedFor = e.prompt
    return { value: { isAnswered: true as const, text: planJson, usage } }
  })

  await $.command.run({ command: 'today', args: 'eod' })
  expect(askedFor).toMatch(/Plan the next \d+(\.\d+)? hours/)
  expect(askedFor).not.toContain('Plan the next 4 hours')
})

test('an answer in the old shape keeps its waiting items, marked as yours', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 8, 3, 0) })
  world(on, false)
  const old = JSON.stringify({
    headline: 'Old shape.',
    blocks: [],
    next: [{ title: 'Write the tests', why: 'they gate the merge', minutes: 20 }],
    waiting: [{ title: 'Approve the domain transfer', why: 'registrar email outstanding' }],
    sources: ['session'],
  })
  on('model.fork', () => ({ value: { isAnswered: true as const, text: old, usage } }))

  const ran = await $.command.run({ command: 'today', args: '' })
  expect(ran.text).toContain('Approve the domain transfer _(you)_')
})

test('a plan an earlier version stored is read as none', async ($, on) => {
  world(on)
  on('state.get', ($, e) =>
    e.key === 'plan'
      ? { value: { value: { headline: 'old', blocks: [], next: [], waiting: [] }, version: 1 } }
      : { value: { value: undefined, version: 0 } },
  )

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: paneProps })
  expect(await ui.find({ type: 'Text', text: /No plan yet/ })).toBeDefined()
  await ui.unmount()
})

test('nothing to fork yet is said in the pane, not thrown', async ($, on) => {
  mock.clock(on)
  world(on)
  on('model.fork', () => ({ value: { isAnswered: false as const, reason: 'nothing-to-fork' as const } }))
  on('session.messages', () => ({ value: [] }))

  const ran = await $.command.run({ command: 'today', args: '' })
  expect(ran.text).toContain('send one prompt')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: paneProps })
  expect(await ui.find({ text: /send one prompt/ })).toBeDefined()
  await ui.unmount()
})

test('after a resume (nothing to fork) it plans from the saved transcript', async ($, on) => {
  mock.clock(on)
  world(on)
  on('model.fork', () => ({ value: { isAnswered: false as const, reason: 'nothing-to-fork' as const } }))
  on('session.messages', () => ({
    value: [{ role: 'user' as const, text: 'ship the handoff fix', toolUses: [] }],
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  let sent = ''
  on('model.complete', ($, e) => {
    sent = e.prompt
    return { value: { isAnswered: true as const, text: planJson, usage } }
  })

  const ran = await $.command.run({ command: 'today', args: '' })
  expect(sent).toContain('USER: ship the handoff fix')
  expect(ran.text).not.toContain('send one prompt')
  expect(ran.text).not.toContain('Could not plan')
})

test('with no pane on the surface, the whole plan comes back in the reply', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 8, 3, 0) })
  world(on, false)
  on('model.fork', () => ({ value: { isAnswered: true as const, text: planJson, usage } }))

  const ran = await $.command.run({ command: 'today', args: '' })
  expect(ran.text).toContain('Two clear hours')
  expect(ran.text).toContain('**Now:** Finish the conference runlist _(60m · claude)_')
  expect(ran.text).toContain('2. Reply to Leah _(10m · you)_')
  expect(ran.text).toContain('**Schedule** 14:00 Runlist · 16:00 Call with Matt')
  expect(ran.text).not.toContain('Today pane')
})
