export type Ttl = '5m' | '1h'

/** The main thread's last request, as its response reported it. */
export type CacheClock = {
  /** When the request went out, in `$.clock.now()` ms: the cache's timer restarts then. */
  lastAt: number
  /** Prompt tokens it sent: what the next request re-sends at full price once cold. */
  promptTokens: number
  /** The model that answered: a switch starts a cache of its own. */
  model: string
}

/** Keep warm while it runs: pings sent so far and the cap. */
export type KeepWarm = { pings: number; max: number }

declare module 'claude-code' {
  interface PluginState {
    'cache-clock': { clock: CacheClock | null; warm: KeepWarm | null; isHidden: boolean }
  }
}
