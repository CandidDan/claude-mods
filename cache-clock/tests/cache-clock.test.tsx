import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const MIN = 60_000
const T0 = Date.UTC(2026, 9, 28, 10, 0)
const BAND = { plugin: 'cache-clock', component: 'AbovePrompt' } as const
const bandProps = { hasSurvey: false, isWorking: false, maxRows: 10, columns: 100 }

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
const usage = (read: number, write: number): Usage => ({ input_tokens: 10, output_tokens: 50, cache_read_input_tokens: read, cache_creation_input_tokens: write })

type On = Parameters<TestBody>[1]
type Step = Parameters<TestBody>[0]

/** The world beneath: a session, commands, toasts, and each model response the test sets. */
function world(on: On, store: Record<string, unknown> = {}) {
  const toasts: string[] = []
  const next: { usage: Usage | null } = { usage: null }
  mock.store(on, store)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: {} }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('ui.toast', ($, e) => {
    toasts.push(String((e as { text?: string }).text ?? e))
    return { value: undefined }
  })
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: 'done', toolUses: [], stopReason: 'end_turn' as const, usage: next.usage && { ...next.usage, model: 'claude-opus-5-5' } }
  })
  return { toasts, next }
}

/** One main-thread request answered with this usage; `agentId` makes it a subagent's. */
async function respond($: Step, w: ReturnType<typeof world>, u: Usage, messageCount = 10, agentId?: string) {
  w.next.usage = u
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'opus', messageCount, ...(agentId ? { agentId } : {}) })
  for await (const _ of stream) void _
  await stream.result
}

async function bandText($: Step) {
  const band = await $.ui.mount({ ...BAND, surface: 'desktop', props: bandProps })
  const text = (await band.find({ type: 'Box' }))?.text ?? (await band.find({ type: 'Text' }))?.text
  await band.unmount()
  return text
}

const start = ($: Step) => $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

test('counts down from the last request, assuming 5m until it knows, then shows cold', async ($, on) => {
  const time = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  expect(await bandText($)).toBe('engine')

  await respond($, w, usage(0, 120_000))
  expect(await bandText($)).toMatch(/Cache warm · 5m left of 5m\?/)

  await time.advance(4 * MIN + 30_000)
  expect(await bandText($)).toMatch(/30s left/)

  await time.advance(MIN)
  expect(await bandText($)).toMatch(/Cache cold · next message re-sends 120k tokens at full price/)
  expect((await $.command.run({ command: 'cache', args: '' })).text).toContain('Cache cold')
})

test('a cache read after a 10 minute gap teaches it 1h', async ($, on) => {
  const time = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await respond($, w, usage(0, 100_000))
  await time.advance(10 * MIN)
  await respond($, w, usage(100_000, 2_000), 12)
  expect(await bandText($)).toMatch(/60m left of 1h /)
})

test('a fresh write after a 10 minute gap teaches it 5m', async ($, on) => {
  const time = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await respond($, w, usage(0, 100_000))
  await time.advance(10 * MIN)
  await respond($, w, usage(0, 102_000), 12)
  expect(await bandText($)).toMatch(/5m left of 5m /)
})

test('a shorter conversation after compaction teaches nothing', async ($, on) => {
  const time = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await respond($, w, usage(0, 100_000), 40)
  await time.advance(10 * MIN)
  await respond($, w, usage(0, 30_000), 3)
  expect(await bandText($)).toMatch(/left of 5m\?/)
})

test("a subagent's request leaves the clock alone", async ($, on) => {
  const time = mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await respond($, w, usage(0, 100_000))
  await time.advance(4 * MIN)
  await respond($, w, usage(0, 5_000), 2, 'agent-1')
  expect(await bandText($)).toMatch(/1m left/)
})

test('Keep warm pings before cold, stops at the cap, and a message stops it', async ($, on) => {
  const time = mock.clock(on, { now: T0 })
  const w = world(on, { ttl: '5m' })
  let pings = 0
  on('model.fork', () => {
    pings += 1
    return { value: { isAnswered: true as const, text: 'ok', usage: usage(100_000, 0) } }
  })
  await start($)
  await respond($, w, usage(0, 100_000))

  const band = await $.ui.mount({ ...BAND, surface: 'desktop', props: bandProps })
  await band.press({ key: 'warm' })
  await band.unmount()
  expect(await bandText($)).toMatch(/kept warm 0\/6/)

  await time.advance(4 * MIN + 20_000)
  expect(pings).toBe(1)
  expect(await bandText($)).toMatch(/5m left of 5m · kept warm 1\/6/)

  await $.prompt.submit({ text: 'next thing' })
  expect(await bandText($)).toMatch(/Keep warm/)
  await time.advance(5 * MIN)
  expect(pings).toBe(1)
})

test('Keep warm stops after its cap with a toast', { options: { keepWarmPings: 2 } }, async ($, on) => {
  const time = mock.clock(on, { now: T0 })
  const w = world(on, { ttl: '5m' })
  on('model.fork', () => ({ value: { isAnswered: true as const, text: 'ok', usage: usage(100_000, 0) } }))
  await start($)
  await respond($, w, usage(0, 100_000))
  expect((await $.command.run({ command: 'cache', args: 'warm' })).text).toContain('up to 2 pings')
  await time.advance(15 * MIN)
  expect(w.toasts.join('|')).toContain('Keep warm stopped after 2 pings.')
})

test('/cache off hides the line and /cache on brings it back', async ($, on) => {
  mock.clock(on, { now: T0 })
  const w = world(on)
  await start($)
  await respond($, w, usage(0, 100_000))
  expect((await $.command.run({ command: 'cache', args: 'off' })).text).toContain('hidden')
  expect(await bandText($)).toBe('engine')
  expect((await $.command.run({ command: 'cache', args: 'on' })).text).toContain('Cache warm')
  expect(await bandText($)).toMatch(/Cache warm/)
})
