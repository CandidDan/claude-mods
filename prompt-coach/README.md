# prompt-coach

Rates each prompt before it is sent and tells you when it's weak and why, then offers to fix it with a question or two.

`Claude rates this prompt 2/5: which page: home or pricing; what "off" means. Improve it first?  [Improve it] [Send as is]`

- **Improve it** asks up to three quick questions about what only you can decide, rewrites the prompt in your voice, and puts it in the prompt box for you to check and send. The original isn't sent.
- **Send as is** sends it unchanged.
- **Brain dumps:** a weak prompt of 120 words or more is offered a four-part brief instead: the job, the why, the guardrails, done means. A long prompt that rates well goes straight through.
- **Left alone:** short replies under 8 words ("yes, do the next one"), slash commands, and anything you didn't type yourself, including the desktop app's own messages such as another session's report. If the review fails or takes longer than 8 seconds, the prompt goes as typed.
- **Context:** the review sees Claude's last reply, and is told when you attached an image it can't see, so a prompt that leans on either isn't marked down for it.
- **`/coach`** sums up your last 100 ratings: your average, and your most common gaps (no done criteria, vague scope, missing context…).
- **`/coach after`** sends at once and shows the rating above the prompt instead, for learning without the wait. `/coach before` switches back, and `/coach off` stops it.

**Cost and speed.** Each prompt of 8 words or more gets one small Haiku review before it's sent, usually about a second. Only **Improve it** makes the bigger Sonnet call to rewrite. The bar for offering a fix is set by **Offer below** in the mod's settings (default 3: it offers on 1 and 2 out of 5).

## Install

```
/plugin marketplace add CandidDan/claude-mods
/plugin install prompt-coach@candiddan
```

Or for development: `claude --plugin-dir /path/to/prompt-coach`.
