/** What can be missing from a prompt, as the review tags it. */
export type Gap = 'goal' | 'context' | 'scope' | 'done' | 'constraints' | 'format' | 'conflict'

/** One prompt's rating: 1 (unworkable) to 5 (nothing to add), and what it lacks. */
export type Review = { score: number; issues: string[]; gaps: Gap[]; questions: { q: string; options: string[] }[] }

/** The last rating, shown above the prompt in `after` mode. */
export type Last = { score: number; issue: string }

declare module 'claude-code' {
  interface PluginState {
    'prompt-coach': { last: Last | null }
  }
}
