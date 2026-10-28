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
  const set = { review: weakReview, answer: 'Improve it', fails: false }
  mock.clock(on, { now: Date.UTC(2026, 9, 28, 10, 0) })
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
    const q = e.questions[0]?.question ?? ''
    seen.asked.push(q)
    const answer = q.includes('Improve it first') || q.includes('brief first') ? set.answer : 'Home'
    return { result: { questions: e.questions, answers: { [q]: answer } } }
  })
  on('model.complete', ($, e) => {
    const isReview = String(e.system ?? '').includes('Return JSON only')
    seen.prompt = String(e.prompt)
    if (isReview) seen.reviews += 1
    else seen.rewrites += 1
    if (set.fails) return { value: { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded', usage } }
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
  return { seen, set }
}

const start = ($: Step) => $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
const submit = ($: Step, text: string, origin: { kind: string } = composer) => $.prompt.submit({ text, origin, wait: false } as never) as Promise<{ text?: string; drop?: string }>

test('a good prompt goes straight through, with no question', async ($, on) => {
  const { seen, set } = world(on)
  set.review = goodReview
  await start($)
  await submit($, GOOD)
  expect(seen.reviews).toBe(1)
  expect(seen.asked).toEqual([])
  expect(seen.passed).toEqual([GOOD])
})

test('a weak prompt says why, asks what it lacks, and puts the improved prompt in the box', async ($, on) => {
  const { seen } = world(on)
  await start($)
  const r = await submit($, WEAK)
  expect(seen.asked[0]).toBe('Claude rates this prompt 2/5: which page: home or pricing; what "off" means. Improve it first?')
  expect(seen.asked[1]).toBe('Which page?')
  expect(r.drop).toBe('improved in the prompt box')
  expect(seen.filled).toEqual([BETTER])
  expect(seen.passed).toEqual([])

  // Sending the improved prompt is not reviewed again.
  await submit($, BETTER)
  expect(seen.reviews).toBe(1)
  expect(seen.passed).toEqual([BETTER])
})

test('Send as is sends the weak prompt unchanged', async ($, on) => {
  const { seen, set } = world(on)
  set.answer = 'Send as is'
  await start($)
  await submit($, WEAK)
  expect(seen.rewrites).toBe(0)
  expect(seen.passed).toEqual([WEAK])
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
  expect(seen.asked).toEqual([])
  expect(seen.passed).toEqual([dump])

  set.review = weakReview
  const r = await submit($, dump)
  expect(seen.asked[0]).toBe('This reads like a brain dump (2/5): which page: home or pricing; what "off" means. Shape it into a brief first?')
  expect(r.drop).toBe('improved in the prompt box')
})

test('a 3/5 goes through by default', async ($, on) => {
  const { seen, set } = world(on)
  set.review = JSON.stringify({ score: 3, issues: ['which file'], gaps: ['scope'], questions: [] })
  await start($)
  await submit($, WEAK)
  expect(seen.asked).toEqual([])
  expect(seen.passed).toEqual([WEAK])
})

test("the desktop app's own messages, such as another session's report, are left alone", async ($, on) => {
  const { seen } = world(on)
  await start($)
  const report = `<system-reminder>\nThe session "Worker: flow-0173" you started finished a turn. ${Array.from({ length: 300 }, () => 'report').join(' ')}\n</system-reminder>`
  await submit($, report, { kind: 'sdk' })
  await submit($, '<task-notification><status>completed</status> the background command finished with output</task-notification>', { kind: 'sdk' })
  expect(seen.reviews).toBe(0)
  expect(seen.passed.length).toBe(2)
})

test('the review is told about an attached image it cannot see', async ($, on) => {
  const { seen, set } = world(on)
  set.review = goodReview
  await start($)
  await $.prompt.submit({ text: 'Think this might be triggering on the wrong thing, is it just on length?', origin: composer, wait: false, attachments: [{ id: 'img1', kind: 'image' }] } as never)
  expect(seen.prompt).toContain('The person attached 1 image or file you cannot see')
  expect(seen.asked).toEqual([])
})

test('a failed review sends the prompt as typed', async ($, on) => {
  const { seen, set } = world(on)
  set.fails = true
  await start($)
  await submit($, WEAK)
  expect(seen.asked).toEqual([])
  expect(seen.passed).toEqual([WEAK])
})

test('after mode sends at once and shows the rating above the prompt', async ($, on) => {
  const { seen } = world(on)
  await start($)
  expect((await $.command.run({ command: 'coach', args: 'after' } as never)).text).toContain('Mode: after')
  await submit($, WEAK)
  expect(seen.passed).toEqual([WEAK])
  expect(seen.asked).toEqual([])
  const band = await $.ui.mount({ ...BAND, surface: 'desktop', props: bandProps } as never)
  expect((await band.find({ type: 'Box' }))?.text).toBe('Last prompt 2/5 · which page: home or pricing')
  await band.unmount()
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
