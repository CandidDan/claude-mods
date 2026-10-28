# cache-clock

A line above the prompt counting down until this chat's prompt cache goes cold, so you know when a pause will make the next message re-send the whole context at full price.

- **Warm:** `Cache warm · 4m left of 5m` with a **Keep warm** button
- **Cold:** `Cache cold · next message re-sends 182k tokens at full price` (shown only for chats over 20k tokens)
- Hidden while Claude is working, since every request restarts the timer
- `/cache` says where the cache stands; `/cache warm` turns Keep warm on or off; `/cache off` and `/cache on` hide and show the line

**Cache length.** The mod learns whether the cache lasts 5 minutes or an hour from the chat's own replies: a reply more than 5 minutes after the last one either read the cache (1 hour) or wrote it afresh (5 minutes). Until then it assumes 5 minutes and marks it with `?`. What it learns is kept across chats. To set it yourself, change **Cache length** to `5m` or `1h` in the mod's settings.

**Keep warm** is off until you press it. It sends a tiny background request about 45 seconds before the cache would go cold, which re-reads the cached context at about a tenth of the normal price. It stops after 6 pings (configurable), when the cache has already gone cold, or when you send a message.

Subagents' requests are left out: they keep caches of their own.

## Install

```
/plugin marketplace add CandidDan/claude-mods
/plugin install cache-clock@candiddan
```

Or for development: `claude --plugin-dir /path/to/cache-clock`.
