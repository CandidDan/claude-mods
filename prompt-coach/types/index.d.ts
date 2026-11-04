/** What can be missing from a prompt, as the review tags it. */
export type Gap = 'goal' | 'context' | 'scope' | 'done' | 'constraints' | 'format' | 'conflict'

/** One prompt's rating: 1 (unworkable) to 5 (nothing to add), and what it lacks. */
export type Review = { score: number; issues: string[]; gaps: Gap[] }

/** The hint showing for the draft in the prompt box: the draft it is for, and what it asks. */
export type Hint = { text: string; issue: string }

declare module 'claude-code' {
  interface PluginState {
    'prompt-coach': { hint: Hint | null }
  }
}
