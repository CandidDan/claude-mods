import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type Step = Parameters<TestBody>[0]

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
const bandProps = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 }

/** The world beneath: a prompt box the test types into, a model whose review the test sets, a transcript. */
function world(on: On, store: Record<string, unknown> = {}) {
  const seen = { prompt: '', reviews: 0, rewrites: 0, filled: [] as string[], passed: [] as string[], toasts: [] as string[] }
  const set = { box: '', review: weakReview, fails: false, rewriteFails: false, transcript: [] as { role: 'user' | 'assistant'; text: string }[] }
  const time = mock.clock(on, { now: Date.UTC(2026, 9, 28, 10, 0) })
  mock.store(on, store)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: {} }))
  on('ui.toast', ($, e) => {
    seen.toasts.push(String((e as { text?: string }).text ?? e))
    return { value: undefined }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('prompt.read', () => ({ value: { text: set.box, cursor: set.box.length } }))
  on('session.messages', () => ({ value: set.transcript.map(m => ({ ...m, toolUses: [] })) }) as never)
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
    set.box = e.text
    return { isFilled: true as const }
  })
  on('prompt.submit', ($, e) => {
    seen.passed.push(e.text)
    set.box = ''
    return { text: e.text }
  })
  /** Types a draft into the box and leaves it there long enough to be rated. */
  const type = async (text: string) => {
    set.box = text
    await time.advance(1000)
    await time.advance(2000)
    await time.settle()
  }
  return { seen, set, time, type }
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

test('a weak draft is rated in the band while it sits in the box, and Enter still sends it as typed', async ($, on) => {
  const { seen, type } = world(on)
  await start($)
  await type(WEAK)
  expect(seen.reviews).toBe(1)
  expect(await bandText($)).toBe('Draft 2/5 · which page: home or pricing; what "off" means Improve itengine')

  const r = await submit($, WEAK)
  expect(r.drop).toBeUndefined()
  expect(seen.passed).toEqual([WEAK])
  expect(seen.reviews).toBe(1)
  expect(await bandText($)).toBe('engine')
})

test('a good draft shows nothing', async ($, on) => {
  const { seen, set, type } = world(on)
  set.review = goodReview
  await start($)
  await type(GOOD)
  expect(seen.reviews).toBe(1)
  expect(await bandText($)).toBe('engine')
})

test('a draft is rated once it sits still, not while it is being typed, and an edit clears its rating', async ($, on) => {
  const { seen, set, time, type } = world(on)
  await start($)
  set.box = 'make the landing page'
  await time.advance(1000)
  set.box = 'make the landing page better and fix'
  await time.advance(1000)
  expect(seen.reviews).toBe(0)

  await type(WEAK)
  expect(await bandText($)).toContain('Draft 2/5')
  set.box = `${WEAK} on the home page`
  await time.advance(1000)
  expect(await bandText($)).toBe('engine')
})

test('Improve asks in the band, fills the rewrite into the box, and the rewrite is not rated again', async ($, on) => {
  const { seen, type } = world(on)
  await start($)
  await type(WEAK)
  await press($, 'coach-improve')
  expect(await bandText($)).toBe('Which page? (1/1)Home Pricing Skipengine')
  await press($, 'coach-option-0')
  expect(seen.prompt).toContain('Q: Which page?\nA: Home')
  expect(seen.filled).toEqual([BETTER])
  expect(await bandText($)).toBe('engine')

  await type(BETTER)
  await submit($, BETTER)
  expect(seen.reviews).toBe(1)
  expect(seen.passed).toEqual([BETTER])
})

test('an answer can be typed in the band instead of picked', async ($, on) => {
  const { seen, type } = world(on)
  await start($)
  await type(WEAK)
  await press($, 'coach-improve')
  const band = await $.ui.mount({ ...BAND, surface: 'desktop', props: bandProps } as never)
  await band.input({ key: 'coach-own', text: 'The about page' } as never)
  await band.unmount()
  expect(seen.prompt).toContain('A: The about page')
  expect(seen.filled).toEqual([BETTER])
})

test('a failed rewrite leaves the draft in the box', async ($, on) => {
  const { seen, set, type } = world(on)
  set.rewriteFails = true
  await start($)
  await type(WEAK)
  await press($, 'coach-improve')
  await press($, 'coach-skip')
  expect(seen.toasts.join('|')).toContain('Could not improve it')
  expect(seen.filled).toEqual([])
  expect(set.box).toBe(WEAK)
  expect(await bandText($)).toBe('engine')
})

test('short drafts, slash commands and the app\'s own messages are not rated', async ($, on) => {
  const { seen, type } = world(on)
  await start($)
  await type('yes, do the next one')
  await type('/coach after and then some more words here')
  await type('<system-reminder>The session "Worker" you started finished a turn and wrote a report</system-reminder>')
  expect(seen.reviews).toBe(0)
})

test('the review sees the last reply from the transcript after a restart, and answers to its questions rate well', async ($, on) => {
  const { seen, set, type } = world(on)
  set.transcript = [
    { role: 'user', text: 'fix the band' },
    { role: 'assistant', text: 'Two questions: 1) a or b? 2) keep the button?' },
  ]
  set.review = goodReview
  await start($)
  await type('1 a as you recommend, 2 yes keep the button for now please')
  expect(seen.prompt).toContain('<last_reply>\nTwo questions: 1) a or b? 2) keep the button?\n</last_reply>')
  expect(await bandText($)).toBe('engine')
})

test('a long weak draft is offered a brief', async ($, on) => {
  const { seen, set, type } = world(on)
  set.review = JSON.stringify({ score: 2, issues: ['no goal'], gaps: ['goal'], questions: [] })
  await start($)
  const dump = Array.from({ length: 130 }, (_, i) => `word${i}`).join(' ')
  await type(dump)
  expect(await bandText($)).toBe('Brain dump 2/5 · no goal Shape it into a briefengine')
  // No questions: the brief is written straight away.
  await press($, 'coach-improve')
  expect(seen.filled).toEqual([BETTER])
})

test('a 3/5 shows nothing by default', async ($, on) => {
  const { set, type } = world(on)
  set.review = JSON.stringify({ score: 3, issues: ['which file'], gaps: ['scope'], questions: [] })
  await start($)
  await type(WEAK)
  expect(await bandText($)).toBe('engine')
})

test('a failed review shows nothing', async ($, on) => {
  const { set, type } = world(on)
  set.fails = true
  await start($)
  await type(WEAK)
  expect(await bandText($)).toBe('engine')
})

test('sending while a question shows sends the draft as typed and clears the band', async ($, on) => {
  const { seen, type } = world(on)
  await start($)
  await type(WEAK)
  await press($, 'coach-improve')
  await submit($, WEAK)
  expect(seen.passed).toEqual([WEAK])
  expect(seen.filled).toEqual([])
  expect(await bandText($)).toBe('engine')
})

test('after mode does not rate drafts; it rates on send and shows the rating above the prompt', async ($, on) => {
  const { seen, time, type } = world(on)
  await start($)
  expect((await $.command.run({ command: 'coach', args: 'after' } as never)).text).toContain('Mode: after')
  await type(WEAK)
  expect(seen.reviews).toBe(0)
  await submit($, WEAK)
  expect(seen.passed).toEqual([WEAK])
  await time.settle()
  expect(await bandText($)).toBe('Last prompt 2/5 · which page: home or pricingengine')
})

test('after mode tells the review about an attached image it cannot see', async ($, on) => {
  const { seen, set } = world(on)
  set.review = goodReview
  await start($)
  await $.command.run({ command: 'coach', args: 'after' } as never)
  await $.prompt.submit({ text: 'Think this might be triggering on the wrong thing, is it just on length?', origin: composer, wait: false, attachments: [{ id: 'img1', kind: 'image' }] } as never)
  expect(seen.prompt).toContain('The person attached 1 image or file you cannot see')
})

test('a rated draft that is sent counts toward /coach; off stops rating', async ($, on) => {
  const { seen, type } = world(on)
  await start($)
  await type(WEAK)
  await submit($, WEAK)
  expect((await $.command.run({ command: 'coach', args: '' } as never)).text).toBe('Last 1 prompts: 2.0/5 on average. Most common gaps: vague scope (1), no done criteria (1). Mode: before.')
  await $.command.run({ command: 'coach', args: 'off' } as never)
  await type(GOOD)
  expect(seen.reviews).toBe(1)
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
