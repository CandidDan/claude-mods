import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type Step = Parameters<TestBody>[0]
// Typed loosely: the AskUserQuestion matcher's full type is too deep for tsc.
type LooseOn = (event: string, match: object, hook: (_$: unknown, e: { questions: { question: string }[] }) => unknown) => void

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const WEAK = 'make the landing page better and fix the stuff that is off'
const GOOD = 'In src/pages/pricing.tsx, raise the Pro price to $24 and update the test in pricing.test.tsx to match'
const BETTER = 'In src/pages/home.tsx, tighten the hero copy and fix the CTA spacing on mobile. Done means it matches the Figma frame.'
const weakReview = JSON.stringify({
  score: 2,
  issues: ['which page: home or pricing', 'what "off" means'],
  gaps: ['scope', 'done'],
  questions: [{ q: 'Which page?', options: ['Home', 'Pricing'] }],
})
const goodReview = JSON.stringify({ score: 5, issues: [], gaps: [], questions: [] })
const composer = { kind: 'composer' } as const
const BAND = { plugin: 'prompt-coach', component: 'AbovePrompt' } as const
const bandProps = { hasSurvey: false, isWorking: false, maxRows: 10, columns: 100 }

/** The world beneath: a model whose review the test sets, a dialog that answers, a prompt box. */
function world(on: On, store: Record<string, unknown> = {}) {
  const seen = { prompt: '', reviews: 0, rewrites: 0, asked: [] as string[], filled: [] as string[], passed: [] as string[], toasts: [] as string[] }
  const set = { review: weakReview, fails: false, rewriteFails: false }
  const time = mock.clock(on, { now: Date.UTC(2026, 9, 28, 10, 0) })
  mock.store(on, store)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: {} }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    seen.toasts.push(String((e as { text?: string }).text ?? e))
    return { value: undefined }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  ;(on as unknown as LooseOn)('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    // The coach no longer opens the question dialog; any call here is a failure.
    const q = e.questions[0]?.question ?? ''
    seen.asked.push(q)
    return { result: { questions: e.questions, answers: { [q]: 'Send as is' } } }
  })
  on('model.complete', ($, e) => {
    const isReview = String(e.system ?? '').includes('Return JSON only')
    seen.prompt = String(e.prompt)
    if (isReview) seen.reviews += 1
    else seen.rewrites += 1
    if (set.fails || (!isReview && set.rewriteFails)) return { value: { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded', usage } }
    return { value: { isAnswered: true as const, text: isReview ? set.review : BETTER, usage } }
  })
  on('prompt.fill', ($, e) => {
    seen.filled.push(e.text)
    return { isFilled: true as const }
  })
  on('prompt.submit', ($, e) => {
    seen.passed.push(e.text)
    return { text: e.text }
  })
  return { seen, set, time }
}

const start = ($: Step) => $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
const submit = ($: Step, text: string, origin: { kind: string } = composer) => $.prompt.submit({ text, origin, wait: false } as never) as Promise<{ text?: string; drop?: string }>

/** The band's text: the coach's lines, then the engine's "engine" beneath. */
async function bandText($: Step) {
  const band = await $.ui.mount({ ...BAND, surface: 'desktop', props: bandProps } as never)
  const text = (await band.find({ type: 'Box' }))?.text ?? (await band.find({ type: 'Text' }))?.text
  await band.unmount()
  return text
}

async function press($: Step, key: string) {
  const band = await $.ui.mount({ ...BAND, surface: 'desktop', props: bandProps } as never)
  await band.press({ key })
  await band.unmount()
}

test('a good prompt goes straight through, with nothing in the band', async ($, on) => {
  const { seen, set } = world(on)
  set.review = goodReview
  await start($)
  await submit($, GOOD)
  expect(seen.reviews).toBe(1)
  expect(seen.passed).toEqual([GOOD])
  expect(await bandText($)).toBe('engine')
})

test('a weak prompt is held in the box with its rating above it; Improve asks in the band and fills the rewrite', async ($, on) => {
  const { seen } = world(on)
  await start($)
  const r = await submit($, WEAK)
  expect(r.drop).toBe('held by prompt-coach (2/5): see above the prompt box')
  expect(seen.passed).toEqual([])
  expect(seen.filled).toEqual([WEAK])
  expect(await bandText($)).toBe('Prompt 2/5 · which page: home or pricing; what "off" meansImprove it Send as isengine')

  await press($, 'coach-improve')
  expect(await bandText($)).toBe('Which page? (1/1)Home Pricing Skipengine')
  await press($, 'coach-option-0')
  expect(seen.prompt).toContain('Q: Which page?\nA: Home')
  expect(seen.filled).toEqual([WEAK, BETTER])
  expect(await bandText($)).toBe('engine')
  expect(seen.asked).toEqual([])

  // Sending the improved prompt is not reviewed again.
  await submit($, BETTER)
  expect(seen.reviews).toBe(1)
  expect(seen.passed).toEqual([BETTER])
})

test('an answer can be typed in the band instead of picked', async ($, on) => {
  const { seen } = world(on)
  await start($)
  await submit($, WEAK)
  await press($, 'coach-improve')
  const band = await $.ui.mount({ ...BAND, surface: 'desktop', props: bandProps } as never)
  await band.input({ key: 'coach-own', text: 'The about page' } as never)
  await band.unmount()
  expect(seen.prompt).toContain('A: The about page')
  expect(seen.filled).toEqual([WEAK, BETTER])
})

test('Send as is leaves the prompt in the box, and Enter sends it unchecked', async ($, on) => {
  const { seen } = world(on)
  await start($)
  await submit($, WEAK)
  await press($, 'coach-send')
  expect(await bandText($)).toBe('engine')
  expect(seen.toasts.join('|')).toContain('Press Enter to send it')
  await submit($, WEAK)
  expect(seen.reviews).toBe(1)
  expect(seen.rewrites).toBe(0)
  expect(seen.passed).toEqual([WEAK])
})

test('a failed rewrite keeps the prompt in the box, sendable as is', async ($, on) => {
  const { seen, set } = world(on)
  set.rewriteFails = true
  await start($)
  await submit($, WEAK)
  await press($, 'coach-improve')
  await press($, 'coach-skip')
  expect(seen.toasts.join('|')).toContain('Could not improve it')
  expect(await bandText($)).toBe('engine')
  await submit($, WEAK)
  expect(seen.passed).toEqual([WEAK])
})

test('a new prompt replaces an offer left unanswered', async ($, on) => {
  const { seen, set } = world(on)
  await start($)
  await submit($, WEAK)
  set.review = goodReview
  await submit($, GOOD)
  expect(seen.passed).toEqual([GOOD])
  expect(await bandText($)).toBe('engine')
})

test('short replies and prompts not typed by a person are left alone', async ($, on) => {
  const { seen } = world(on)
  await start($)
  await submit($, 'yes, do the next one')
  await submit($, WEAK, { kind: 'task-notification' })
  expect(seen.reviews).toBe(0)
  expect(seen.passed.length).toBe(2)
})

test('a long prompt is offered a brief only when it rates low', async ($, on) => {
  const { seen, set } = world(on)
  set.review = JSON.stringify({ score: 4, issues: [], gaps: [], questions: [] })
  await start($)
  const dump = Array.from({ length: 130 }, (_, i) => `word${i}`).join(' ')
  await submit($, dump)
  expect(seen.passed).toEqual([dump])

  set.review = JSON.stringify({ score: 2, issues: ['no goal'], gaps: ['goal'], questions: [] })
  const r = await submit($, dump)
  expect(r.drop).toContain('held by prompt-coach (2/5)')
  expect(await bandText($)).toBe('Brain dump 2/5 · no goalShape it into a brief Send as isengine')
  // No questions: the brief is written straight away.
  await press($, 'coach-improve')
  expect(seen.filled).toEqual([dump, BETTER])
})

test('a 3/5 goes through by default', async ($, on) => {
  const { seen, set } = world(on)
  set.review = JSON.stringify({ score: 3, issues: ['which file'], gaps: ['scope'], questions: [] })
  await start($)
  await submit($, WEAK)
  expect(seen.passed).toEqual([WEAK])
})

test("the desktop app's own messages, such as another session's report, are left alone", async ($, on) => {
  const { seen } = world(on)
  await start($)
  const report = `<system-reminder>\nThe session "Worker: flow-0173" you started finished a turn. ${Array.from({ length: 300 }, () => 'report').join(' ')}\n</system-reminder>`
  await submit($, report, { kind: 'sdk' })
  await submit($, '<ci-monitor-event>"Auto-fix pull requests" was just enabled for this session and will watch it</ci-monitor-event>', { kind: 'sdk' })
  expect(seen.reviews).toBe(0)
  expect(seen.passed.length).toBe(2)
})

test('the review is told about an attached image it cannot see', async ($, on) => {
  const { seen, set } = world(on)
  set.review = goodReview
  await start($)
  await $.prompt.submit({ text: 'Think this might be triggering on the wrong thing, is it just on length?', origin: composer, wait: false, attachments: [{ id: 'img1', kind: 'image' }] } as never)
  expect(seen.prompt).toContain('The person attached 1 image or file you cannot see')
})

test('a failed review sends the prompt as typed', async ($, on) => {
  const { seen, set } = world(on)
  set.fails = true
  await start($)
  await submit($, WEAK)
  expect(seen.passed).toEqual([WEAK])
  expect(await bandText($)).toBe('engine')
})

test('after mode sends at once and shows the rating above the prompt', async ($, on) => {
  const { seen, time } = world(on)
  await start($)
  expect((await $.command.run({ command: 'coach', args: 'after' } as never)).text).toContain('Mode: after')
  await submit($, WEAK)
  expect(seen.passed).toEqual([WEAK])
  await time.settle()
  expect(await bandText($)).toBe('Last prompt 2/5 · which page: home or pricingengine')
})

test('/coach sums up the ratings and the most common gaps', async ($, on) => {
  world(on, {
    history: [
      { score: 2, gaps: ['done', 'scope'] },
      { score: 3, gaps: ['done'] },
      { score: 5, gaps: [] },
    ],
  })
  await start($)
  const r = await $.command.run({ command: 'coach', args: '' } as never)
  expect(r.text).toBe('Last 3 prompts: 3.3/5 on average. Most common gaps: no done criteria (2), vague scope (1). Mode: before.')
})
