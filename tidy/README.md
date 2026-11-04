# tidy

Finds the sessions you're done with that are still sitting in the desktop app's sidebar, and helps you archive them.

- `/tidy` opens a **Tidy** pane beside the chat that lists each finished session with how long it has been idle and its PR, oldest first
- **Archive** on a row archives that session; **Archive all** archives every one listed; **Refresh** looks again
- While the pane has been opened, the list refreshes every 15 minutes

**What counts as finished.** A session that isn't running, isn't pinned, has had no activity for 24 hours (the `idleHours` setting), and whose pull request has merged or closed, or that never had one. A session with an open PR is never listed. The session you run `/tidy` from is never listed either.

**Archiving.** Each archive goes through the desktop app, which asks you to approve it unless the session runs in auto or bypass permissions mode. A session you decline stays in the list and the pane says why. The app archives a session the same way the sidebar does: it stops the session's process and cleans up its worktree, and you can reopen it from the Archived list. A session open on screen, or one with work still running, may be refused. The pane shows the app's reason.

**Where it works.** Only in the Claude desktop app, which is what lists your sessions. In the terminal or a cloud session, `/tidy` says there's nothing it can see. That's also why `cloud/setup.sh` doesn't install it.

**What it can't see.** The app doesn't report whether a session is waiting on an answer from you, so a session idle for a day with a question still open is listed too. Check the title before you archive.

**Settings:** idle hours (default 24).

## Install

```
/plugin marketplace add CandidDan/claude-mods
/plugin install tidy@candiddan
```

Or for development: `claude --plugin-dir /path/to/tidy`.
