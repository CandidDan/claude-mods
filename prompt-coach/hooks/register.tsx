import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { Answer, Draft, Gap, Last, Review } from '../types'

const last = atom({ plugin: 'prompt-coach', key: 'last' } as const, null as Last | null)
// The draft in the prompt box, rated while it is typed: its rating, then its questions.
const draft = atom({ plugin: 'prompt-coach', key: 'draft' } as const, null as Draft | null)

// Shorter prompts are replies ("yes", "do the next one"); the conversation carries them.
const MIN_WORDS = 8
// Longer weak prompts are brain dumps: offered a four-part brief.
const DUMP_WORDS = 120
const MAX_QUESTIONS = 3
const HISTORY = 100
const REVIEW_MS = 8000
// How often the prompt box is read, and how long it must sit still to be rated.
const TICK_MS = 1000
const PAUSE_MS = 2500
const GAPS: readonly Gap[] = ['goal', 'context', 'scope', 'done', 'constraints', 'format', 'conflict']
const GAP_WORDS: Record<Gap, string> = {
  goal: 'unclear goal',
  context: 'missing context',
  scope: 'vague scope',
  done: 'no done criteria',
  constraints: 'no constraints',
  format: 'no output format',
  conflict: 'conflicting asks',
}
// Origins a person typed at: the terminal, the desktop app, a phone.
const TYPED = new Set(['composer', 'bridge', 'sdk'])
// The desktop app also delivers its own messages (another session's report, a
// reminder) as sdk prompts; those open with a tag, which a person never types.
const MACHINE = /^\s*<[a-z][\w-]*[\s>]/i

const REVIEW_SYSTEM = `You review a prompt a person is about to send to an AI coding and work assistant, and say how well it sets the assistant up to do the job without guessing.

The assistant's last reply is given for context: a prompt that leans on it ("now do the same for the footer") is fine when the reply makes it clear.

Score 1 to 5:
5 nothing worth adding
4 small gaps the assistant can sensibly fill
3 the assistant would have to guess at something that changes the result
2 several such guesses, or the goal itself is unclear
1 the assistant cannot tell what is wanted

Return JSON only, no prose, no code fences:
{"score":<1-5>,"issues":["<what is missing, at most 8 words>"],"gaps":["goal|context|scope|done|constraints|format|conflict"],"questions":[{"q":"<question ending in ?>","options":["<likely answer>","<likely answer>"]}]}

Rules:
- A prompt that answers the last reply's questions or picks from its options ("1 a, 2 as you recommend", "go with option b") scores 5: the reply carries the context.
- A prompt that points at something shown ("this", "the screenshot") has it attached; do not mark it down for that.
- The person may still be typing: never mark a prompt down for ending mid-sentence.
- At most 3 issues, most important first, each naming the specific thing missing ("which page: home or pricing"), not a category.
- At most 3 questions, only for things the person must decide; never about style or nice-to-haves. Give 2 or 3 short likely answers each.
- Score 4 or 5: empty issues and questions.
- Never use em dashes.`

const REWRITE_SYSTEM = `You rewrite a person's prompt for an AI coding and work assistant so it can do the job without guessing.

Rules:
- Keep every fact, name, number, file, link and tool from the prompt. Add nothing that is not in the prompt or the answers.
- Use the person's answers to the follow-up questions where they belong. A skipped question becomes a line asking the assistant to check with them first.
- Write in the person's voice (I, we, my), plain and short. No preamble, no code fences, no em dashes.
- A short prompt stays short: a few sentences that say what to do, the context it needs, and how we know it is done.
- A long brain dump becomes four parts, each heading on its own line: THE JOB, THE WHY, THE GUARDRAILS (bullets), DONE MEANS (bullets).`

// Module variables start over on a reload.
let mode = 'before'
let threshold = 3
let lastReply = ''
// The coach's own rewrite, filled into the box: not rated again.
let improved = ''
// The box as last read, since when, the text being rated, and the last rating.
let seen = ''
let seenAt = 0
let reviewing = ''
let rated: { text: string; review: Review | null } = { text: '', review: null }

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

/** Whether a prompt is the person's own words, long enough to rate. */
const isRateable = (text: string) => words(text) >= MIN_WORDS && !text.startsWith('/') && !MACHINE.test(text) && text !== improved.trim()

/** Claude's last reply: kept from turn.complete, or read from the transcript after a restart. */
async function reply($: EngineInterface) {
  if (lastReply) return lastReply
  const messages = await $.session.messages().catch(() => [])
  if (!Array.isArray(messages)) return ''
  return [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim())?.text ?? ''
}

function context(text: string, said: string, attached = 0) {
  const r = said ? `<last_reply>\n${said.slice(-1500)}\n</last_reply>\n\n` : ''
  const note = attached
    ? `\n\nThe person attached ${attached} image${attached > 1 ? 's' : ''} or file${attached > 1 ? 's' : ''} you cannot see. Assume ${attached > 1 ? 'they show' : 'it shows'} what the prompt refers to; do not mark the prompt down for leaning on ${attached > 1 ? 'them' : 'it'}.`
    : ''
  return `${r}<prompt>\n${text}\n</prompt>${note}`
}

/** The reply as a Review, or null when it does not parse. */
function parseReview(raw: string): Review | null {
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  try {
    const r = JSON.parse(json) as Partial<Record<keyof Review, unknown>>
    const score = Math.round(Number(r.score))
    if (!(score >= 1 && score <= 5)) return null
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [])
    const questions = (Array.isArray(r.questions) ? r.questions : [])
      .map(x => x as { q?: unknown; options?: unknown })
      .filter(x => typeof x.q === 'string' && x.q.trim())
      .map(x => ({ q: String(x.q).trim(), options: strings(x.options).slice(0, 3) }))
      .filter(x => x.options.length >= 2)
      .slice(0, MAX_QUESTIONS)
    return {
      score,
      issues: strings(r.issues).slice(0, 3),
      gaps: strings(r.gaps).filter((g): g is Gap => (GAPS as readonly string[]).includes(g)),
      questions,
    }
  } catch {
    return null
  }
}

/** Haiku's rating, or null when it fails or runs long. */
async function review($: EngineInterface, text: string, attached = 0): Promise<Review | null> {
  const r = await $.model.complete({ model: 'haiku', system: REVIEW_SYSTEM, prompt: context(text, await reply($), attached), maxTokens: 500, effort: 'low', timeoutMs: REVIEW_MS })
  return r.isAnswered ? parseReview(r.text) : null
}

/** Keeps the last ratings across chats, for /coach to sum up. */
async function remember($: EngineInterface, r: Review) {
  const history = ((await $.store.get('history')) as { score: number; gaps: Gap[] }[] | undefined) ?? []
  await $.store.set('history', [...history, { score: r.score, gaps: r.gaps }].slice(-HISTORY))
}

async function summary($: EngineInterface) {
  const history = ((await $.store.get('history')) as { score: number; gaps: Gap[] }[] | undefined) ?? []
  if (!history.length) return `No prompts rated yet. Mode: ${mode}.`
  const avg = history.reduce((s, h) => s + h.score, 0) / history.length
  const counts = new Map<Gap, number>()
  for (const h of history) for (const g of h.gaps) counts.set(g, (counts.get(g) ?? 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const habits = top.length ? ` Most common gaps: ${top.map(([g, n]) => `${GAP_WORDS[g]} (${n})`).join(', ')}.` : ''
  return `Last ${history.length} prompts: ${avg.toFixed(1)}/5 on average.${habits} Mode: ${mode}.`
}

async function rewrite($: EngineInterface, text: string, answers: Answer[]) {
  const qa = answers.length ? `\n\n<answers>\n${answers.map(x => `Q: ${x.q}\nA: ${x.a ?? 'skipped'}`).join('\n\n')}\n</answers>` : ''
  const r = await $.model.complete({ model: 'sonnet', system: REWRITE_SYSTEM, prompt: `${context(text, await reply($))}${qa}`, maxTokens: 2000, effort: 'low', timeoutMs: 60_000 })
  if (!r.isAnswered) throw new Error(r.reason)
  return r.text.trim().replace(/^```\w*\s*/, '').replace(/```\s*$/, '')
}

/**
 * Reads the prompt box each tick. A rating shown for older text goes as soon as
 * the draft changes; a draft that has sat still is rated once, and a weak one
 * shows its rating above the box. Nothing here ever holds a prompt back.
 */
async function watch($: EngineInterface) {
  if (mode !== 'before') return
  const box = (await $.prompt.read()).text
  const now = await $.clock.now()
  if (box !== seen) {
    seen = box
    seenAt = now
    const d = await read($, draft)
    if (d?.phase === 'offer' && d.text !== box.trim()) await update($, draft, () => null)
    return
  }
  const text = box.trim()
  if (now - seenAt < PAUSE_MS || !isRateable(text) || text === rated.text || text === reviewing) return
  if ((await read($, draft))?.phase) return
  reviewing = text
  try {
    const r = await review($, text).catch(() => null)
    rated = { text, review: r }
    // Typed on while it was rated: the next pause rates the new text.
    if (!r || (await $.prompt.read()).text.trim() !== text || (await read($, draft))) return
    // A good draft is offered too, quietly, so Improve is there when wanted.
    await update($, draft, (): Draft => ({ text, score: r.score, issues: r.issues, isDump: words(text) >= DUMP_WORDS, questions: r.questions, phase: 'offer', step: 0, answers: [] }))
  } finally {
    reviewing = ''
  }
}

async function startImprove($: EngineInterface) {
  const d = await read($, draft)
  if (d?.phase !== 'offer') return
  if (!d.questions.length) return finish($, d, [])
  await update($, draft, (): Draft => ({ ...d, phase: 'asking', step: 0, answers: [] }))
}

/** Records the answer to the question showing (null: skipped) and moves on, or rewrites after the last. */
async function answer($: EngineInterface, a: string | null) {
  const d = await read($, draft)
  if (d?.phase !== 'asking') return
  const q = d.questions[d.step]
  if (!q) return
  const answers = [...d.answers, { q: q.q, a }]
  if (d.step + 1 < d.questions.length) {
    await update($, draft, (): Draft => ({ ...d, step: d.step + 1, answers }))
    return
  }
  await finish($, d, answers)
}

/** Rewrites into the prompt box; on failure, or once the prompt was sent, the box is left alone. */
async function finish($: EngineInterface, d: Draft, answers: Answer[]) {
  await update($, draft, (): Draft => ({ ...d, phase: 'improving', answers }))
  try {
    const better = await rewrite($, d.text, answers)
    if (!(await read($, draft))) return
    improved = better
    const filled = await $.prompt.fill({ text: better, mode: 'replace' })
    if (!filled.isFilled) throw new Error('the prompt box did not take it')
    $.ui.toast('Improved. Check it in the prompt box, then press Enter.')
  } catch (err) {
    improved = ''
    $.ui.toast(`Could not improve it (${err instanceof Error ? err.message : String(err)}). Your prompt is still in the box.`)
  }
  await update($, draft, () => null)
}

/** The coach's part of the band, or null when it has nothing to show. */
/** Characters that fit across the band; the desktop's proportional font fits about a third more than its column count. */
const width = (e: RenderInput<'AbovePrompt'>) => Math.round((Number(e.props.bodyColumns) || 76) * (e.surface === 'desktop' ? 1.3 : 1))

/** Cuts text to n characters with an ellipsis. */
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1)).trimEnd()}…`)

async function coachLine($: EngineInterface, e: RenderInput<'AbovePrompt'>) {
  const els = $.ui.resolve(e)
  const { Box, Button, Text } = els
  // The band draws on the terminal and desktop, which both have a text field.
  const Input = 'Input' in els ? els.Input : null
  const d = await read($, draft)
  if (d?.phase === 'improving') return <Text dimColor>Improving your prompt…</Text>
  if (d?.phase === 'asking') {
    const q = d.questions[d.step]
    if (!q) return null
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          {clip(q.q.endsWith('?') ? q.q : `${q.q}?`, width(e) - 8)}
          <Text dimColor> ({d.step + 1}/{d.questions.length})</Text>
        </Text>
        <Box flexWrap="wrap">
          {q.options.flatMap((label, i) => [
            <Button key={`coach-option-${i}`} label={label} hotkey={String(i + 1)} onPress={() => void answer($, label)} />,
            <Text key={`coach-gap-${i}`}> </Text>,
          ])}
          <Button key="coach-skip" label="Skip" onPress={() => void answer($, null)} />
        </Box>
        {Input && <Input key="coach-own" placeholder="Or type your own answer" onSubmit={(v: string) => void answer($, v.trim() || null)} />}
      </Box>
    )
  }
  if (d?.phase === 'offer') {
    // A good draft is shown quietly, with Improve there if wanted.
    const isGood = d.score >= threshold
    const tag = `${d.isDump ? 'Brain dump' : 'Draft'} ${d.score}/5`
    const label = isGood ? 'Improve anyway' : d.isDump ? 'Shape it into a brief' : 'Improve it'
    // One row: the reason is clipped here, since the desktop wraps rather than truncates.
    const why = clip(d.issues[0] ?? (isGood ? '' : 'it leaves things to guess'), width(e) - tag.length - 3 - (label.length + 8))
    return (
      <Box>
        <Box flexShrink={1}>
          <Text wrap="truncate-end">
            {isGood ? <Text dimColor>{tag}</Text> : <Text color="yellow">{tag}</Text>}
            <Text dimColor>{why ? ` · ${why}` : ''}</Text>
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text> </Text>
          <Button key="coach-improve" label={label} hotkey="i" onPress={() => void startImprove($)} />
        </Box>
      </Box>
    )
  }
  // In `after` mode: the last prompt's rating, until the next prompt.
  const l = await read($, last)
  if (mode !== 'after' || !l || l.score >= threshold) return null
  return (
    <Text wrap="truncate-end">
      <Text dimColor>Last prompt </Text>
      <Text color="yellow">{l.score}/5</Text>
      <Text dimColor>{l.issue ? ` · ${clip(l.issue, width(e) - 20)}` : ''}</Text>
    </Text>
  )
}

export const register: Register = (on, options) => {
  mode = ['before', 'after', 'off'].includes(String(options.mode)) ? String(options.mode) : 'before'
  threshold = Math.min(5, Math.max(1, Number(options.threshold ?? 3) || 3))

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const saved = await $.store.get('mode')
    if (saved === 'before' || saved === 'after' || saved === 'off') mode = saved
    await $.command.register({
      name: 'coach',
      description: 'Prompt coach: how your prompts have rated, and your most common gaps. "before", "after" or "off" sets when it rates',
      argumentHint: 'before | after | off',
    })
    $.clock.every(TICK_MS, () => void watch($).catch(() => undefined))
    return r
  })

  on('command.run', { command: 'coach' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'before' || arg === 'after' || arg === 'off') {
      mode = arg
      await $.store.set('mode', mode)
      if (mode !== 'after') await update($, last, () => null)
      if (mode !== 'before') await update($, draft, () => null)
    }
    return { text: await summary($) }
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (r.text) lastReply = r.text
    return r
  })

  // Every prompt goes through as typed; the coach only clears its line and keeps score.
  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    const isOurs = !!improved && text === improved.trim()
    if (isOurs) improved = ''
    if (await read($, draft)) await update($, draft, () => null)
    if (mode === 'off' || isOurs || e.isMeta || e.command || !TYPED.has(e.origin.kind) || !isRateable(text)) return next(e)

    if (mode === 'before') {
      if (rated.text === text && rated.review) void remember($, rated.review).catch(() => undefined)
      return next(e)
    }

    void review($, text, e.attachments?.length ?? 0)
      .then(async r => {
        if (!r) return
        await remember($, r)
        await update($, last, (): Last => ({ score: r.score, issue: r.issues[0] ?? '' }))
      })
      .catch(() => undefined)
    return next(e)
  })

  // The coach's line on top, and whatever the mods beneath draw under it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const mine = e.props.hasSurvey ? null : await coachLine($, e)
    if (!mine) return next(e)
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {mine}
        {await next(e)}
      </Box>
    )
  })
}
