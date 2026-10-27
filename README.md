# claude-mods

Claude Code mods (function-hook plugins).

| mod | what |
|---|---|
| [day](day/) | Live **Today** pane — next hours and what to tackle next, replanned from the session |
| [handoff](handoff/) | `HANDOFF.md` written at session end, picked up by the next session |
| [design-standards](design-standards/) | Design Standards v2.1 as skills (core + audit); not a mod, skills only |

## Cowork

Mods don't load in Cowork. `skills/` holds the same as plain skills (`/day`, `/handoff`, `design-standards`, `design-standards-audit`):

```
git clone https://github.com/CandidDan/claude-mods ~/Projects/claude-mods
ln -s ~/Projects/claude-mods/skills/day ~/.claude/skills/day
ln -s ~/Projects/claude-mods/skills/handoff ~/.claude/skills/handoff
ln -s ~/Projects/claude-mods/skills/design-standards ~/.claude/skills/design-standards
ln -s ~/Projects/claude-mods/skills/design-standards-audit ~/.claude/skills/design-standards-audit
```

## Install (Claude Code)

```
/plugin marketplace add CandidDan/claude-mods
/plugin install day@candiddan
/plugin install handoff@candiddan
/plugin install design-standards@candiddan
```

## Codex

See [design-standards/README.md](design-standards/README.md#codex).
