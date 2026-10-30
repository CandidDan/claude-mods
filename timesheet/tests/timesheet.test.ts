import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const MIN = 60_000
const DAY = 24 * 60 * MIN
// A Wednesday, in UTC: the fake `date +%z` says the machine is on UTC.
const T0 = Date.UTC(2026, 9, 28, 10, 0)
const DIR = '/home/dan/.claude/timesheet'

type On = Parameters<TestBody>[1]
type Step = Parameters<TestBody>[0]

/** The world beneath: a session in a repo, a file system in memory, the status line. */
function world(on: On, time: { now: () => number }, env: Record<string, string> = {}) {
  const files = new Map<string, { text: string; mtimeMs: number }>()
  const status: (string | undefined)[] = []
  const session = { id: 's1', root: '/work/acme-site', remote: null as string | null }
  mock.store(on)
  mock.env(on, { HOME: '/home/dan', ...env })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'time' } }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  // The model writes "Did: <first note>" for each date it is asked about, or fails with `model.failure`.
  const asked: string[] = []
  const model = { failure: null as string | null }
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('model.complete', ($, e) => {
    asked.push(e.prompt)
    if (model.failure) return { value: { isAnswered: false, reason: model.failure, status: 529, error: 'overloaded', usage } as never }
    const text = [...e.prompt.matchAll(/^(\d{4}-\d{2}-\d{2})\n- (.+)$/gm)].map(m => `${m[1]}: Did: ${m[2]}`).join('\n')
    return { value: { isAnswered: true, text, usage } as never }
  })
  on('session.id', () => ({ value: session.id }))
  on('session.cwd', () => ({ value: session.root }))
  on('session.repo', () => ({ value: { root: session.root, remote: session.remote, internal: false, name: null } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '+0000\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.status', ($, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('fs.read', ($, e) => {
    const f = files.get(e.path)
    return f ? { value: f.text } : { deny: 'ENOENT' }
  })
  on('fs.write', ($, e) => {
    files.set(e.path, { text: e.text, mtimeMs: time.now() })
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: [...files.keys()].some(p => p === e.path || p.startsWith(`${e.path}/`)) }))
  on('fs.list', ($, e) => ({
    value: [...files]
      .filter(([p]) => p.startsWith(`${e.path}/`))
      .map(([p, f]) => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: f.text.length, mtimeMs: f.mtimeMs, isLink: false })),
  }))
  return { files, status, session, asked, model }
}

const start = ($: Step) => $.session.start({ cwd: '/work/acme-site', surface: 'desktop', isInteractive: true })
const time = async ($: Step, args = '') => (await $.command.run({ command: 'time', args } as never)).text

/** One exchange: you send, Claude works for `workMs`, the turn ends. */
async function exchange($: Step, clock: { advance: (ms: number) => Promise<void> }, workMs: number) {
  await $.prompt.submit({ text: 'do the thing' } as never)
  await $.turn.start({ text: 'do the thing', turnId: 't' })
  await clock.advance(workMs)
  await $.turn.complete({ turnId: 't', answer: 'done', durationMs: workMs, isAborted: false, reason: 'answer' })
  await clock.advance(0)
}

test('activity within the idle limit is one block, shown in the status line and /time', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on, clock)
  await start($)
  await exchange($, clock, 3 * MIN)
  await clock.advance(5 * MIN) // reading, thinking
  await exchange($, clock, 2 * MIN)

  expect(await time($, 'today')).toMatch(/acme-site\s+10m/)
  expect(w.status.at(-1)).toBe('⏱ acme-site · 10m today')
  expect(JSON.parse(w.files.get(`${DIR}/s1.json`)!.text).segments).toHaveLength(1)
})

test('a gap past the idle limit is not counted and starts a new block', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on, clock)
  await start($)
  await exchange($, clock, 4 * MIN)
  await clock.advance(45 * MIN) // lunch
  await exchange($, clock, 6 * MIN)

  expect(await time($, 'today')).toMatch(/acme-site\s+10m/)
  expect(JSON.parse(w.files.get(`${DIR}/s1.json`)!.text).segments).toHaveLength(2)
})

test('a long turn counts past the idle limit', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  world(on, clock)
  await start($)
  await exchange($, clock, 25 * MIN)
  expect(await time($, 'today')).toMatch(/acme-site\s+25m/)
})

test('two sessions on one repo at once count that time once; other repos apart', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on, clock)
  w.files.set(`${DIR}/other.json`, {
    mtimeMs: T0,
    text: JSON.stringify({
      sessionId: 'other',
      segments: [
        { root: '/work/acme-site', start: T0 - 10 * MIN, end: T0 + 5 * MIN },
        { root: '/work/blog', start: T0 - 60 * MIN, end: T0 - 30 * MIN },
      ],
    }),
  })
  await start($)
  await exchange($, clock, 10 * MIN)
  const out = await time($, 'today')
  expect(out).toMatch(/acme-site\s+20m/)
  expect(out).toMatch(/blog\s+30m/)
  expect(out).toMatch(/Total\s+50m/)
})

test('/time name renames the repo in reports', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  world(on, clock)
  await start($)
  await exchange($, clock, 5 * MIN)
  await time($, 'name Acme Corp')
  expect(await time($, 'week')).toMatch(/Acme Corp\s+5m/)
})

test('/time pause stops tracking until resume', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on, clock)
  await start($)
  await exchange($, clock, 5 * MIN)
  await time($, 'pause')
  expect(w.status.at(-1)).toContain('paused')
  await exchange($, clock, 20 * MIN)
  await time($, 'resume')
  expect(await time($, 'today')).toMatch(/acme-site\s+5m/)
})

test('export writes a CSV, rounded up and priced', { options: { roundTo: 6, rate: 120 } }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on, clock)
  await start($)
  await exchange($, clock, 13 * MIN)
  expect(await time($, 'today')).toMatch(/13m\s+billed 18m\s+36\.00/)
  const said = await time($, 'export week')
  const path = '/home/dan/Documents/Timesheets/timesheet-week-2026-10-28.csv'
  expect(said).toContain(path)
  const csv = w.files.get(path)!.text.trim().split('\n')
  expect(csv[0]).toBe('Date,Project,Path,Minutes,Hours billed,Amount,Blocks,Description')
  expect(csv[1]).toBe('2026-10-28,acme-site,/work/acme-site,13.0,0.30,36.00,10:00-10:13,Did: do the thing')
})

test('notes keep what each prompt asked, not slash commands, and describe the day', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on, clock)
  await start($)
  await $.prompt.submit({ text: 'Fix the  checkout\nvalidation' } as never)
  await clock.advance(MIN)
  await $.prompt.submit({ text: '/time today' } as never)
  await $.prompt.submit({ text: 'x'.repeat(400) } as never)
  await clock.advance(0)
  const saved = JSON.parse(w.files.get(`${DIR}/s1.json`)!.text)
  const notes = saved.segments[0].notes.map((n: { text: string }) => n.text)
  expect(notes).toEqual(['Fix the checkout validation', `${'x'.repeat(159)}…`])
  await time($, 'export today')
  expect(w.asked).toHaveLength(1)
  expect(w.asked[0]).toContain('Project: acme-site')
  expect(w.asked[0]).toContain('- Fix the checkout validation')
})

test('with describe off, the export makes no model call and leaves the column empty', { options: { describe: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on, clock)
  await start($)
  await exchange($, clock, 5 * MIN)
  await time($, 'export today')
  expect(w.asked).toHaveLength(0)
  const csv = [...w.files].find(([p]) => p.endsWith('.csv'))![1].text.trim().split('\n')
  expect(csv[1]!.endsWith(',10:00-10:05,')).toBe(true)
})

test('an export says when the model gave no descriptions', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  world(on, clock).model.failure = 'api-error'
  await start($)
  await exchange($, clock, 5 * MIN)
  expect(await time($, 'export today')).toMatch(/Descriptions are missing where the model gave no answer \(api-error\)/)
})

test('a block across midnight splits between the two days', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 28, 23, 50) })
  world(on, clock)
  await start($)
  await exchange($, clock, 20 * MIN)
  expect(await time($, 'today')).toMatch(/acme-site\s+10m/)
  expect(await time($, 'yesterday')).toMatch(/acme-site\s+10m/)
})

/** Another session's file, written now: one block per [root, from, to] in minutes from T0. */
function seed(w: ReturnType<typeof world>, id: string, blocks: [string, number, number][]) {
  const segments = blocks.map(([root, a, b]) => ({ root, start: T0 + a * MIN, end: T0 + b * MIN }))
  w.files.set(`${DIR}/${id}.json`, { mtimeMs: T0 + 60 * MIN, text: JSON.stringify({ sessionId: id, segments }) })
}

test('naming a folder covers the repos and folders under it, past time included', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + 60 * MIN })
  const w = world(on, clock)
  seed(w, 'a', [
    ['/clients/acme/site', -60, -40],
    ['/clients/acme/notes', -30, -20],
    ['/clients/acme/notes/drafts', -15, -10],
    ['/work/blog', -50, -45],
  ])
  await start($)
  expect(await time($, 'name Acme Corp /clients/acme')).toContain('/clients/acme and everything under it show as "Acme Corp"')
  const out = await time($, 'today')
  expect(out).toMatch(/Acme Corp\s+35m/)
  expect(out).toMatch(/blog\s+5m/)
  expect(await time($, 'names')).toContain('Acme Corp  ←  /clients/acme')
})

test('a more specific name wins, and the same name on two folders is one project', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + 60 * MIN })
  const w = world(on, clock)
  seed(w, 'a', [
    ['/clients/acme/site', -60, -40],
    ['/clients/acme/app', -30, -20],
    ['/elsewhere/acme-api', -35, -25],
  ])
  await start($)
  await time($, 'name Acme /clients/acme')
  await time($, 'name Acme App /clients/acme/app')
  expect(await time($, 'name Acme /elsewhere/acme-api')).toContain('shares the name with /clients/acme')
  const out = await time($, 'today')
  expect(out).toMatch(/Acme\s+30m/) // site 20m + acme-api 10m
  expect(out).toMatch(/Acme App\s+10m/)
})

test('folders with the same name are told apart by their parent', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + 60 * MIN })
  const w = world(on, clock)
  seed(w, 'a', [
    ['/clients/acme/website', -60, -50],
    ['/personal/website', -40, -35],
  ])
  await start($)
  const out = await time($, 'today')
  expect(out).toMatch(/website \(acme\)\s+10m/)
  expect(out).toMatch(/website \(personal\)\s+5m/)
})

test('/time name with only a folder removes its name', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + 60 * MIN })
  const w = world(on, clock)
  seed(w, 'a', [['/clients/acme/site', -60, -40]])
  await start($)
  await time($, 'name Acme /clients/acme/')
  expect(await time($, 'name /clients/acme')).toBe('Removed the name "Acme" from /clients/acme.')
  expect(await time($, 'today')).toMatch(/site\s+20m/)
})

const PANE = {
  plugin: 'timesheet',
  component: 'Pane',
  requestId: 'timesheet',
  props: {
    title: 'Timesheet',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('the pane lists projects for the week, switches range and opens a project', async ($, on) => {
  const clock = mock.clock(on, { now: T0 + 60 * MIN })
  const w = world(on, clock)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  w.files.set(`${DIR}/a.json`, {
    mtimeMs: T0 + 60 * MIN,
    text: JSON.stringify({
      sessionId: 'a',
      segments: [
        { root: '/work/acme-site', start: T0 - 30 * MIN, end: T0 + 10 * MIN },
        { root: '/work/blog', start: T0 - DAY, end: T0 - DAY + 20 * MIN },
      ],
    }),
  })
  await start($)
  expect(await time($, 'view')).toBe('Timesheet pane opened.')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'project-/work/acme-site' }))?.text).toMatch(/▸ acme-site .*█+.*40m/)
    expect((await ui.find({ key: 'project-/work/blog' }))?.text).toMatch(/blog .*20m/)
    expect(await ui.find({ type: 'Text', text: /Total.*1h 00m/ })).toBeDefined()

    await ui.press({ key: 'project-/work/acme-site' })
    expect(await ui.find({ type: 'Text', text: /Wed 28 Oct\s+40m\s+09:30–10:10/ })).toBeDefined()
    await ui.press({ key: 'project-/work/acme-site' })

    await ui.press({ key: 'range-today' })
    expect(await ui.find({ key: 'project-/work/blog' })).toBeUndefined()
    await ui.press({ key: 'range-week' })
    await ui.unmount()
  }
})

test('the pane exports its range as a CSV', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on, clock)
  const toasts: string[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await start($)
  await exchange($, clock, 13 * MIN)
  await time($, 'view today')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'export' })
  const path = '/home/dan/Documents/Timesheets/timesheet-today-2026-10-28.csv'
  expect(w.files.get(path)?.text).toContain('2026-10-28,acme-site,/work/acme-site,13.0')
  expect(toasts.at(-1)).toContain(path)
  await ui.unmount()
})

/** GitHub's contents API in memory: path → { sha, text }, with the requests made. */
function fakeGithub(on: On) {
  const files = new Map<string, { sha: string; text: string }>()
  const calls: { method: string; path: string; auth?: string }[] = []
  let n = 0
  on('http.fetch', ($, e) => {
    const method = e.init?.method ?? 'GET'
    const path = e.url.replace('https://api.github.com/repos/candiddan/timesheet-data/contents/', '')
    calls.push({ method, path, auth: e.init?.headers?.Authorization })
    const answer = (status: number, body: unknown) => ({
      value: { status, ok: status < 300, headers: {}, text: typeof body === 'string' ? body : JSON.stringify(body) },
    })
    if (method === 'PUT') {
      const { content, sha } = JSON.parse(e.init!.body!) as { content: string; sha?: string }
      const had = files.get(path)
      if (had && had.sha !== sha) return answer(409, { message: 'sha mismatch' })
      const next = { sha: `sha${++n}`, text: decodeURIComponent(escape(atob(content))) }
      files.set(path, next)
      return answer(had ? 200 : 201, { content: { sha: next.sha } })
    }
    const file = files.get(path)
    if (file) return answer(200, e.init?.headers?.Accept === 'application/vnd.github.raw' ? file.text : { sha: file.sha })
    const prefix = `${path}/`
    const below = [...files.keys()].filter(p => p.startsWith(prefix))
    if (!below.length) return answer(404, { message: 'Not Found' })
    const entries = new Map<string, { name: string; path: string; sha: string; type: string }>()
    for (const p of below) {
      const name = p.slice(prefix.length).split('/')[0]!
      const isFile = !p.slice(prefix.length).includes('/')
      entries.set(name, { name, path: `${prefix}${name}`, sha: isFile ? files.get(p)!.sha : '', type: isFile ? 'file' : 'dir' })
    }
    return answer(200, [...entries.values()])
  })
  return { files, calls }
}

const SYNC = { options: { syncRepo: 'CandidDan/timesheet-data', githubToken: 'test-token' } }

test('with a sync repo, each finished turn pushes the session to its month', SYNC, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on, clock)
  w.session.remote = 'git@github.com:CandidDan/acme-site.git'
  const gh = fakeGithub(on)
  await start($)
  await exchange($, clock, 5 * MIN)
  await clock.advance(2 * MIN)
  await exchange($, clock, 3 * MIN)

  const pushed = JSON.parse(gh.files.get('sessions/2026-10/s1.json')!.text)
  expect(pushed.segments).toEqual([
    { root: '/work/acme-site', start: T0, end: T0 + 10 * MIN, remote: 'candiddan/acme-site', notes: [
      { at: T0, text: 'do the thing' },
      { at: T0 + 7 * MIN, text: 'do the thing' },
    ] },
  ])
  expect(gh.calls.every(c => c.auth === 'Bearer test-token')).toBe(true)
})

test('a cloud session pulled from the repo counts under this machine\'s folder for its repo', SYNC, async ($, on) => {
  const clock = mock.clock(on, { now: T0 + 60 * MIN })
  const w = world(on, clock)
  w.session.remote = 'https://github.com/CandidDan/acme-site'
  const gh = fakeGithub(on)
  gh.files.set('sessions/2026-10/cloud1.json', {
    sha: 'c1',
    text: JSON.stringify({
      sessionId: 'cloud1',
      segments: [
        // Overlaps the local block by 5 minutes, which counts once.
        { root: '/home/user/acme-site', start: T0 + 10 * MIN, end: T0 + 30 * MIN, remote: 'candiddan/acme-site' },
        { root: '/home/user/blog', start: T0 - 20 * MIN, end: T0 - 5 * MIN, remote: 'candiddan/blog' },
      ],
    }),
  })
  await start($)
  await exchange($, clock, 15 * MIN) // 11:00–11:15 local
  w.files.set(`${DIR}/s0.json`, {
    mtimeMs: T0 + 60 * MIN,
    text: JSON.stringify({ sessionId: 's0', segments: [{ root: '/work/acme-site', start: T0, end: T0 + 15 * MIN, remote: 'candiddan/acme-site' }] }),
  })
  const out = await time($, 'today')
  expect(out).toMatch(/acme-site\s+45m/) // 10:00–10:30 and 11:00–11:15
  expect(out).toMatch(/blog\s+15m/)
  expect(out).not.toMatch(/\(/)
  expect(await time($, 'sync')).toBe('Synced with candiddan/timesheet-data: this session pushed, 1 other session pulled.')
  expect(gh.files.has('sessions/2026-10/s1.json')).toBe(true)
})

test('/time sync with no sync repo says time stays on this machine', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  world(on, clock)
  await start($)
  expect(await time($, 'sync')).toMatch(/^Sync is off/)
})

test('a cloud environment turns sync on with its variables', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  world(on, clock, { TIMESHEET_SYNC_REPO: 'CandidDan/timesheet-data', TIMESHEET_GITHUB_TOKEN: 'env-token' })
  const gh = fakeGithub(on)
  await start($)
  await exchange($, clock, 2 * MIN)
  expect(gh.files.has('sessions/2026-10/s1.json')).toBe(true)
  expect(gh.calls.every(c => c.auth === 'Bearer env-token')).toBe(true)
})

test('a folder beyond ASCII is pushed as UTF-8', SYNC, async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const w = world(on, clock)
  w.session.root = '/work/café ✓ 😀'
  const gh = fakeGithub(on)
  await start($)
  await exchange($, clock, 2 * MIN)
  expect(JSON.parse(gh.files.get('sessions/2026-10/s1.json')!.text).segments[0].root).toBe('/work/café ✓ 😀')
})
