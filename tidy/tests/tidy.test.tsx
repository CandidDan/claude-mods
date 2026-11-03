import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const HOUR = 60 * 60_000
const T0 = Date.UTC(2026, 10, 3, 12, 0)
const PANE = {
  plugin: 'tidy',
  component: 'Pane',
  requestId: 'tidy',
  props: {
    title: 'Tidy',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

type On = Parameters<TestBody>[1]
type Step = Parameters<TestBody>[0]
type Row = Record<string, unknown>

const at = (hoursAgo: number) => new Date(T0 - hoursAgo * HOUR).toISOString()
const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], isError: false })

/** The world beneath: the desktop app's session tools over `sessions`, toasts, the pane. */
function world(on: On, sessions: Row[] | null) {
  const toasts: string[] = []
  const archived: string[] = []
  const refused = new Set<string>()
  mock.clock(on, { now: T0 })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'tidy' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', ($, e) => {
    toasts.push(String((e as { text?: string }).text ?? e))
    return { value: undefined }
  })
  // `null` stands for a session with no desktop app: the server isn't there.
  on('mcp.call', ($, e) => {
    if (!sessions) throw new Error(`No MCP server named ${e.server}`)
    if (e.tool === 'list_sessions') return { value: json(sessions.filter(s => !archived.includes(String(s.sessionId)))) }
    const id = String(e.args.session_id)
    if (refused.has(id)) return { value: { content: [{ type: 'text' as const, text: 'The user declined.' }], isError: true } }
    archived.push(id)
    return { value: json({ archived: id }) }
  })
  return { toasts, archived, refused }
}

const SESSIONS: Row[] = [
  { sessionId: 'merged', title: 'Ship timesheet', isRunning: false, prNumber: 20, prState: 'MERGED', lastActivityAt: at(30) },
  { sessionId: 'no-pr', title: 'Heavy usage sessions', isRunning: false, lastActivityAt: at(100) },
  { sessionId: 'open-pr', title: 'Onboarding MCP', isRunning: false, prNumber: 260, prState: 'OPEN', lastActivityAt: at(48) },
  { sessionId: 'running', title: 'Busy', isRunning: true, lastActivityAt: at(40) },
  { sessionId: 'pinned', title: 'Keep me', isRunning: false, pinned: true, lastActivityAt: at(40) },
  { sessionId: 'recent', title: 'Just now', isRunning: false, lastActivityAt: at(2) },
  { sessionId: 'closed', title: 'Abandoned idea', isRunning: false, prNumber: 7, prState: 'CLOSED', lastActivityAt: at(25) },
]

/** /tidy as typed at the prompt; the engine fills the rest of the input. */
const tidy = ($: Step) => $.command.run({ command: 'tidy', args: '' } as never)

async function start($: Step) {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}

test('/tidy lists only idle sessions with no open PR, oldest first, on every surface', async ($, on) => {
  world(on, SESSIONS)
  await start($)

  expect((await tidy($)).text).toBe('3 finished sessions ready to archive.')
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const titles = (await ui.findAll({ type: 'Text', text: /Ship timesheet|Heavy usage|Abandoned|Onboarding|Busy|Keep me|Just now/ })).map(r => r.text)
    expect(titles).toEqual(['Heavy usage sessions', 'Ship timesheet', 'Abandoned idea'])
    // The age and PR sit apart from the title, so a long title can't push them off the row.
    const ages = (await ui.findAll({ type: 'Text', text: /^\d+[hd]( · PR|$)/ })).map(r => r.text)
    expect(ages).toEqual(['4d', '30h · PR #20 merged', '25h · PR #7 closed'])
    await ui.unmount()
  }
})

test('the idle option moves the line', { options: { idleHours: 72 } }, async ($, on) => {
  world(on, SESSIONS)
  await start($)

  expect((await tidy($)).text).toBe('1 finished session ready to archive.')
})

test('Archive removes one row; a declined one stays and says why', async ($, on) => {
  const w = world(on, SESSIONS)
  w.refused.add('closed')
  await start($)
  await tidy($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'archive-merged' })
  expect(w.archived).toEqual(['merged'])
  expect(await ui.find({ type: 'Text', text: /Ship timesheet/ })).toBeUndefined()

  await ui.press({ key: 'archive-closed' })
  expect(w.toasts).toEqual(['The user declined.'])
  expect(await ui.find({ type: 'Text', text: /Abandoned idea/ })).toBeDefined()
  await ui.unmount()
})

test('Archive all archives each and reports any it could not', async ($, on) => {
  const w = world(on, SESSIONS)
  w.refused.add('no-pr')
  await start($)
  await tidy($)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'archive-all' })
  expect(w.archived).toEqual(['merged', 'closed'])
  expect(w.toasts).toEqual(['Archived 2 of 3. The user declined.'])
  await ui.unmount()
})

test('outside the desktop app it says so instead of failing', async ($, on) => {
  world(on, null)
  await start($)

  expect((await tidy($)).text).toContain('Only the Claude desktop app')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'archive-all' })).toBeUndefined()
  await ui.unmount()
})
