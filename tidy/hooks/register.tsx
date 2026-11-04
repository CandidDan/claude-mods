import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Idle, TidyView } from '../types'

// Change the tag when TidyView's fields change: it declines what an earlier version stored.
const view = atom({ plugin: 'tidy', key: 'view' } as const, null, { shape: 'view-1' })

const PANE = 'tidy'
// The desktop app's own session tools; the terminal and cloud sessions don't have them.
const SERVER = 'ccd_session_mgmt'
const HOUR = 60 * 60_000
const REFRESH_MS = 15 * 60_000
const UNAVAILABLE = 'Only the Claude desktop app can list your sessions, so there is nothing to tidy here.'

// Module variables start over on a reload; register sets the option again.
let idleMs = 24 * HOUR

/** A session as list_sessions returns it: only the fields tidy reads. */
type Listed = {
  sessionId: string
  title?: string
  isArchived?: boolean
  isRunning?: boolean
  pinned?: boolean
  prNumber?: number
  prState?: string
  lastActivityAt?: string
}

/** Finished: not archived, running or pinned, no open PR, and idle for at least `idleMs`. */
export function isFinished(s: Listed, now: number, idle: number): boolean {
  if (s.isArchived || s.isRunning || s.pinned) return false
  if (s.prState && s.prState !== 'MERGED' && s.prState !== 'CLOSED') return false
  const at = Date.parse(s.lastActivityAt ?? '')
  return Number.isFinite(at) && now - at >= idle
}

function textOf(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.map(b => (b.type === 'text' ? (b.text ?? '') : '')).join('')
}

async function list($: EngineInterface): Promise<TidyView> {
  const now = await $.clock.now()
  let listed: Listed[]
  try {
    const result = await $.mcp.call(SERVER, 'list_sessions', { limit: 200 })
    if (result.isError) return { rows: [], checkedAt: now, error: textOf(result) || 'The app could not list your sessions.' }
    listed = JSON.parse(textOf(result)) as Listed[]
  } catch {
    return { rows: [], checkedAt: now, error: UNAVAILABLE }
  }
  const rows: Idle[] = listed
    .filter(s => isFinished(s, now, idleMs))
    .map(s => ({
      id: s.sessionId,
      title: s.title || 'Untitled session',
      lastActivityAt: Date.parse(s.lastActivityAt ?? ''),
      pr: s.prNumber ?? null,
      prState: s.prState ?? null,
    }))
    .sort((a, b) => a.lastActivityAt - b.lastActivityAt)
  return { rows, checkedAt: now, error: null }
}

async function refresh($: EngineInterface): Promise<TidyView> {
  const next = await list($)
  await update($, view, () => next)
  return next
}

/** Archives one session; the app asks you to approve it unless you run in auto or bypass mode. Returns why not, if it wasn't. */
async function archive($: EngineInterface, row: Idle): Promise<string | null> {
  const reason = row.pr ? `PR #${row.pr} ${row.prState?.toLowerCase()}, idle ${ago(row.lastActivityAt, await $.clock.now())}` : `Idle ${ago(row.lastActivityAt, await $.clock.now())}`
  try {
    const result = await $.mcp.call(SERVER, 'archive_session', { session_id: row.id, reason })
    if (result.isError) return textOf(result) || `Couldn't archive "${row.title}".`
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  await update($, view, v => (v ? { ...v, rows: v.rows.filter(r => r.id !== row.id) } : v))
  return null
}

function ago(at: number, now: number): string {
  const hours = Math.max(0, Math.floor((now - at) / HOUR))
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

function summary(v: TidyView): string {
  if (v.error) return v.error
  if (v.rows.length === 0) return 'No finished sessions to tidy.'
  return `${v.rows.length} finished session${v.rows.length === 1 ? '' : 's'} ready to archive.`
}

export const register: Register = (on, options) => {
  idleMs = Math.max(1, Number(options.idleHours ?? 24) || 24) * HOUR

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'tidy',
      description: 'List finished sessions sitting idle (no open PR, quiet for a day) and archive them',
    })
    $.clock.every(REFRESH_MS, () => {
      void (async () => {
        if (await read($, view)) await refresh($)
      })().catch(() => undefined)
    })
    return r
  })

  on('command.run', { command: 'tidy' }, async $ => {
    const v = await refresh($)
    await $.ui.open({ id: PANE, title: 'Tidy' })
    return { text: summary(v) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const shown = await read($, view)
    const now = await $.clock.now()
    const rows = shown?.rows ?? []
    const archiveOne = (row: Idle) => async () => {
      const failed = await archive($, row)
      if (failed) $.ui.toast(failed)
    }
    const archiveAll = async () => {
      let done = 0
      let failed: string | null = null
      for (const row of rows) {
        const why = await archive($, row)
        if (why) failed = why
        else done++
      }
      $.ui.toast(failed ? `Archived ${done} of ${rows.length}. ${failed}` : `Archived ${done} session${done === 1 ? '' : 's'}.`)
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor wrap="wrap">
          {shown ? summary(shown) : 'Run /tidy to look for finished sessions.'}
        </Text>
        {rows.length > 0 && (
          // Buttons are a line tall in the terminal, taller elsewhere: only there do rows need a gap.
          <Box flexDirection="column" rowGap={e.surface === 'terminal' ? 0 : 1}>
            {rows.map(row => (
              // The title gives way to the age and PR, which always show whole.
              <Box key={row.id} columnGap={1} alignItems="center">
                <Box flexShrink={0}>
                  <Button key={`archive-${row.id}`} label="Archive" dimColor onPress={archiveOne(row)} />
                </Box>
                <Box flexShrink={1} minWidth={0}>
                  <Text wrap="truncate">{row.title}</Text>
                </Box>
                <Box flexShrink={0}>
                  <Text dimColor tabular>
                    {ago(row.lastActivityAt, now)}
                    {row.pr ? ` · PR #${row.pr} ${row.prState?.toLowerCase()}` : ''}
                  </Text>
                </Box>
              </Box>
            ))}
          </Box>
        )}
        <Box columnGap={1}>
          {rows.length > 1 && <Button key="archive-all" label="Archive all" variant="primary" onPress={archiveAll} />}
          <Button key="refresh" label="Refresh" dimColor onPress={async () => void (await refresh($))} />
        </Box>
      </Box>
    )
  })
}
