/** What the band above the prompt shows: a drafted rule to save, or where one was saved. */
export type Band = { kind: 'draft'; rule: string } | { kind: 'saved'; text: string }

declare module 'claude-code' {
  interface PluginState {
    reflect: { band: Band | null }
  }
}
