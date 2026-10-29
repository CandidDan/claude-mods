import { expect, mock, test } from 'claude-code/testing'

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const note = '# Handoff · ship the day mod · 15:30\n## State\n- Done: pushed\n## Next\n1. install it'

type On = Parameters<Parameters<typeof test>[1]>[1]

/** An in-memory folder beneath the plugin. */
function disk(on: On, files: Record<string, string>) {
  on('session.cwd', () => ({ value: '/repo' }))
  on('fs.exists', ($, e) => ({ value: e.path in files }))
  on('fs.read', ($, e) => ({ value: files[e.path] ?? '' }))
  on('fs.write', ($, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    if (e.argv[0] === 'rm') delete files[String(e.argv[2])]
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('command.register', () => ({ value: {} }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.copy', () => ({ value: { isCopied: true as const } }))
  on('ui.log', () => ({ value: undefined }))
  return files
}

const start = { cwd: '/repo', surface: 'terminal' as const, isInteractive: true }
const turn = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' as const }

test('/handoff writes the note from a fork, /handoff clear removes it', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 8, 4, 30) })
  const files = disk(on, {})
  on('model.fork', () => ({ value: { isAnswered: true as const, text: note, usage } }))
  await $.session.start(start)

  const ran = await $.command.run({ command: 'handoff', args: '' })
  expect(ran.text).toContain('HANDOFF.md')
  expect(ran.text).toContain('copied')
  expect(files['/repo/HANDOFF.md']).toContain('# Handoff · ship the day mod')
  expect(files['/repo/HANDOFF.md']).toContain('written by the handoff mod at 2026-10-08T04:30')

  const cleared = await $.command.run({ command: 'handoff', args: 'clear' })
  expect(cleared.text).toContain('cleared')
  expect(files['/repo/HANDOFF.md']).toBeUndefined()
})

test('a session that starts beside a handoff note appends it for the model', async ($, on) => {
  mock.clock(on)
  const session = mock.session(on)
  disk(on, { '/repo/HANDOFF.md': `${note}\n\n<!-- written by the handoff mod at 2026-10-08T04:30:00.000Z -->\n` })
  await $.session.start(start)

  const rows = session.appended()
  expect(rows.length).toBe(1)
  expect(JSON.stringify(rows[0])).toContain('ship the day mod')
})

test('session end writes only after enough turns, and never on /clear', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 8, 4, 30) })
  const files = disk(on, {})
  let forks = 0
  on('model.fork', () => {
    forks += 1
    return { value: { isAnswered: true as const, text: note, usage } }
  })
  await $.session.start(start)

  await $.turn.complete(turn)
  await $.session.end({ reason: 'other', sessionId: 's', resume: { id: 's' } })
  expect(forks).toBe(0) // one turn: below minTurns

  await $.turn.complete(turn)
  await $.turn.complete(turn)
  await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
  expect(forks).toBe(0) // /clear: no handoff

  await $.session.end({ reason: 'other', sessionId: 's', resume: { id: 's' } })
  expect(forks).toBe(1)
  expect(files['/repo/HANDOFF.md']).toContain('# Handoff')
})

test('after a resume (nothing to fork) it falls back to the saved transcript', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 11, 0, 20) })
  const files = disk(on, {})
  on('model.fork', () => ({ value: { isAnswered: false as const, reason: 'nothing-to-fork' as const } }))
  on('session.messages', () => ({
    value: [
      { role: 'user' as const, text: 'ship the day mod', toolUses: [] },
      { role: 'assistant' as const, text: 'pushed', toolUses: [] },
    ],
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  let sent = ''
  on('model.complete', ($, e) => {
    sent = e.prompt
    return { value: { isAnswered: true as const, text: note, usage } }
  })
  await $.session.start(start)

  const ran = await $.command.run({ command: 'handoff', args: '' })
  expect(sent).toContain('USER: ship the day mod')
  expect(ran.text).toContain('Handoff written')
  expect(files['/repo/HANDOFF.md']).toContain('# Handoff · ship the day mod')
})

test('an empty session says so plainly', async ($, on) => {
  mock.clock(on)
  disk(on, {})
  on('model.fork', () => ({ value: { isAnswered: false as const, reason: 'nothing-to-fork' as const } }))
  on('session.messages', () => ({ value: [] }))
  await $.session.start(start)

  const ran = await $.command.run({ command: 'handoff', args: '' })
  expect(ran.text).toContain('no conversation yet')
})

const BAND = { plugin: 'handoff', component: 'AbovePrompt' } as const
const bandProps = { hasSurvey: false, isWorking: false, maxRows: 10, columns: 100 }

/** The live context the next usage read reports, and an engine band beneath. */
function context(on: On) {
  const live = { tokens: 0 }
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: live.tokens, window: 1_000_000 }, rateLimits: [] } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('classic.SessionStart', () => ({}))
  return live
}

async function bandText($: Parameters<Parameters<typeof test>[1]>[0]) {
  const band = await $.ui.mount({ ...BAND, surface: 'desktop', props: bandProps } as never)
  const text = (await band.find({ type: 'Box' }))?.text ?? (await band.find({ type: 'Text' }))?.text
  await band.unmount()
  return text
}

async function pressBand($: Parameters<Parameters<typeof test>[1]>[0], key: string) {
  const band = await $.ui.mount({ ...BAND, surface: 'desktop', props: bandProps } as never)
  await band.press({ key })
  await band.unmount()
}

test('past 60% of the window it offers a handoff above the prompt; Hand off writes it and /clear picks it up', async ($, on) => {
  mock.clock(on, { now: Date.UTC(2026, 9, 28, 4, 30) })
  const files = disk(on, {})
  const live = context(on)
  on('model.fork', () => ({ value: { isAnswered: true as const, text: note, usage } }))
  await $.session.start(start)

  live.tokens = 550_000
  await $.turn.complete(turn)
  expect(await bandText($)).toBe('engine')

  live.tokens = 612_000
  await $.turn.complete(turn)
  expect(await bandText($)).toBe('Context 612k of 1M · hand off to a fresh chat? Hand off Not nowengine')

  await pressBand($, 'handoff')
  expect(files['/repo/HANDOFF.md']).toContain('# Handoff · ship the day mod')
  expect(await bandText($)).toContain('Handoff written and copied. /clear here')

  const cleared = await $.classic.SessionStart({ source: 'clear' } as never)
  expect(JSON.stringify(cleared)).toContain('ship the day mod')
  expect(await bandText($)).toBe('engine')

  // Only a handoff written in this chat comes back after /clear.
  const again = await $.classic.SessionStart({ source: 'clear' } as never)
  expect(JSON.stringify(again)).not.toContain('ship the day mod')
})

test('Not now waits until the chat has grown another tenth of its window', async ($, on) => {
  mock.clock(on)
  disk(on, {})
  const live = context(on)
  await $.session.start(start)

  live.tokens = 610_000
  await $.turn.complete(turn)
  await pressBand($, 'snooze')
  expect(await bandText($)).toBe('engine')

  live.tokens = 690_000
  await $.turn.complete(turn)
  expect(await bandText($)).toBe('engine')

  live.tokens = 715_000
  await $.turn.complete(turn)
  expect(await bandText($)).toContain('Context 715k')
})

test('offerAtPercent 0 never offers', { options: { offerAtPercent: 0 } }, async ($, on) => {
  mock.clock(on)
  disk(on, {})
  const live = context(on)
  await $.session.start(start)
  live.tokens = 900_000
  await $.turn.complete(turn)
  expect(await bandText($)).toBe('engine')
})
