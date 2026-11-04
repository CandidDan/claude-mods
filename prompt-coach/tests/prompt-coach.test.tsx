import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type Step = Parameters<TestBody>[0]

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const WEAK = 'make the landing page better and fix the stuff that is off'
const GOOD = 'In src/pages/pricing.tsx, raise the Pro price to $24 and update the test in pricing.test.tsx to match'
const weakReview = JSON.stringify({ score: 2, issues: ['Which page, home or pricing?', 'What looks off?'], gaps: ['scope', 'done'] })
const fairReview = JSON.stringify({ score: 3, issues: ['Which test file?'], gaps: ['scope'] })
const goodReview = JSON.stringify({ score: 5, issues: [], gaps: [] })
const composer = { kind: 'composer' } as const
const BAND = { plugin: 'prompt-coach', component: 'AbovePrompt' } as const
const bandProps = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 }

/** The world beneath: a prompt box the test types into, a model whose review the test sets, a transcript. */
function world(on: On, store: Record<string, unknown> = {}) {
  const seen = { prompt: '', reviews: 0, passed: [] as string[] }
  const set = { box: '', review: weakReview, fails: false, transcript: [] as { role: 'user' | 'assistant'; text: string }[] }
  const time = mock.clock(on, { now: Date.UTC(2026, 10, 4, 10, 0) })
  mock.store(on, store)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'coach' } }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('prompt.read', () => ({ value: { text: set.box, cursor: set.box.length } }))
  on('session.messages', () => ({ value: set.transcript.map(m => ({ ...m, toolUses: [] })) }) as never)
  on('model.complete', ($, e) => {
    seen.prompt = String(e.prompt)
    seen.reviews += 1
    if (set.fails) return { value: { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded', usage } }
    return { value: { isAnswered: true as const, text: set.review, usage } }
  })
  on('prompt.submit', ($, e) => {
    seen.passed.push(e.text)
    set.box = ''
    return { text: e.text }
  })
  /** Types a draft into the box and leaves it there long enough to be looked at. */
  const type = async (text: string) => {
    set.box = text
    await time.advance(1000)
    await time.advance(3000)
    await time.settle()
  }
  return { seen, set, time, type }
}

const start = ($: Step) => $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
const submit = ($: Step, text: string, origin: { kind: string } = composer) => $.prompt.submit({ text, origin, wait: false } as never) as Promise<{ text?: string; drop?: string }>
const coach = async ($: Step, args = '') => (await $.command.run({ command: 'coach', args } as never)).text

/** The band's text: the coach's line, then the engine's "engine" beneath. */
async function bandText($: Step, props = bandProps) {
  const band = await $.ui.mount({ ...BAND, surface: 'desktop', props } as never)
  const text = (await band.find({ type: 'Box' }))?.text ?? (await band.find({ type: 'Text' }))?.text
  await band.unmount()
  return text
}

test('a draft that leaves something to guess gets one quiet line, with no score or button, and Enter sends it as typed', async ($, on) => {
  const { seen, type } = world(on)
  await start($)
  await type(WEAK)
  expect(seen.reviews).toBe(1)
  expect(await bandText($)).toBe('Worth saying: Which page, home or pricing?engine')
  const band = await $.ui.mount({ ...BAND, surface: 'desktop', props: bandProps } as never)
  expect(await band.find({ type: 'Button' })).toBeFalsy()
  await band.unmount()

  const r = await submit($, WEAK)
  expect(r.drop).toBeUndefined()
  expect(seen.passed).toEqual([WEAK])
  expect(await bandText($)).toBe('engine')
})

test('a good draft, and one with a single small guess, show nothing', async ($, on) => {
  const { set, seen, type } = world(on)
  await start($)
  set.review = goodReview
  await type(GOOD)
  expect(await bandText($)).toBe('engine')
  set.review = fairReview
  await type(`${GOOD} and the copy too`)
  expect(seen.reviews).toBe(2)
  expect(await bandText($)).toBe('engine')
})

test('a draft is looked at once it sits still, not while it is typed, and an edit clears its line', async ($, on) => {
  const { seen, set, time, type } = world(on)
  await start($)
  set.box = WEAK
  await time.advance(1000)
  await time.settle()
  expect(seen.reviews).toBe(0)
  await type(WEAK)
  expect(seen.reviews).toBe(1)
  set.box = `${WEAK}, the hero`
  await time.advance(1000)
  await time.settle()
  expect(await bandText($)).toBe('engine')
})

test('short drafts, slash commands and the app\'s own messages are not looked at', async ($, on) => {
  const { seen, type } = world(on)
  await start($)
  await type('yes do the next one')
  await type('/time export this month for the client please now')
  await type('<side-sessions-event>a session you started finished its turn</side-sessions-event>')
  expect(seen.reviews).toBe(0)
})

test('a failed review shows nothing', async ($, on) => {
  const { set, type } = world(on)
  set.fails = true
  await start($)
  await type(WEAK)
  expect(await bandText($)).toBe('engine')
})

test('the review sees the last reply, even after a restart', async ($, on) => {
  const { seen, set, type } = world(on)
  set.transcript = [{ role: 'assistant', text: 'Two options: a) a modal, b) a new page. Which do you want?' }]
  await start($)
  await type('go with b and keep the same header as the pricing page')
  expect(seen.prompt).toContain('<last_reply>')
  expect(seen.prompt).toContain('b) a new page')
})

test('/coach sums up what was sent; off stops the hints and on brings them back', async ($, on) => {
  const { seen, type } = world(on)
  await start($)
  await type(WEAK)
  await submit($, WEAK)
  expect(await coach($)).toBe('Last 1 prompts: 2.0/5 on average. Most common gaps: vague scope (1), no done criteria (1). Hints are on.')
  expect(await coach($, 'off')).toMatch(/Hints are off\.$/)
  await type(GOOD)
  expect(seen.reviews).toBe(1)
  await coach($, 'on')
  await type(GOOD)
  expect(seen.reviews).toBe(2)
})

test('a mode saved by 0.6 carries over: off stays off', async ($, on) => {
  const { seen, type } = world(on, { mode: 'off' })
  await start($)
  await type(WEAK)
  expect(seen.reviews).toBe(0)
  expect(await coach($)).toBe('No prompts looked at yet. Hints are off.')
})

test('a long hint is clipped to the band\'s width', async ($, on) => {
  const { set, type } = world(on)
  set.review = JSON.stringify({ score: 1, issues: [`Which ${'very '.repeat(60)}specific page?`], gaps: ['scope'] })
  await start($)
  await type(WEAK)
  const text = (await bandText($, { ...bandProps, bodyColumns: 40 }))!.replace(/engine$/, '')
  expect(text.length).toBeLessThanOrEqual(52)
  expect(text.endsWith('…')).toBe(true)
})
