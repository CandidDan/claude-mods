# prompt-coach

Rates your draft while it sits in the prompt box and tells you when it's weak and why, then offers to fix it, all in the band above the prompt box. It never holds a prompt back: Enter always sends what you typed, attachments and all.

```
Draft 2/5 · which page: home or pricing; what "off" means  [Improve it]
```

- **Rated as you type.** Once your draft has sat still for a moment and is 8 words or more, it gets one quick review. A weak one shows its rating and what's missing above the box. Change the draft and the rating goes until the next pause.
- **Improve it** asks up to three quick questions in the band, one at a time: a button for each likely answer, a field to type your own, and **Skip**. It then rewrites the prompt in your voice and puts it in the prompt box for you to check and send.
- **Ignore it** by just pressing Enter: the prompt goes as you typed it, and the band clears.
- **Brain dumps:** a weak draft of 120 words or more shows as `Brain dump 2/5` with **Shape it into a brief**, which writes the four-part brief: the job, the why, the guardrails, done means.
- **Left alone:** drafts under 8 words ("yes, do the next one"), slash commands, and the desktop app's own messages, such as another session's report.
- **Context:** the review sees Claude's last reply, read from the conversation even after a restart, so answers to Claude's own questions ("1 a, 2 as you recommend") rate well. A prompt that points at a screenshot isn't marked down for it.
- **`/coach`** sums up your last 100 ratings: your average, and your most common gaps (no done criteria, vague scope, missing context…).
- **`/coach after`** stops rating drafts and rates each prompt once it's sent, showing the last rating in the band instead. `/coach before` switches back, and `/coach off` stops it.

**Cost and speed.** One small Haiku review per draft, each time you pause on new text of 8 words or more. Only **Improve it** makes the bigger Sonnet call to rewrite.

**Sharing the band.** The coach draws its line and leaves room for any other mod's beneath it (day's Now item, cache-clock, reflect, handoff), so none of them hides another. Each line keeps to one row, cut off with an ellipsis when the band is narrow. The bar for showing a rating is set by **Offer below** in the mod's settings (default 3: it shows 1 and 2 out of 5).

## Install

```
/plugin marketplace add CandidDan/claude-mods
/plugin install prompt-coach@candiddan
```

Or for development: `claude --plugin-dir /path/to/prompt-coach`.
