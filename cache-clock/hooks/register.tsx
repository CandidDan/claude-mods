import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput, TurnUsage } from 'claude-code'

import type { CacheClock, KeepWarm, Ttl } from '../types'

const clock = atom({ plugin: 'cache-clock', key: 'clock' } as const, null as CacheClock | null)
const warm = atom({ plugin: 'cache-clock', key: 'warm' } as const, null as KeepWarm | null)
const isHidden = atom({ plugin: 'cache-clock', key: 'isHidden' } as const, false)

const TTL_MS: Record<Ttl, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 }
// A gap this far past a TTL counts as having crossed it.
const SLACK_MS = 60_000
// Prompts smaller than this tell nothing about the cache, and going cold costs little.
const MIN_TOKENS = 20_000
// Keep warm pings this long before the cache would go cold.
const LEAD_MS = 45_000
const PING = 'Reply with the single word: ok'

const tokens = (n: number) => `${Math.round(n / 1000)}k`
const left = (ms: number) => (ms >= 60_000 ? `${Math.ceil(ms / 60_000)}m` : `${Math.max(1, Math.ceil(ms / 1000))}s`)
const promptTokens = (u: TurnUsage) => u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

// Module variables start over on a reload; register sets the options again.
let fixed: Ttl | null = null
let maxPings = 6
let isTurnRunning = false
let isPinging = false
let drawn = ''
let lastMessageCount = 0

/** The TTL in force, and whether it is known (set, or learned) or only assumed. */
async function ttlOf($: EngineInterface): Promise<{ ttl: Ttl; isKnown: boolean }> {
  if (fixed) return { ttl: fixed, isKnown: true }
  const learned = await $.store.get('ttl')
  return learned === '5m' || learned === '1h' ? { ttl: learned, isKnown: true } : { ttl: '5m', isKnown: false }
}

/** Milliseconds until cold (0 or less once cold), or null before the first reply. */
async function remaining($: EngineInterface) {
  const c = await read($, clock)
  if (!c) return null
  const { ttl } = await ttlOf($)
  return c.lastAt + TTL_MS[ttl] - (await $.clock.now())
}

// A request sent more than 5 minutes after the last one says which TTL is in force:
// it read the cache (1h) or wrote it afresh (5m). A new model or a shorter
// conversation (compaction, /clear) starts a new cache, so those say nothing.
async function learn($: EngineInterface, prev: CacheClock, startedAt: number, u: TurnUsage, isShorter: boolean) {
  if (fixed || isShorter || prev.model !== u.model || prev.promptTokens < MIN_TOKENS) return
  const gap = startedAt - prev.lastAt
  if (gap < TTL_MS['5m'] + SLACK_MS) return
  if (u.cache_read_input_tokens >= prev.promptTokens / 2) await $.store.set('ttl', '1h')
  else if (gap < TTL_MS['1h'] - SLACK_MS) await $.store.set('ttl', '5m')
}

async function stopWarm($: EngineInterface, why?: string) {
  await update($, warm, () => null)
  if (why) $.ui.toast(why)
}

async function ping($: EngineInterface) {
  isPinging = true
  const startedAt = await $.clock.now()
  const r = await $.model.fork({ prompt: PING }).finally(() => {
    isPinging = false
  })
  const w = await read($, warm)
  if (!w) return
  if (!r.isAnswered) return stopWarm($, `Keep warm stopped: ${r.reason}.`)
  if (r.usage.cache_read_input_tokens === 0) return stopWarm($, 'Keep warm stopped: the cache had already gone cold.')
  await update($, clock, c => (c ? { ...c, lastAt: startedAt } : c))
  const pings = w.pings + 1
  if (pings >= w.max) return stopWarm($, `Keep warm stopped after ${pings} pings.`)
  await update($, warm, () => ({ ...w, pings }))
}

async function startWarm($: EngineInterface): Promise<string> {
  const ms = await remaining($)
  if (ms === null) return 'Nothing to keep warm yet: no reply in this chat.'
  if (ms <= 0) return 'The cache is already cold. Your next message warms it again.'
  await update($, warm, () => ({ pings: 0, max: maxPings }))
  const c = await read($, clock)
  return `Keep warm is on: up to ${maxPings} pings, each about ${LEAD_MS / 1000}s before the cache would go cold. Each re-reads ${tokens(c?.promptTokens ?? 0)} tokens from the cache, at about a tenth of the full price. Sending a message stops it.`
}

async function toggleWarm($: EngineInterface) {
  if (await read($, warm)) {
    await stopWarm($)
    return 'Keep warm is off.'
  }
  return startWarm($)
}

async function tick($: EngineInterface) {
  const ms = await remaining($)
  if (ms === null) return
  const w = await read($, warm)
  if (w && !isPinging && !isTurnRunning) {
    if (ms <= 0) await stopWarm($, 'Keep warm stopped: the cache went cold.')
    else if (ms <= LEAD_MS) void ping($).catch(err => stopWarm($, `Keep warm stopped: ${String(err)}`))
  }
  // Redraw only when the words would change: seconds under a minute, minutes above.
  const label = ms > 0 ? left(ms) : 'cold'
  if (label !== drawn) {
    drawn = label
    $.ui.invalidate('ui.render')
  }
}

async function status($: EngineInterface) {
  const c = await read($, clock)
  const ms = await remaining($)
  if (!c || ms === null) return 'No reply in this chat yet, so there is no cache to time.'
  if (ms <= 0) return `Cache cold: the next message re-sends ${tokens(c.promptTokens)} tokens at full price.`
  const { ttl, isKnown } = await ttlOf($)
  const assumed = isKnown ? '' : ' (assumed until a reply more than 5 minutes after the last shows which)'
  return `Cache warm: ${left(ms)} left of ${ttl}${assumed}, ${tokens(c.promptTokens)} tokens cached.`
}

/** The cache's warm or cold line, or null when there is nothing worth showing. */
async function cacheLine($: EngineInterface, e: RenderInput<'AbovePrompt'>) {
  const c = await read($, clock)
  if (e.props.hasSurvey || e.props.isWorking || !c || (await read($, isHidden))) return null
  const ms = (await remaining($)) ?? 0
  const { Box, Button, Text } = $.ui.resolve(e)

  if (ms <= 0) {
    if (c.promptTokens < MIN_TOKENS) return null
    return (
      <Text wrap="truncate-end">
        <Text dimColor>Cache </Text>
        <Text color="yellow">cold</Text>
        <Text dimColor> · next message re-sends {tokens(c.promptTokens)} tokens at full price</Text>
      </Text>
    )
  }

  const { ttl, isKnown } = await ttlOf($)
  const w = await read($, warm)
  return (
    // One row: the text cuts off with an ellipsis before the button gives way.
    <Box>
      <Box flexShrink={1}>
        <Text wrap="truncate-end">
          <Text dimColor>Cache </Text>
          <Text color="green">warm</Text>
          <Text dimColor>
            {' '}
            · {left(ms)} left of {ttl}
            {isKnown ? '' : '?'}
            {w ? ` · kept warm ${w.pings}/${w.max}` : ''}
          </Text>
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text> </Text>
        <Button key="warm" label={w ? 'Stop' : 'Keep warm'} onPress={() => void toggleWarm($)} />
      </Box>
    </Box>
  )
}

export const register: Register = (on, options) => {
  fixed = options.ttl === '5m' || options.ttl === '1h' ? (options.ttl as Ttl) : null
  maxPings = Math.max(1, Number(options.keepWarmPings ?? 6) || 6)

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'cache',
      description: 'Cache Clock: how long until the prompt cache goes cold. "warm" keeps it warm, "off" and "on" hide and show the line',
      argumentHint: 'warm | off | on',
    })
    $.clock.every(1000, () => void tick($).catch(() => undefined))
    return r
  })

  on('command.run', { command: 'cache' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'warm') return { text: await toggleWarm($) }
    if (arg === 'off') {
      await update($, isHidden, () => true)
      return { text: 'Cache Clock hidden. /cache on brings it back.' }
    }
    if (arg === 'on') await update($, isHidden, () => false)
    return { text: await status($) }
  })

  on('turn.start', async ($, e, next) => {
    isTurnRunning = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    isTurnRunning = false
    return next(e)
  })

  // Sending a message refreshes the cache itself, so Keep warm has done its job.
  on('prompt.submit', async ($, e, next) => {
    if (!e.isMeta && !e.command && (await read($, warm))) await stopWarm($)
    return next(e)
  })

  // Every main-thread request restarts the cache's timer; a subagent's has a cache of its own.
  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    const r = yield* next(e)
    if (e.agentId || !r.usage) return r
    const u = r.usage
    const prev = await read($, clock)
    const isShorter = e.messageCount < lastMessageCount
    lastMessageCount = e.messageCount
    if (prev) await learn($, prev, startedAt, u, isShorter).catch(() => undefined)
    await update($, clock, () => ({ lastAt: startedAt, promptTokens: promptTokens(u), model: u.model }))
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const mine = await cacheLine($, e)
    if (!mine) return next(e)
    // Mods beneath draw their own lines under this one.
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {mine}
        {await next(e)}
      </Box>
    )
  })
}
