/** What one prompt asked for, cut short, and when: the stuff of an export's descriptions. */
export type Note = { at: number; text: string }

/** One block of continuous activity in one repo, in `$.clock.now()` ms; `remote` is its origin as `owner/name`. */
export type Segment = { root: string; start: number; end: number; remote?: string; notes?: Note[] }

/** One session's file: its blocks in order. Each session writes only its own. */
export type SessionLog = { sessionId: string; segments: Segment[] }

/** One project's day in the pane: its time and blocks, local midnight first. */
export type PaneDay = { day: number; ms: number; blocks: [number, number][] }

/** One project in a range: its label, time, billed minutes and days. */
export type PaneRow = { id: string; label: string; ms: number; minutes: number; days: PaneDay[] }

/** What the pane shows, worked out between draws: a draw only reads it. */
export type PaneView = { word: string; label: string; rows: PaneRow[] }

declare module 'claude-code' {
  interface PluginState {
    timesheet: {
      isPaused: boolean
      range: string
      expanded: string | null
      view: Shaped<PaneView | null>
    }
  }
}
