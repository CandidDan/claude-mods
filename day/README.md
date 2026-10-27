# day

A live **Today** pane in Claude Code: what the next few hours look like and what to tackle next, replanned from the session's own context.

- `/today` — plan the default window (4h); `/today eod`, `/today 2h`, `/today off`
- Replans after every turn, and on a timer (45 min; configurable)
- Pulls today's events from any connected MCP calendar (`*calendar*__list_events`)
- Pane buttons: **Refresh** (r), **Whole day / 4h** (t), **Start #1** (s, drops the top item into the prompt)
- Status line shows the top item

The plan is a `$.model.fork` over the session transcript, so it knows what this session has read, decided and left half-done; the API serves the prefix from cache.

## Install

```
/plugin marketplace add CandidDan/claude-mods
/plugin install day@candiddan
```

Or for development: `claude --plugin-dir /path/to/day`.
