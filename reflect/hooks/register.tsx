import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Band } from '../types'

const band = atom({ plugin: 'reflect', key: 'band' } as const, null as Band | null)

const HEADING = '## Rules from corrections'
const SAVED_MS = 8000
// Long prompts are briefs, not corrections.
const MAX_CHARS = 1500
// Only prompts that read like a correction reach the model at all.
const LOOKS_LIKE_CORRECTION =
  /\b(no|nope|don'?t|do not|never|stop|wrong|instead|actually|always|rather than|i said|i asked|i meant|not what|that'?s not|why did you|you should(?:n'?t)?|please don'?t)\b/i
const LABELS = ['lasting rule', 'one-off fix', 'not a correction'] as const

const DRAFT_SYSTEM = `You turn a person's correction of an AI assistant into one rule the assistant should follow from now on.

Write the rule as one imperative line of at most 20 words, in plain English, general enough to apply next time and specific enough to act on. No quotes, no preamble, no em dashes.
If the correction only fixes this one answer and says nothing about future work, reply with the single word NONE.`

// Module variables start over on a reload.
let lastReply = ''
let isOff = false

function draftPrompt(reply: string, correction: string) {
  return `The assistant said:\n${reply.slice(-1500)}\n\nThe person replied:\n${correction}`
}

/** Classifies, then drafts: the band shows a rule only for a correction meant to last. */
async function check($: EngineInterface, text: string, reply: string) {
  const kind = await $.model.classify(draftPrompt(reply, text), LABELS, { model: 'haiku' })
  if (kind !== 'lasting rule') return
  const r = await $.model.complete({ model: 'haiku', system: DRAFT_SYSTEM, prompt: draftPrompt(reply, text), maxTokens: 120 })
  if (!r.isAnswered) return
  const rule = r.text.trim().replace(/^[-*]\s*/, '').replace(/^["']|["']$/g, '')
  if (!rule || /^none\b/i.test(rule) || rule.length > 200) return
  await update($, band, (): Band => ({ kind: 'draft', rule }))
}

/** The file with the rule added under its heading, or null when the rule is there already. */
function withRule(old: string, rule: string): string | null {
  const bullet = `- ${rule}`
  if (old.split('\n').some(l => l.trim().toLowerCase() === bullet.toLowerCase())) return null
  const lines = old.split('\n')
  const at = lines.findIndex(l => l.trim() === HEADING)
  if (at === -1) return `${old.trimEnd()}${old.trim() ? '\n\n' : ''}${HEADING}\n\n${bullet}\n`
  // The section runs to the next heading of the same or higher level.
  let end = lines.findIndex((l, i) => i > at && /^#{1,2} /.test(l))
  if (end === -1) end = lines.length
  while (end > at + 1 && lines[end - 1]?.trim() === '') end -= 1
  return [...lines.slice(0, end), bullet, ...lines.slice(end)].join('\n').replace(/\n*$/, '\n')
}

async function pathFor($: EngineInterface, where: 'project' | 'everywhere') {
  if (where === 'project') return `${await $.session.cwd()}/CLAUDE.md`
  const home = await $.env.get('HOME')
  if (!home) throw new Error('HOME is not set')
  return `${home}/.claude/CLAUDE.md`
}

async function show($: EngineInterface, text: string) {
  await update($, band, (): Band => ({ kind: 'saved', text }))
  // Cleared a few seconds later, unless the session has ended by then.
  void $.clock
    .sleep(SAVED_MS)
    .then(() => update($, band, b => (b?.kind === 'saved' && b.text === text ? null : b)))
    .catch(() => undefined)
}

async function save($: EngineInterface, where: 'project' | 'everywhere') {
  const b = await read($, band)
  if (b?.kind !== 'draft') return
  const label = where === 'project' ? "this project's CLAUDE.md" : 'your CLAUDE.md'
  try {
    const path = await pathFor($, where)
    const old = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
    const next = withRule(old, b.rule)
    if (next === null) return show($, `Already in ${label}.`)
    await $.fs.write(path, next)
    // Never leave a half-written CLAUDE.md unnoticed.
    if (String(await $.fs.read(path)) !== next) throw new Error(`${path} did not read back as written`)
    await show($, `Saved to ${label}.`)
  } catch (err) {
    await show($, `Not saved: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    isOff = (await $.store.get('isOff')) === true
    await $.command.register({
      name: 'reflect',
      description: 'Reflect: offers to save your corrections as lasting rules. "off" and "on" switch it in every chat',
      argumentHint: 'off | on',
    })
    return r
  })

  on('command.run', { command: 'reflect' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      isOff = arg === 'off'
      await $.store.set('isOff', isOff)
      if (isOff) await update($, band, () => null)
    }
    return {
      text: isOff
        ? 'Reflect is off in every chat. /reflect on turns it back on.'
        : 'Reflect is on: when a correction reads like a lasting rule, a line above the prompt offers to save it. /reflect off turns it off.',
    }
  })

  // Runs beside the turn, never in its way: the prompt goes on at once.
  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    if (!isOff && !e.isMeta && !e.command && lastReply && text.length <= MAX_CHARS && LOOKS_LIKE_CORRECTION.test(text)) {
      void check($, text, lastReply).catch(() => undefined)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (r.text) lastReply = r.text
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const b = await read($, band)
    if (e.props.hasSurvey || !b || isOff) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    if (b.kind === 'saved') return <Text dimColor>Reflect · {b.text}</Text>
    return (
      <Box>
        <Text dimColor>Save as a rule? </Text>
        <Text bold>{b.rule} </Text>
        <Button key="project" label="This project" onPress={() => void save($, 'project')} />
        <Text> </Text>
        <Button key="everywhere" label="Everywhere" onPress={() => void save($, 'everywhere')} />
        <Text> </Text>
        <Button key="skip" label="Skip" onPress={() => void update($, band, () => null)} />
      </Box>
    )
  })
}
