# design-standards

Dan's Design Standards v2.1 as two skills. Source of truth (edit there, then re-sync here): https://claude.ai/code/artifact/00f213aa-f5f1-4582-a654-770b4589b242

| skill | loads when | size |
|---|---|---|
| `design-standards` | any design task | ~1.3k tokens |
| `design-standards-audit` | checks, critiques, accessibility runs, V-7 reports | ~2.8k tokens |

## Codex

```
ln -s ~/Projects/claude-mods/design-standards/skills/design-standards ~/.codex/skills/design-standards
ln -s ~/Projects/claude-mods/design-standards/skills/design-standards-audit ~/.codex/skills/design-standards-audit
```

Fallback, in a repo's `AGENTS.md`:

```
## Design work
All design work follows Design Standards v2.1. Load skill `design-standards` first; load `design-standards-audit` for minor/major checks and any critique. Hand off with the V-7 report: rule ID · pass/fail/n.a./needs Dan · evidence.
```
