export type HandoffStatus = {
  /** ISO time of the last write this session, '' when none */
  wroteAt: string
  /** path written, '' when none */
  path: string
  /** last error, '' when none */
  error: string
}

declare module 'claude-code' {
  interface PluginState {
    handoff: { status: HandoffStatus }
  }
}
