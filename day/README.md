# day

A live **Today** pane in Claude Code: what the next few hours look like and what to tackle next, replanned from the session's own context.

- `/today` — plan the default window (4h); `/today eod`, `/today 2h`, `/today off` (hides the pane and the band)
- The pane shows **Now** (one item, why, Start / Done), **Then** (one line each, with time and who: you or claude) and a one-line **Schedule**
- A band above the prompt shows the Now item with **Start** and **Done**, wherever the pane is
- **Done** moves the next item up; the next replan is told what's done and leaves it out
- Replans after every turn, and on a timer (45 min; configurable)
- Pulls today's events from any connected MCP calendar (`*calendar*__list_events`)
- Pane keys: **Start** (s, drops the item into the prompt), **Done** (d), **Refresh** (r), **Whole day / 4h** (t)
- Status line shows the Now item

The plan is a `$.model.fork` over the session transcript, so it knows what this session has read, decided and left half-done; the API serves the prefix from cache.

## Install

```
/plugin marketplace add CandidDan/claude-mods
/plugin install day@candiddan
```

Or for development: `claude --plugin-dir /path/to/day`.
