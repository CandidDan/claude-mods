# handoff

Writes `HANDOFF.md` from the session transcript and the next session in that folder reads it on start. Sections follow Nate Herk's `/session-handoff`: what started · locked decisions · what shipped · key files · running state · verification · open questions · where to pick up.

- `/handoff` — write it now, and copy it to the clipboard (so `/clear` → paste works too) · `/handoff clear` — remove it once absorbed
- Written automatically at session end after ≥3 turns (not on `/clear`)
- Pickup: appended as a hidden context row, with one transcript line saying when it was written
- Config: file path, auto-on-end, minimum turns
