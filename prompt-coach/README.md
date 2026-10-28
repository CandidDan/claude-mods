# prompt-coach

Rates each prompt before it is sent and tells you when it's weak and why, then offers to fix it, all in the band above the prompt box.

```
Prompt 2/5 · which page: home or pricing; what "off" means
[Improve it] [Send as is]
```

- **A weak prompt isn't sent.** It goes back into the prompt box as you wrote it, and the band above it shows the rating and what's missing.
- **Improve it** asks up to three quick questions in the band, one at a time: a button for each likely answer, a field to type your own, and **Skip**. It then rewrites the prompt in your voice and puts it in the prompt box for you to check and send.
- **Send as is** clears the band. Your prompt is still in the box, and pressing Enter sends it unchanged, with no second check.
- **Brain dumps:** a weak prompt of 120 words or more shows as `Brain dump 2/5` with **Shape it into a brief**, which writes the four-part brief: the job, the why, the guardrails, done means. A long prompt that rates well goes straight through.
- **Left alone:** short replies under 8 words ("yes, do the next one"), slash commands, and anything you didn't type yourself, including the desktop app's own messages such as another session's report. If the review fails or takes longer than 8 seconds, the prompt goes as typed.
- **Context:** the review sees Claude's last reply, and is told when you attached an image it can't see, so a prompt that leans on either isn't marked down for it.
- **`/coach`** sums up your last 100 ratings: your average, and your most common gaps (no done criteria, vague scope, missing context…).
- **`/coach after`** sends at once and shows the last rating in the band instead, for learning without the wait. `/coach before` switches back, and `/coach off` stops it.

**Cost and speed.** Each prompt of 8 words or more gets one small Haiku review before it's sent, usually about a second. Only **Improve it** makes the bigger Sonnet call to rewrite.

**Sharing the band.** The coach draws its line and leaves room for any other mod's beneath it (day's Now item, cache-clock, reflect, handoff), so none of them hides another. The bar for offering a fix is set by **Offer below** in the mod's settings (default 3: it offers on 1 and 2 out of 5).

## Install

```
/plugin marketplace add CandidDan/claude-mods
/plugin install prompt-coach@candiddan
```

Or for development: `claude --plugin-dir /path/to/prompt-coach`.
