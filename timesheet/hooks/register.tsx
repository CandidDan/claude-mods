import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PaneRow, PaneView, Segment, SessionLog } from '../types'

const isPaused = atom({ plugin: 'timesheet', key: 'isPaused' } as const, false)
const paneRange = atom({ plugin: 'timesheet', key: 'range' } as const, 'week')
const expanded = atom({ plugin: 'timesheet', key: 'expanded' } as const, null)
// Change the tag when PaneView's fields change: it declines what an earlier version stored.
const view = atom({ plugin: 'timesheet', key: 'view' } as const, null, { shape: 'view-1' })

const PANE = 'timesheet'
const TABS: [string, string][] = [
  ['today', 'Today'],
  ['week', 'Week'],
  ['lastweek', 'Last week'],
  ['month', 'Month'],
  ['lastmonth', 'Last month'],
]
const BAR = 14

const MIN = 60_000
const DAY = 24 * 60 * MIN
// Typing and clicks count at most this often; a turn in progress beats this often.
const BEAT_MS = 15_000

type Range = { from: number; to: number; label: string }

// Module variables start over on a reload; register sets the options again,
// and the session's log is read back from its file at the next beat.
let idleMs = 10 * MIN
let roundTo = 0
let rate = 0
let exportDir = '~/Documents/Timesheets'
let syncRepo = ''
let tokenOption = ''

let log: SessionLog | null = null
let lastBeatAt = 0
let isWorking = false
let home = ''
let tzOffset = 0
let rootCache: { root: string; remote: string | null; at: number } | null = null
let queue: Promise<unknown> = Promise.resolve()

// Sync: this session's file in the repo and when it was last pushed; the
// other sessions' files as last pulled, by session id.
const PUSH_MS = 60_000
const PULL_MS = 2 * MIN
let token: string | null = null
let pushed: { path: string; sha: string } | null = null
let lastPushAt = 0
let lastPullAt = 0
let pulled = new Map<string, { sha: string; log: SessionLog }>()
let syncError = ''

const dataDir = () => `${home}/.claude/timesheet`
const fileOf = (sessionId: string) => `${dataDir()}/${sessionId}.json`
const basename = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
const expand = (path: string) => path.replace(/^~(?=$|[\\/])/, home)

// Local calendar arithmetic: shift by the offset and read the UTC fields.
const local = (ms: number) => new Date(ms + tzOffset)
const dayStart = (ms: number) => Math.floor((ms + tzOffset) / DAY) * DAY - tzOffset
const dateOf = (ms: number) => local(ms).toISOString().slice(0, 10)
const timeOf = (ms: number) => local(ms).toISOString().slice(11, 16)

function duration(ms: number) {
  const minutes = Math.round(ms / MIN)
  if (minutes === 0) return ms > 0 ? '<1m' : '0m'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

/** Minutes billed for one project's day: exact, or rounded up to the increment. */
const billed = (ms: number) => (roundTo > 0 ? Math.ceil(ms / MIN / roundTo - 1e-9) * roundTo : ms / MIN)
const money = (minutes: number) => (rate > 0 ? (minutes / 60) * rate : 0)

function parseLog(text: string): SessionLog | null {
  try {
    const v = JSON.parse(text) as SessionLog
    if (typeof v?.sessionId !== 'string' || !Array.isArray(v.segments)) return null
    const segments = v.segments.filter(
      s =>
        typeof s?.root === 'string' &&
        typeof s.start === 'number' &&
        typeof s.end === 'number' &&
        s.end >= s.start &&
        (s.remote === undefined || typeof s.remote === 'string'),
    )
    return { sessionId: v.sessionId, segments }
  } catch {
    return null
  }
}

async function loadLog($: EngineInterface, sessionId: string): Promise<SessionLog> {
  const text = await $.fs.read(fileOf(sessionId)).catch(() => '')
  return parseLog(text) ?? { sessionId, segments: [] }
}

/** `owner/name` from any form of a remote URL: https, ssh, or a proxy's path. */
function remoteName(url: string | null | undefined) {
  const parts = (url ?? '').replace(/\.git$/, '').split(/[/:]/).filter(Boolean)
  return parts.length >= 2 ? parts.slice(-2).join('/').toLowerCase() : null
}

/** The repo this session works in (the main tree's root for a worktree), else its folder. */
async function currentPlace($: EngineInterface) {
  const now = await $.clock.now()
  if (rootCache && now - rootCache.at < MIN) return rootCache
  const repo = await $.session.repo().catch(() => null)
  rootCache = { root: repo?.root ?? (await $.session.cwd()), remote: remoteName(repo?.remote), at: now }
  return rootCache
}

const currentRoot = async ($: EngineInterface) => (await currentPlace($)).root

type Names = Record<string, string>

async function names($: EngineInterface): Promise<Names> {
  const v = await $.store.get('names')
  return v && typeof v === 'object' ? (v as Names) : {}
}

const parentOf = (path: string) => path.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '')
const isUnder = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`)

/**
 * The project a repo or folder belongs to: the most specific named folder at
 * or above it, by its name, so every folder given one name is one project;
 * else the folder itself.
 */
function projectOf(root: string, nameMap: Names): { id: string; name: string | null } {
  let best = ''
  for (const folder of Object.keys(nameMap)) if (isUnder(root, folder) && folder.length > best.length) best = folder
  const name = best ? nameMap[best] : undefined
  return name ? { id: `name:${name}`, name } : { id: root, name: null }
}

/** Labels for the projects in one report: an unnamed folder sharing a label gets its parent's. */
function labelsOf(ids: string[]) {
  const plain = (id: string) => (id.startsWith('name:') ? id.slice(5) : basename(id))
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(plain(id), (counts.get(plain(id)) ?? 0) + 1)
  return new Map(
    ids.map(id => {
      const label = plain(id)
      const isClash = !id.startsWith('name:') && (counts.get(label) ?? 0) > 1
      return [id, isClash ? `${label} (${basename(parentOf(id))})` : label]
    }),
  )
}

/** Records activity now: extends the current block, or opens one after an idle gap. */
function beat($: EngineInterface, isForced = false) {
  queue = queue.then(() => doBeat($, isForced)).catch(() => undefined)
  return queue
}

async function doBeat($: EngineInterface, isForced: boolean) {
  if (await read($, isPaused)) return
  const now = await $.clock.now()
  if (!isForced && now - lastBeatAt < BEAT_MS) return
  lastBeatAt = now
  const sessionId = await $.session.id()
  // A /clear goes on under a new id: its time goes in a file of its own.
  if (log?.sessionId !== sessionId) log = await loadLog($, sessionId)
  const { root, remote } = await currentPlace($)
  const last = log.segments.at(-1)
  if (last && last.root === root && now - last.end <= idleMs) last.end = Math.max(last.end, now)
  else log.segments.push(remote ? { root, start: now, end: now, remote } : { root, start: now, end: now })
  await $.fs.write(fileOf(sessionId), JSON.stringify(log))
  await showStatus($)
  await refreshPane($)
  if (now - lastPushAt >= PUSH_MS) await push($)
}

/** Every block from every session that may reach past `since`, this session's as held. */
async function segmentsSince($: EngineInterface, since: number): Promise<Segment[]> {
  const own: Segment[] = log ? [...log.segments] : []
  const local = new Set(log ? [log.sessionId] : [])
  const dir = dataDir()
  if (await $.fs.exists(dir)) {
    for (const f of await $.fs.list(dir)) {
      if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
      const id = f.name.slice(0, -5)
      if (local.has(id)) continue
      local.add(id)
      // A file last written before `since` holds no time after it.
      if (f.mtimeMs < since) continue
      const other = parseLog(await $.fs.read(`${dir}/${f.name}`).catch(() => ''))
      if (other) own.push(...other.segments)
    }
  }
  // Another machine's or a cloud session's blocks, under this machine's
  // folder for the same repo where this machine has worked in it.
  const here = new Map(own.filter(s => s.remote).map(s => [s.remote, s.root]))
  const away = [...pulled]
    .filter(([id]) => !local.has(id))
    .flatMap(([, p]) => p.log.segments)
    .filter(s => s.end >= since)
    .map(s => ({ ...s, root: (s.remote && here.get(s.remote)) || s.root }))
  return [...own, ...away]
}

// --- Sync through a GitHub repository: sessions/<month>/<session id>.json ---

async function githubToken($: EngineInterface) {
  if (tokenOption) return tokenOption
  if (token !== null) return token
  token = (await $.env.get('TIMESHEET_GITHUB_TOKEN')) ?? ''
  if (!token) {
    const r = await $.process.run(['gh', 'auth', 'token'], { timeoutMs: 5000 }).catch(() => null)
    token = r?.exitCode === 0 ? r.stdout.trim() : ''
  }
  return token
}

async function github($: EngineInterface, path: string, init: { method?: string; body?: string; raw?: boolean } = {}) {
  const auth = await githubToken($)
  if (!auth) throw new Error('no GitHub token: set the githubToken option or TIMESHEET_GITHUB_TOKEN, or run gh auth login')
  return $.http.fetch(`https://api.github.com/repos/${syncRepo}/contents/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${auth}`,
      Accept: init.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'User-Agent': 'claude-code-timesheet',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: init.body,
  })
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64 of the text's UTF-8 bytes: the module has no btoa or Buffer to lean on. */
function base64(text: string) {
  const bytes: number[] = []
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = bytes.slice(i, i + 3)
    const n = (a << 16) | (b << 8) | c
    out += B64.charAt(n >> 18) + B64.charAt((n >> 12) & 63)
    out += i + 1 < bytes.length ? B64.charAt((n >> 6) & 63) : '='
    out += i + 2 < bytes.length ? B64.charAt(n & 63) : '='
  }
  return out
}

const monthOf = (ms: number) => dateOf(ms).slice(0, 7)

/** Pushes this session's log to its file in the sync repo, filed under the month it began. */
async function push($: EngineInterface) {
  if (!syncRepo || !log?.segments.length) return
  lastPushAt = await $.clock.now()
  const path = `sessions/${monthOf(log.segments[0]!.start)}/${log.sessionId}.json`
  const put = (sha?: string) =>
    github($, path, {
      method: 'PUT',
      body: JSON.stringify({ message: `timesheet: ${log!.sessionId}`, content: base64(JSON.stringify(log)), sha }),
    })
  try {
    let r = await put(pushed?.path === path ? pushed.sha : undefined)
    // The file is there already (an earlier load of the mod pushed it): send again on its sha.
    if (r.status === 409 || r.status === 422) {
      const head = await github($, path)
      if (head.ok) r = await put((JSON.parse(head.text) as { sha: string }).sha)
    }
    if (!r.ok) throw new Error(`push answered ${r.status}`)
    pushed = { path, sha: (JSON.parse(r.text) as { content: { sha: string } }).content.sha }
    syncError = ''
  } catch (err) {
    syncError = String((err as Error).message ?? err)
  }
}

type Listing = { name: string; path: string; sha: string; type: string }[]

/** Pulls the other sessions' files for the months that may reach past `since`, unchanged ones from cache. */
async function pull($: EngineInterface, since: number) {
  if (!syncRepo) return
  lastPullAt = await $.clock.now()
  try {
    const top = await github($, 'sessions')
    if (top.status === 404) return
    if (!top.ok) throw new Error(`pull answered ${top.status}`)
    // A session is filed under the month it began, so one month back covers one that ran on.
    const from = monthOf(Math.max(0, since - 31 * DAY))
    const months = (JSON.parse(top.text) as Listing).filter(m => m.type === 'dir' && m.name >= from)
    const mine = log?.sessionId
    for (const m of months) {
      const r = await github($, m.path)
      if (!r.ok) continue
      for (const f of JSON.parse(r.text) as Listing) {
        const id = f.name.replace(/\.json$/, '')
        if (f.type !== 'file' || id === mine || pulled.get(id)?.sha === f.sha) continue
        const body = await github($, f.path, { raw: true })
        const got = body.ok ? parseLog(body.text) : null
        if (got) pulled.set(id, { sha: f.sha, log: got })
      }
    }
    await $.fs.write(`${dataDir()}/remote/pulled.json`, JSON.stringify([...pulled]))
    syncError = ''
  } catch (err) {
    syncError = String((err as Error).message ?? err)
  }
}

/** The last pull, read back after a reload so the files need not be fetched again. */
async function loadPulled($: EngineInterface) {
  try {
    const rows = JSON.parse(await $.fs.read(`${dataDir()}/remote/pulled.json`)) as [string, { sha: string; log: SessionLog }][]
    pulled = new Map(rows.flatMap(([id, p]) => (typeof p?.sha === 'string' && parseLog(JSON.stringify(p.log)) ? [[id, p]] : [])))
  } catch {
    pulled = new Map()
  }
}

/** Pulls when the last pull is older than PULL_MS, or always when `isForced`. */
async function freshen($: EngineInterface, since: number, isForced = false) {
  if (syncRepo && (isForced || (await $.clock.now()) - lastPullAt >= PULL_MS)) await pull($, since)
}

type Day = { ms: number; blocks: [number, number][] }
type Tally = { days: Map<number, Day>; paths: Set<string> }

/**
 * Per project, the union of its blocks clipped to the range and split at local
 * midnight: two sessions open on one project at once count that time once.
 */
function tally(segments: Segment[], range: Range, nameMap: Names) {
  const byProject = new Map<string, { list: Segment[]; paths: Set<string> }>()
  for (const s of segments) {
    const start = Math.max(s.start, range.from)
    const end = Math.min(s.end, range.to)
    if (end <= start) continue
    const { id } = projectOf(s.root, nameMap)
    const p = byProject.get(id) ?? { list: [], paths: new Set<string>() }
    p.list.push({ root: s.root, start, end })
    p.paths.add(s.root)
    byProject.set(id, p)
  }
  const out = new Map<string, Tally>()
  for (const [id, { list, paths }] of byProject) {
    list.sort((a, b) => a.start - b.start)
    const merged: [number, number][] = []
    for (const s of list) {
      const last = merged.at(-1)
      if (last && s.start <= last[1]) last[1] = Math.max(last[1], s.end)
      else merged.push([s.start, s.end])
    }
    const days = new Map<number, Day>()
    for (let [start, end] of merged) {
      while (start < end) {
        const day = dayStart(start)
        const cut = Math.min(end, day + DAY)
        const d = days.get(day) ?? { ms: 0, blocks: [] }
        d.ms += cut - start
        d.blocks.push([start, cut])
        days.set(day, d)
        start = cut
      }
    }
    out.set(id, { days, paths })
  }
  return out
}

function rangeOf(word: string, now: number): Range | null {
  const today = dayStart(now)
  const d = local(now)
  const weekStart = today - ((d.getUTCDay() + 6) % 7) * DAY
  const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - tzOffset
  const lastMonthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1) - tzOffset
  switch (word) {
    case 'today':
      return { from: today, to: now, label: 'today' }
    case 'yesterday':
      return { from: today - DAY, to: today, label: 'yesterday' }
    case 'week':
      return { from: weekStart, to: now, label: 'this week' }
    case 'lastweek':
      return { from: weekStart - 7 * DAY, to: weekStart, label: 'last week' }
    case 'month':
      return { from: monthStart, to: now, label: 'this month' }
    case 'lastmonth':
      return { from: lastMonthStart, to: monthStart, label: 'last month' }
    case 'all':
      return { from: 0, to: now, label: 'all time' }
  }
  return null
}

/** Each project's time, billed minutes and days in the range, most first. */
async function summarize($: EngineInterface, range: Range): Promise<PaneRow[]> {
  const totals = tally(await segmentsSince($, range.from), range, await names($))
  const labels = labelsOf([...totals.keys()])
  const rows = [...totals].map(([id, { days }]) => ({
    id,
    label: labels.get(id) ?? id,
    ms: [...days.values()].reduce((sum, d) => sum + d.ms, 0),
    minutes: [...days.values()].reduce((sum, d) => sum + billed(d.ms), 0),
    days: [...days].sort(([a], [b]) => a - b).map(([day, d]) => ({ day, ...d })),
  }))
  return rows.sort((a, b) => b.ms - a.ms)
}

/** The range report: each repo's time, billed time and amount, most first. */
async function report($: EngineInterface, range: Range) {
  await freshen($, range.from)
  const rows = (await summarize($, range)).map(r => ({ name: r.label, ms: r.ms, minutes: r.minutes }))
  if (!rows.length) return `No time tracked ${range.label}.`
  const width = Math.max(5, ...rows.map(r => r.name.length))
  const line = (name: string, ms: number, minutes: number) => {
    const extra = [roundTo > 0 ? `billed ${duration(minutes * MIN)}` : '', rate > 0 ? money(minutes).toFixed(2) : '']
    return [`  ${name.padEnd(width)}  ${duration(ms).padStart(7)}`, ...extra.filter(Boolean)].join('   ')
  }
  const total = rows.reduce((sum, r) => ({ ms: sum.ms + r.ms, minutes: sum.minutes + r.minutes }), { ms: 0, minutes: 0 })
  return [
    `Time ${range.label}:`,
    ...rows.map(r => line(r.name, r.ms, r.minutes)),
    ...(rows.length > 1 ? [line('Total', total.ms, total.minutes)] : []),
  ].join('\n')
}

const csvCell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v))

/** One row per repo per day, with its blocks, written as a CSV file. */
async function exportCsv($: EngineInterface, range: Range, word: string) {
  await freshen($, range.from)
  const totals = tally(await segmentsSince($, range.from), range, await names($))
  const labels = labelsOf([...totals.keys()])
  const rows: (string | number)[][] = []
  for (const [id, { days, paths }] of totals) {
    for (const [day, d] of days) {
      const minutes = billed(d.ms)
      rows.push([
        dateOf(day),
        labels.get(id) ?? id,
        [...paths].sort().join('; '),
        (d.ms / MIN).toFixed(1),
        (minutes / 60).toFixed(2),
        rate > 0 ? money(minutes).toFixed(2) : '',
        d.blocks.map(([a, b]) => `${timeOf(a)}-${timeOf(b)}`).join('; '),
      ])
    }
  }
  if (!rows.length) return `No time tracked ${range.label}, so nothing to export.`
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])))
  const header = ['Date', 'Project', 'Path', 'Minutes', 'Hours billed', 'Amount', 'Blocks']
  const text = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n'
  const path = `${expand(exportDir).replace(/[\\/]+$/, '')}/timesheet-${word}-${dateOf(range.to - 1)}.csv`
  await $.fs.write(path, text)
  return `Wrote ${rows.length} rows (${range.label}) to ${path}`
}

async function showStatus($: EngineInterface) {
  if (await read($, isPaused)) return $.ui.status('⏱ paused · /time resume')
  const now = await $.clock.now()
  const range = { from: dayStart(now), to: now, label: 'today' }
  const root = await currentRoot($)
  const nameMap = await names($)
  const project = projectOf(root, nameMap)
  const days = tally(await segmentsSince($, range.from), range, nameMap).get(project.id)?.days
  const ms = days ? [...days.values()].reduce((sum, d) => sum + d.ms, 0) : 0
  const name = project.name ?? basename(root)
  $.ui.status(`⏱ ${name} · ${duration(ms)} today`)
}

/** Works out what the pane shows for its range; the draw only reads the result. */
async function refreshPane($: EngineInterface) {
  const word = await read($, paneRange)
  const range = rangeOf(word, await $.clock.now())
  if (!range) return
  const next: PaneView = { word, label: range.label, rows: await summarize($, range) }
  await update($, view, () => next)
}

async function openPane($: EngineInterface) {
  const range = rangeOf(await read($, paneRange), await $.clock.now())
  if (range) await freshen($, range.from)
  await refreshPane($)
  return $.ui.open({ id: PANE, title: 'Timesheet' })
}

const amountOf = (minutes: number) => (rate > 0 ? money(minutes).toFixed(2) : '')
const bar = (ms: number, most: number) => {
  const filled = most > 0 ? Math.max(ms > 0 ? 1 : 0, Math.round((ms / most) * BAR)) : 0
  return '█'.repeat(filled) + '░'.repeat(BAR - filled)
}
const dayLabel = (day: number) => {
  const d = local(day)
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
  return `${weekday} ${String(d.getUTCDate()).padStart(2)} ${month}`
}

const HELP = [
  '/time — today and this week, per project',
  '/time view — the timesheet in a pane beside the chat',
  '/time today | yesterday | week | lastweek | month | lastmonth | all',
  '/time export [range] — CSV timesheet, this month by default',
  '/time pause | resume — stop and restart tracking in this session',
  '/time name <name> [folder] — name this repo, or a folder and everything under it; the same name on two folders makes them one project',
  '/time name [folder] — with no name, remove the name; /time names lists them',
  '/time sync — push and pull now, and show the sync repository and its last error',
].join('\n')

async function command($: EngineInterface, args: string): Promise<string> {
  const [word = '', ...rest] = args.trim().split(/\s+/)
  const verb = word.toLowerCase()
  const now = await $.clock.now()
  if (verb === '') {
    return `${await report($, rangeOf('today', now)!)}\n\n${await report($, rangeOf('week', now)!)}`
  }
  if (verb === 'help') return HELP
  if (verb === 'view' || verb === 'pane') {
    const range = rest[0] && rangeOf(rest[0].toLowerCase(), now) ? rest[0].toLowerCase() : null
    if (range) await update($, paneRange, () => range)
    const { isPlaced } = await openPane($)
    return isPlaced ? 'Timesheet pane opened.' : 'Timesheet pane is open, but this surface does not show panes.'
  }
  if (verb === 'pause') {
    await update($, isPaused, () => true)
    await showStatus($)
    return 'Tracking paused in this session. /time resume starts it again.'
  }
  if (verb === 'resume') {
    await update($, isPaused, () => false)
    await beat($, true)
    return 'Tracking resumed.'
  }
  if (verb === 'name') return nameCommand($, args.trim().slice(word.length).trim())
  if (verb === 'names') {
    const nameMap = await names($)
    const folders = Object.keys(nameMap).sort()
    if (!folders.length) return 'No names yet. /time name <name> [folder] adds one.'
    return folders.map(folder => `${nameMap[folder]}  ←  ${folder} and everything under it`).join('\n')
  }
  if (verb === 'sync') return syncCommand($)
  if (verb === 'export') {
    const which = (rest[0] ?? 'month').toLowerCase()
    const range = rangeOf(which, now)
    return range ? exportCsv($, range, which) : `Unknown range "${which}".\n\n${HELP}`
  }
  const range = rangeOf(verb, now)
  return range ? report($, range) : HELP
}

async function syncCommand($: EngineInterface) {
  if (!syncRepo) return 'Sync is off: time stays on this machine. Set the syncRepo option to a private GitHub repository (owner/name) to count cloud sessions and other machines.'
  await (queue = queue.then(() => push($)).catch(() => undefined))
  await freshen($, 0, true)
  await refreshPane($)
  const others = pulled.size
  return syncError
    ? `Sync with ${syncRepo} failed: ${syncError}`
    : `Synced with ${syncRepo}: this session pushed, ${others} other session${others === 1 ? '' : 's'} pulled.`
}

/** `<name> [folder]`: the folder starts at the first word beginning with / or ~ and runs to the end. */
async function nameCommand($: EngineInterface, text: string) {
  const at = text.search(/(^|\s)[~/]/)
  const name = (at < 0 ? text : text.slice(0, at)).trim()
  const given = at < 0 ? '' : text.slice(at).trim()
  const folder = given ? expand(given).replace(/(.)[\\/]+$/, '$1') : await currentRoot($)
  const next = { ...(await names($)) }
  const old = next[folder]
  if (name) next[folder] = name
  else delete next[folder]
  await $.store.set('names', next)
  await showStatus($)
  await refreshPane($)
  const others = Object.keys(next).filter(f => f !== folder && next[f] === name)
  if (name) {
    const joined = others.length ? ` It shares the name with ${others.join(', ')}, so their time counts as one project.` : ''
    return `${folder} and everything under it show as "${name}" in reports, past time included.${joined}`
  }
  return old ? `Removed the name "${old}" from ${folder}.` : `${folder} had no name of its own.`
}

async function readTimezone($: EngineInterface) {
  const r = await $.process.run(['date', '+%z'], { timeoutMs: 5000 }).catch(() => null)
  const m = r?.stdout.trim().match(/^([+-])(\d\d)(\d\d)$/)
  if (m) return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * MIN
  return -new Date().getTimezoneOffset() * MIN
}

export const register: Register = (on, options) => {
  idleMs = Math.max(1, Number(options.idleMinutes ?? 10) || 10) * MIN
  roundTo = Math.max(0, Number(options.roundTo ?? 0) || 0)
  rate = Math.max(0, Number(options.rate ?? 0) || 0)
  exportDir = typeof options.exportDir === 'string' && options.exportDir.trim() ? options.exportDir.trim() : exportDir
  syncRepo = typeof options.syncRepo === 'string' ? (remoteName(options.syncRepo.trim()) ?? '') : ''
  tokenOption = typeof options.githubToken === 'string' ? options.githubToken.trim() : ''

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    home = (await $.env.get('HOME')) ?? ''
    tzOffset = await readTimezone($)
    // A cloud environment has no options dialog: its variables can name the repository instead.
    if (!syncRepo) syncRepo = remoteName(((await $.env.get('TIMESHEET_SYNC_REPO')) ?? '').trim()) ?? ''
    if (syncRepo) await loadPulled($)
    await $.command.register({
      name: 'time',
      description: 'Timesheet: time spent with Claude per project. today, week, month, export, pause, resume, name',
      argumentHint: 'today | week | month | export [range] | pause | resume | name <name>',
    })
    // A running turn is time spent on the work; between turns, only your own activity counts.
    $.clock.every(BEAT_MS, () => {
      if (isWorking) void beat($, true)
    })
    $.clock.every(MIN, () => {
      void showStatus($).catch(() => undefined)
      void (async () => {
        const range = rangeOf(await read($, paneRange), await $.clock.now())
        if (range) await freshen($, range.from)
        await refreshPane($)
      })().catch(() => undefined)
    })
    await showStatus($).catch(() => undefined)
    await refreshPane($).catch(() => undefined)
    return r
  })

  on('command.run', { command: 'time' }, async ($, e) => ({ text: await command($, e.args) }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const shown = await read($, view)
    const open = await read($, expanded)
    const rows = shown?.rows ?? []
    const most = Math.max(0, ...rows.map(r => r.ms))
    const width = Math.max(5, ...rows.map(r => r.label.length))
    const total = rows.reduce((sum, r) => ({ ms: sum.ms + r.ms, minutes: sum.minutes + r.minutes }), { ms: 0, minutes: 0 })
    const figures = (ms: number, minutes: number) =>
      [duration(ms).padStart(7), roundTo > 0 ? `billed ${duration(minutes * MIN)}` : '', amountOf(minutes)]
        .filter(Boolean)
        .join('   ')
    const pick = (word: string) => async () => {
      await update($, paneRange, () => word)
      const range = rangeOf(word, await $.clock.now())
      if (range) await freshen($, range.from)
      await refreshPane($)
    }
    const exportNow = async () => {
      const word = shown?.word ?? 'week'
      const range = rangeOf(word, await $.clock.now())
      if (range) $.ui.toast(await exportCsv($, range, word))
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexWrap="wrap" columnGap={1}>
          {TABS.map(([word, label]) => (
            <Button
              key={`range-${word}`}
              label={label}
              variant={shown?.word === word ? 'primary' : undefined}
              dimColor={shown?.word !== word}
              onPress={pick(word)}
            />
          ))}
        </Box>
        {rows.length === 0 && <Text dimColor>No time tracked {shown?.label ?? 'yet'}.</Text>}
        {rows.length > 0 && (
          <Box flexDirection="column">
            {rows.map(r => (
              <Box key={r.id} flexDirection="column">
                <Button
                  key={`project-${r.id}`}
                  plain
                  onPress={() => update($, expanded, was => (was === r.id ? null : r.id))}
                >
                  {open === r.id ? '▾' : '▸'} {r.label.padEnd(width)}{' '}
                  <Text color="claude">{bar(r.ms, most)}</Text> <Text tabular>{figures(r.ms, r.minutes)}</Text>
                </Button>
                {open === r.id &&
                  r.days.map(d => (
                    <Text key={`${r.id}-${d.day}`} dimColor wrap="wrap">
                      {'    '}
                      {dayLabel(d.day)} <Text tabular>{duration(d.ms).padStart(7)}</Text>{'   '}
                      {d.blocks.map(([a, b]) => `${timeOf(a)}–${timeOf(b)}`).join(', ')}
                    </Text>
                  ))}
              </Box>
            ))}
            {rows.length > 1 && (
              <Text bold>
                {'  '}
                {'Total'.padEnd(width)} {' '.repeat(BAR)} <Text tabular>{figures(total.ms, total.minutes)}</Text>
              </Text>
            )}
          </Box>
        )}
        <Box columnGap={1}>
          <Button key="export" label="Export CSV" onPress={exportNow} />
          <Text dimColor>{shown ? shown.label : ''}</Text>
        </Box>
      </Box>
    )
  })

  on('prompt.change', async ($, e, next) => {
    if (e.origin.kind !== 'plugin' && e.origin.kind !== 'clear') void beat($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.isMeta) void beat($, true)
    return next(e)
  })

  on('ui.press', async ($, e, next) => {
    void beat($)
    return next(e)
  })

  // Subagents run inside a main-loop turn, which already counts.
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      await beat($, true)
      isWorking = true
    }
    return next(e)
  })

  // A cloud container can go without warning: each finished turn's time is pushed as it ends.
  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      isWorking = false
      void beat($, true).then(() => (queue = queue.then(() => push($)).catch(() => undefined)))
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await (queue = queue.then(() => push($)).catch(() => undefined))
    return next(e)
  })
}
