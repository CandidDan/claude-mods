/** What can be missing from a prompt, as the review tags it. */
export type Gap = 'goal' | 'context' | 'scope' | 'done' | 'constraints' | 'format' | 'conflict'

/** One prompt's rating: 1 (unworkable) to 5 (nothing to add), and what it lacks. */
export type Review = { score: number; issues: string[]; gaps: Gap[]; questions: { q: string; options: string[] }[] }

/** One follow-up question's answer; null when skipped. */
export type Answer = { q: string; a: string | null }

/** A weak prompt held back, as the band walks it: the offer, each question, then the rewrite. */
export type Offer = {
  text: string
  score: number
  issues: string[]
  isDump: boolean
  questions: Review['questions']
  phase: 'offer' | 'asking' | 'improving'
  /** The question showing while asking. */
  step: number
  answers: Answer[]
}

/** The last rating, shown above the prompt in `after` mode. */
export type Last = { score: number; issue: string }

declare module 'claude-code' {
  interface PluginState {
    'prompt-coach': { last: Last | null; offer: Offer | null }
  }
}
