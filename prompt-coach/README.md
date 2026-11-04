# prompt-coach

Quiet hints on your draft. When a prompt sitting in the box leaves something real to guess, one dim line above the box says what's worth adding. Nothing else: no score, no buttons, no questions, and Enter always sends what you typed.

```
Worth saying: Which page, home or pricing?
```

- **Only when it matters.** Once your draft has sat still for a moment and is 8 words or more, it gets one quick look. Most drafts get no line at all. A hint shows only when Claude would have to guess at something that changes the result, never for style, tone or length.
- **A question, not a grade.** The hint is the one thing to answer ("Which test file?"), so you can add it in a few words or ignore it.
- **Goes when you move on.** Edit the draft and the line goes until the next pause; send it and the line clears.
- **Left alone:** drafts under 8 words ("yes, do the next one"), slash commands, and the desktop app's own messages, such as another session's report.
- **Context:** the look sees Claude's last reply, read from the conversation even after a restart, so answers to Claude's own questions ("1 a, 2 as you recommend") don't get hints.
- **`/coach`** sums up your last 100 sent prompts: your average, and your most common gaps (no done criteria, vague scope, missing context…). **`/coach off`** stops the hints and **`/coach on`** brings them back.

**Where it shows.** The line draws in the band above the prompt box, which only the terminal and the desktop app show. Cloud sessions get no hints.

**Cost.** One small Haiku call per draft, each time you pause on new text of 8 words or more.

**From 0.6.** The ratings, Improve, the follow-up questions, the rewrite and the cloud question cards are gone, and `/coach before` and `/coach after` are now `/coach on`. A saved `off` stays off. **Hint below** in the mod's settings sets the bar (default 3: hints on drafts rated 1 or 2).

## Install

```
/plugin marketplace add CandidDan/claude-mods
/plugin install prompt-coach@candiddan
```

Or for development: `claude --plugin-dir /path/to/prompt-coach`.
