# mods

Claude Code mods (function-hook plugins).

| mod | what |
|---|---|
| [day](day/) | Live **Today** pane — next hours and what to tackle next, replanned from the session |
| [handoff](handoff/) | `HANDOFF.md` written at session end or when a long chat offers it, picked up by the next session or after `/clear` |
| [prompt-coach](prompt-coach/) | Rates your draft as you type, says what's missing, offers to improve it |
| [cache-clock](cache-clock/) | Countdown above the prompt until the prompt cache goes cold; opt-in **Keep warm** |
| [reflect](reflect/) | Offers to save your corrections as one-line rules in `CLAUDE.md` |
| [timesheet](timesheet/) | Your time with Claude per project or repo, for billing: `/time`, a pane, CSV export; cloud sessions sync through a private repo |
| [design-standards](design-standards/) | Design Standards v2.1 as skills (core + audit); not a mod, skills only |

## Cowork

Mods don't load in Cowork. `skills/` holds the same as plain skills (`/day`, `/handoff`, `design-standards`, `design-standards-audit`):

```
git clone https://github.com/CandidDan/claude-mods ~/Projects/mods
ln -s ~/Projects/mods/skills/day ~/.claude/skills/day
ln -s ~/Projects/mods/skills/handoff ~/.claude/skills/handoff
ln -s ~/Projects/mods/skills/design-standards ~/.claude/skills/design-standards
ln -s ~/Projects/mods/skills/design-standards-audit ~/.claude/skills/design-standards-audit
```

## Install (Claude Code)

```
/plugin marketplace add CandidDan/claude-mods
/plugin install day@candiddan
/plugin install handoff@candiddan
/plugin install prompt-coach@candiddan
/plugin install cache-clock@candiddan
/plugin install reflect@candiddan
/plugin install timesheet@candiddan
/plugin install design-standards@candiddan
```

## Codex

See [design-standards/README.md](design-standards/README.md#codex).
