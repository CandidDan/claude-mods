/** One finished session as the pane lists it; `lastActivityAt` in ms since the epoch. */
export type Idle = { id: string; title: string; lastActivityAt: number; pr: number | null; prState: string | null }

/** What the pane shows, worked out between draws: the sessions, when they were listed, and why not if they could not be. */
export type TidyView = { rows: Idle[]; checkedAt: number; error: string | null }

declare module 'claude-code' {
  interface PluginState {
    tidy: {
      view: Shaped<TidyView | null>
    }
  }
}
