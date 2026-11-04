# mods

One **Mods** pane where your other mods put what they need from you. Made for cloud sessions, where there's no band above the prompt to show their lines.

- **Asks on top:** reflect's offer to save a rule and handoff's offer to hand off, each with its buttons.
- **What's next under them:** day's **Now** item with **Start** and **Done**, the one after it, and **Today ›** for the whole plan.
- **Status at the foot:** the cache clock with **Keep warm**, and today's time with **Timesheet ›**.
- **Opens by itself** where nothing draws the band (cloud sessions, a phone joining). In the terminal or the desktop app, run **`/mods`** to open it.

Each mod draws its own row, and only while it has something to show, so the pane stays short. This mod only opens the pane; the rows come from day, handoff, reflect, cache-clock and timesheet (each version that knows about the pane). With none of them installed, the pane says so.

## Install

```
/plugin marketplace add CandidDan/claude-mods
/plugin install mods@candiddan
```

Or for development: `claude --plugin-dir /path/to/mods`.
