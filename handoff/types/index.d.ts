export type HandoffStatus = {
  /** ISO time of the last write this session, '' when none */
  wroteAt: string
  /** path written, '' when none */
  path: string
  /** last error, '' when none */
  error: string
}

/** The band's offer once the chat grows past `offerAt`: asked, being written, or written. */
export type HandoffOffer =
  | { kind: 'offer'; tokens: number }
  | { kind: 'writing'; tokens: number }
  | { kind: 'written'; tokens: number; copied: boolean }

declare module 'claude-code' {
  interface PluginState {
    handoff: { status: HandoffStatus; offer: HandoffOffer | null }
  }
}
