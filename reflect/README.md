# reflect

When you correct Claude in a way that should stick, a line above the prompt offers to save it as a one-line rule:

`Save as a rule? Write British English spelling in all copy.  [This project] [Everywhere] [Skip]`

- **This project** adds the rule to `CLAUDE.md` in the session's folder; **Everywhere** adds it to `~/.claude/CLAUDE.md`
- Rules go under a `## Rules from corrections` heading, which is added if missing; a rule already there is not added twice
- The file is read back after writing, and the mod says so if it doesn't match
- `/reflect off` and `/reflect on` switch it in every chat

**What it costs.** Only short prompts that read like a correction ("no", "don't", "instead", "always", "I said", …) are checked at all. Those get one small Haiku call to tell a lasting rule from a one-off fix, and a lasting rule gets one more to draft the line. The check runs beside the turn and never delays it.

## Install

```
/plugin marketplace add CandidDan/claude-mods
/plugin install reflect@candiddan
```

Or for development: `claude --plugin-dir /path/to/reflect`.
