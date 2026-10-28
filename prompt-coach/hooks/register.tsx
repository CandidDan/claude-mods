import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Gap, Last, Review } from '../types'

const last = atom({ plugin: 'prompt-coach', key: 'last' } as const, null as Last | null)

// Shorter prompts are replies ("yes", "do the next one"); the conversation carries them.
const MIN_WORDS = 8
// Longer weak prompts are brain dumps: offered a four-part brief.
const DUMP_WORDS = 120
const MAX_QUESTIONS = 3
const HISTORY = 100
const REVIEW_MS = 8000
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
const IMPROVE = 'Improve it'
const SEND = 'Send as is'
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
let improved = ''

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

function context(text: string, attached = 0) {
  const reply = lastReply ? `<last_reply>\n${lastReply.slice(-1500)}\n</last_reply>\n\n` : ''
  const note = attached
    ? `\n\nThe person attached ${attached} image${attached > 1 ? 's' : ''} or file${attached > 1 ? 's' : ''} you cannot see. Assume ${attached > 1 ? 'they show' : 'it shows'} what the prompt refers to; do not mark the prompt down for leaning on ${attached > 1 ? 'them' : 'it'}.`
    : ''
  return `${reply}<prompt>\n${text}\n</prompt>${note}`
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

/** Haiku's rating, or null when it fails or runs long: the prompt then goes as typed. */
async function review($: EngineInterface, text: string, attached = 0): Promise<Review | null> {
  const r = await $.model.complete({ model: 'haiku', system: REVIEW_SYSTEM, prompt: context(text, attached), maxTokens: 500, effort: 'low', timeoutMs: REVIEW_MS })
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

/** Asks each question; a dismissed one counts as skipped. */
async function ask($: EngineInterface, questions: Review['questions']) {
  const answers: { q: string; a: string | null }[] = []
  for (const [i, x] of questions.entries()) {
    let a: string | null = null
    try {
      a = (await $.ui.ask(x.q.endsWith('?') ? x.q : `${x.q}?`, { options: x.options, header: `Prompt ${i + 1}/${questions.length}` })).trim() || null
    } catch {
      a = null
    }
    answers.push({ q: x.q, a })
  }
  return answers
}

async function rewrite($: EngineInterface, text: string, answers: { q: string; a: string | null }[]) {
  const qa = answers.length ? `\n\n<answers>\n${answers.map(x => `Q: ${x.q}\nA: ${x.a ?? 'skipped'}`).join('\n\n')}\n</answers>` : ''
  const r = await $.model.complete({ model: 'sonnet', system: REWRITE_SYSTEM, prompt: `${context(text)}${qa}`, maxTokens: 2000, effort: 'low', timeoutMs: 60_000 })
  if (!r.isAnswered) throw new Error(r.reason)
  return r.text.trim().replace(/^```\w*\s*/, '').replace(/```\s*$/, '')
}

/** Asks, rewrites into the prompt box, and says whether the box took it. */
async function improve($: EngineInterface, text: string, r: Review | null) {
  const answers = await ask($, r?.questions ?? [])
  $.ui.status('Improving your prompt…')
  try {
    const better = await rewrite($, text, answers)
    const filled = await $.prompt.fill({ text: better, mode: 'replace' })
    if (!filled.isFilled) return false
    improved = better
    $.ui.toast('Improved. Check it in the prompt box, then press Enter.')
    return true
  } finally {
    $.ui.status(undefined)
  }
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
      description: 'Prompt coach: how your prompts have rated, and your most common gaps. "before", "after" or "off" sets when it checks',
      argumentHint: 'before | after | off',
    })
    return r
  })

  on('command.run', { command: 'coach' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'before' || arg === 'after' || arg === 'off') {
      mode = arg
      await $.store.set('mode', mode)
      if (mode !== 'after') await update($, last, () => null)
    }
    return { text: await summary($) }
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (r.text) lastReply = r.text
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    const isOurs = text === improved.trim()
    if (isOurs) improved = ''
    if (mode === 'off' || isOurs || e.isMeta || e.command || !TYPED.has(e.origin.kind) || MACHINE.test(text) || words(text) < MIN_WORDS) return next(e)
    const attached = e.attachments?.length ?? 0

    if (mode === 'after') {
      void review($, text, attached)
        .then(async r => {
          if (!r) return
          await remember($, r)
          await update($, last, (): Last => ({ score: r.score, issue: r.issues[0] ?? '' }))
        })
        .catch(() => undefined)
      return next(e)
    }

    const r = await review($, text, attached).catch(() => null)
    if (!r) return next(e)
    await remember($, r)
    if (r.score >= threshold) return next(e)

    const why = r.issues.join('; ') || 'it leaves things to guess'
    const question =
      words(text) >= DUMP_WORDS
        ? `This reads like a brain dump (${r.score}/5): ${why}. Shape it into a brief first?`
        : `Claude rates this prompt ${r.score}/5: ${why}. Improve it first?`
    let choice = SEND
    try {
      choice = await $.ui.ask(question, { options: [IMPROVE, SEND], header: `Prompt ${r.score}/5` })
    } catch {
      return next(e)
    }
    if (choice !== IMPROVE) return next(e)

    try {
      if (await improve($, text, r)) return { drop: 'improved in the prompt box' }
      $.ui.toast('The prompt box did not take the rewrite. Sent as is.')
    } catch (err) {
      $.ui.toast(`Could not improve it (${err instanceof Error ? err.message : String(err)}). Sent as is.`)
    }
    return next(e)
  })

  // In `after` mode: the last prompt's rating, until the next prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const l = await read($, last)
    if (mode !== 'after' || e.props.hasSurvey || !l || l.score >= threshold) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>Last prompt </Text>
        <Text color="yellow">{l.score}/5</Text>
        <Text dimColor>{l.issue ? ` · ${l.issue}` : ''}</Text>
      </Box>
    )
  })
}
