export type DayBlock = {
  /** "09:30" */
  start: string
  /** "11:00" */
  end: string
  label: string
  /** fixed = calendar/commitment, work = proposed focus block, break = rest */
  kind: 'fixed' | 'work' | 'break'
}

export type DayItem = {
  title: string
  /** one short clause: why now / what unblocks */
  why: string
  /** rough effort in minutes */
  minutes?: number
}

export type DayPlan = {
  /** one spoken line about the shape of the window */
  headline: string
  /** "13:56" when the plan was made */
  madeAt: string
  /** hours the plan covers */
  horizonHours: number
  blocks: DayBlock[]
  next: DayItem[]
  /** things waiting on Dan, outside the session's own work */
  waiting: DayItem[]
  /** sources the plan drew on, e.g. "session", "calendar" */
  sources: string[]
}

export type DayStatus = {
  phase: 'idle' | 'planning' | 'error'
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    day: { plan: DayPlan | null; status: DayStatus; horizonHours: number }
  }
}
