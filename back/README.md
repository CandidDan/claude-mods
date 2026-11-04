# back

Gets you back to the message you sent, when Claude's reply runs long and you've scrolled past the top of it.

- **↑ Back to your message** shows under any reply block of 30 rows or more and scrolls the message it answers to the top of the window, so you can read the reply from the start. Short replies don't get one. It shows wherever the conversation does, cloud sessions and phones included.
- **`/back`** goes to the last message you sent; **`/back 2`** to the one before, and so on.
- **Yours only:** slash commands, background-task notices and the desktop app's own messages (another session's report, a reminder) are skipped.
- **Long reply** in the mod's settings sets how many rows a reply needs before it gets the button (default 30).

The mod reads the conversation as it's drawn and changes nothing in it. If the app won't scroll (it only scrolls in answer to your click or command), the mod says so in a toast or under `/back`.

## Install

```
/plugin marketplace add CandidDan/claude-mods
/plugin install back@candiddan
```

Or for development: `claude --plugin-dir /path/to/back`.
