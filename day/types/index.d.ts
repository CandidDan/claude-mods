export type DayBlock = {
  /** "09:30" */
  start: string
  /** "11:00" */
  end: string
  /** at most 4 words */
  label: string
  /** fixed = calendar/commitment, work = proposed focus block, break = rest */
  kind: 'fixed' | 'work' | 'break'
}

export type DayItem = {
  /** verb first, at most 8 words: "Merge CandidDan/flow#245" */
  title: string
  /** at most 10 words: why now / what it unblocks */
  why: string
  /** rough effort in minutes */
  minutes?: number
  /** who has to do it: you (a decision, a merge, a call) or claude (a session can) */
  who?: 'you' | 'claude'
}

export type DayPlan = {
  /** one spoken line about the shape of the window */
  headline: string
  /** "13:56" when the plan was made */
  madeAt: string
  /** hours the plan covers */
  horizonHours: number
  blocks: DayBlock[]
  /** ranked; the first one not done is "now" */
  next: DayItem[]
  /** sources the plan drew on, e.g. "session", "calendar" */
  sources: string[]
}

export type DayStatus = {
  phase: 'idle' | 'planning' | 'error'
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    day: {
      plan: Shaped<DayPlan | null>
      /** titles of plan items marked done since the plan was made */
      done: string[]
      status: DayStatus
      horizonHours: number
      /** /today off hides the pane and the band above the prompt */
      isHidden: boolean
    }
  }
}
