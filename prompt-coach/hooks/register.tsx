import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { Gap, Hint, Review } from '../types'

// The draft in the prompt box, when it leaves something to guess: one quiet line.
const hint = atom({ plugin: 'prompt-coach', key: 'hint' } as const, null as Hint | null)

// Shorter prompts are replies ("yes", "do the next one"); the conversation carries them.
const MIN_WORDS = 8
const HISTORY = 100
const REVIEW_MS = 8000
// How often the prompt box is read, and how long it must sit still to be looked at.
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

const REVIEW_SYSTEM = `You look at a draft a person is about to send to an AI coding and work assistant, and decide whether the assistant would have to guess at something that changes the result.

The assistant's last reply is given for context. Most drafts are fine: a draft that follows on from the reply ("now do the same for the footer", "1 a, 2 as you recommend") carries its context and scores 5.

Score 1 to 5:
5 nothing worth adding
4 small gaps the assistant can sensibly fill
3 one guess that would change the result
2 several such guesses, or the goal itself is unclear
1 the assistant cannot tell what is wanted

Return JSON only, no prose, no code fences:
{"score":<1-5>,"issues":["<the question the person should answer, ending in ?>"],"gaps":["goal|context|scope|done|constraints|format|conflict"]}

Rules:
- Only flag what would change the result. Never style, tone, politeness, length or nice-to-haves.
- Each issue is a short, specific question the person can answer in a few words ("Which page, home or pricing?"), not a category ("missing context").
- At most 2 issues, most important first.
- A draft that points at something shown ("this", "the screenshot") has it attached; never flag that.
- The person may still be typing: never mark a draft down for ending mid-sentence.
- Score 4 or 5: empty issues.
- Never use em dashes.`

// Module variables start over on a reload.
let isOn = true
let threshold = 3
let lastReply = ''
// The box as last read, since when, the text being looked at, and the last look.
let seen = ''
let seenAt = 0
let reviewing = ''
let looked: { text: string; review: Review | null } = { text: '', review: null }

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

/** Whether a draft is the person's own words, long enough to look at. */
const isRateable = (text: string) => words(text) >= MIN_WORDS && !text.startsWith('/') && !MACHINE.test(text)

/** Claude's last reply: kept from turn.complete, or read from the transcript after a restart. */
async function reply($: EngineInterface) {
  if (lastReply) return lastReply
  const messages = await $.session.messages().catch(() => [])
  if (!Array.isArray(messages)) return ''
  return [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim())?.text ?? ''
}

function context(text: string, said: string) {
  const r = said ? `<last_reply>\n${said.slice(-1500)}\n</last_reply>\n\n` : ''
  return `${r}<draft>\n${text}\n</draft>`
}

/** The reply as a Review, or null when it does not parse. */
function parseReview(raw: string): Review | null {
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  try {
    const r = JSON.parse(json) as Partial<Record<keyof Review, unknown>>
    const score = Math.round(Number(r.score))
    if (!(score >= 1 && score <= 5)) return null
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim()) : [])
    return {
      score,
      issues: strings(r.issues).slice(0, 2),
      gaps: strings(r.gaps).filter((g): g is Gap => (GAPS as readonly string[]).includes(g)),
    }
  } catch {
    return null
  }
}

/** Haiku's look at a draft, or null when it fails or runs long. */
async function review($: EngineInterface, text: string): Promise<Review | null> {
  const r = await $.model.complete({ model: 'haiku', system: REVIEW_SYSTEM, prompt: context(text, await reply($)), maxTokens: 300, effort: 'low', timeoutMs: REVIEW_MS })
  return r.isAnswered ? parseReview(r.text) : null
}

/** Keeps the last ratings across chats, for /coach to sum up. */
async function remember($: EngineInterface, r: Review) {
  const history = ((await $.store.get('history')) as { score: number; gaps: Gap[] }[] | undefined) ?? []
  await $.store.set('history', [...history, { score: r.score, gaps: r.gaps }].slice(-HISTORY))
}

async function summary($: EngineInterface) {
  const state = isOn ? 'Hints are on.' : 'Hints are off.'
  const history = ((await $.store.get('history')) as { score: number; gaps: Gap[] }[] | undefined) ?? []
  if (!history.length) return `No prompts looked at yet. ${state}`
  const avg = history.reduce((s, h) => s + h.score, 0) / history.length
  const counts = new Map<Gap, number>()
  for (const h of history) for (const g of h.gaps) counts.set(g, (counts.get(g) ?? 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const habits = top.length ? ` Most common gaps: ${top.map(([g, n]) => `${GAP_WORDS[g]} (${n})`).join(', ')}.` : ''
  return `Last ${history.length} prompts: ${avg.toFixed(1)}/5 on average.${habits} ${state}`
}

/**
 * Reads the prompt box each tick. A hint for older text goes as soon as the
 * draft changes; a draft that has sat still is looked at once, and only one
 * that leaves something to guess gets a line. Nothing here holds a prompt back.
 */
async function watch($: EngineInterface) {
  if (!isOn) return
  const box = (await $.prompt.read()).text
  const now = await $.clock.now()
  if (box !== seen) {
    seen = box
    seenAt = now
    const current = await read($, hint)
    if (current && current.text !== box.trim()) await update($, hint, () => null)
    return
  }
  const text = box.trim()
  if (now - seenAt < PAUSE_MS || !isRateable(text) || text === looked.text || text === reviewing) return
  reviewing = text
  try {
    const r = await review($, text).catch(() => null)
    looked = { text, review: r }
    // Typed on while it was looked at: the next pause looks at the new text.
    if (!r || r.score >= threshold || !r.issues[0] || (await $.prompt.read()).text.trim() !== text) return
    await update($, hint, (): Hint => ({ text, issue: r.issues[0]! }))
  } finally {
    reviewing = ''
  }
}

/** Characters that fit across the band; the desktop's proportional font fits about a third more than its column count. */
const width = (e: RenderInput<'AbovePrompt'>) => Math.round((Number(e.props.bodyColumns) || 76) * (e.surface === 'desktop' ? 1.3 : 1))

/** Cuts text to n characters with an ellipsis. */
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1)).trimEnd()}…`)

export const register: Register = (on, options) => {
  isOn = String(options.mode ?? 'on') !== 'off'
  threshold = Math.min(5, Math.max(1, Number(options.threshold ?? 3) || 3))

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const saved = await $.store.get('mode')
    // 0.6 and before saved before / after / off.
    if (typeof saved === 'string') isOn = saved !== 'off'
    await $.command.register({
      name: 'coach',
      description: 'Prompt coach: how your prompts have looked, and your most common gaps. "on" or "off" for the hints',
      argumentHint: 'on | off',
    })
    $.clock.every(TICK_MS, () => void watch($).catch(() => undefined))
    return r
  })

  on('command.run', { command: 'coach' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      isOn = arg === 'on'
      await $.store.set('mode', arg)
      if (!isOn) await update($, hint, () => null)
    }
    return { text: await summary($) }
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (r.text) lastReply = r.text
    return r
  })

  // Every prompt goes through as typed; the coach clears its line and keeps score.
  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    if (await read($, hint)) await update($, hint, () => null)
    if (isOn && TYPED.has(e.origin.kind) && !e.isMeta && !e.command && looked.text === text && looked.review) {
      void remember($, looked.review).catch(() => undefined)
    }
    return next(e)
  })

  // One dim line on top of the band, and whatever the mods beneath draw under it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = e.props.hasSurvey ? null : await read($, hint)
    if (!shown) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">
          {clip(`Worth saying: ${shown.issue}`, width(e))}
        </Text>
        {await next(e)}
      </Box>
    )
  })
}
