import type { EngineInterface, Register } from 'claude-code'

// Origins a person typed at: the terminal, the desktop app, a phone.
const TYPED = new Set(['composer', 'bridge', 'sdk'])
// The desktop app also delivers its own messages (another session's report, a
// reminder) as sdk prompts; those open with a tag, which a person never types.
const MACHINE = /^\s*<[a-z][\w-]*[\s>]/i
// Characters to a row, for a reply the surface has not yet measured.
const ROW_CHARS = 100

// Module variables start over on a reload; the transcript draws its rows again.
let minRows = 30
// Your messages in the order they were first drawn, by render id.
let mine: string[] = []
// Each reply block's message: the one of yours it answers.
const owner = new Map<string, string>()

/** Rows a block takes: as the surface measured it, else estimated from its text. */
function rows(text: string, measured?: number) {
  if (measured) return measured
  return text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / ROW_CHARS)), 0)
}

/** Scrolls your message to the top of the window; says why when it cannot. */
async function jump($: EngineInterface, id: string | undefined) {
  if (!id) return 'No message of yours to go back to yet.'
  $.ui.log(`back: scrolling to ${id}`, { to: 'debug' })
  try {
    const r = await $.ui.scroll({ to: { requestId: id }, block: 'start' })
    return r.deny ? `Could not scroll back: ${r.deny}` : ''
  } catch (err) {
    return `Could not scroll back: ${err instanceof Error ? err.message : String(err)}`
  }
}

export const register: Register = (on, options) => {
  minRows = Math.max(1, Number(options.minRows ?? 30) || 30)

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'back',
      description: 'Back: scroll to the message you last sent. /back 2 for the one before',
      argumentHint: '[n]',
    })
    return r
  })

  on('command.run', { command: 'back' }, async ($, e) => {
    const n = Math.max(1, Math.floor(Number(e.args.trim() || 1)) || 1)
    const said = await jump($, mine[mine.length - n])
    return { text: said || (n === 1 ? 'Back at your last message.' : `Back ${n} messages.`) }
  })

  // Notes each message of yours as it is first drawn; the row itself is the engine's.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const text = e.props.text.trim()
    const isYours = TYPED.has(e.props.origin.kind) && !e.props.from && !text.startsWith('/') && !MACHINE.test(text)
    if (isYours && !mine.includes(e.requestId)) mine.push(e.requestId)
    return next(e)
  })

  // A long reply block gets a button under it, back to the message it answers.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!owner.has(e.requestId) && mine.length) owner.set(e.requestId, mine[mine.length - 1]!)
    const target = owner.get(e.requestId)
    if (!target || rows(e.props.text, e.props.onScreen?.of) < minRows) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box>
          <Button
            key={`back-${e.requestId}`}
            label="↑ Back to your message"
            onPress={async () => {
              const said = await jump($, target)
              if (said) $.ui.toast(said)
            }}
          />
        </Box>
      </Box>
    )
  })
}
