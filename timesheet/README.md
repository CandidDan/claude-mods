# timesheet

Tracks the time you spend working with Claude, per repo, for timesheets and billable hours.

- **Status line:** `⏱ acme-site · 1h 12m today`
- `/time` shows today and this week per project; `/time today | yesterday | week | lastweek | month | lastmonth | all` for one range
- `/time view` opens the timesheet in a pane beside the chat: tabs for today, this week, last week, this month and last month; one row per project with a bar, time, billed time and amount; click a project for its days and time blocks; **Export CSV** writes the range shown. `/time view month` opens it on a range
- `/time export [range]` writes a CSV timesheet (this month by default) to `~/Documents/Timesheets/`: one row per project per day with minutes, billed hours, amount the time blocks (`09:12-10:40; 14:00-14:35`) and a description a client can read, such as "Rebuilt checkout validation and fixed three payment edge cases"
- `/time pause` and `/time resume` stop and restart tracking in this session
- `/time name Acme Corp ~/Clients/Acme` names a folder and everything under it; leave the folder off to name the current repo. `/time names` lists them

**What counts.** Your activity is typing in the prompt, sending a message, and pressing buttons. Gaps between activity count while they're shorter than the idle limit (10 minutes by default), so time spent reading answers and thinking is included. A gap longer than that ends the block and isn't counted. While Claude is working on a turn, the time counts however long the turn runs. Subagents run inside a turn, so they add no extra time.

**Projects.** Each repo is one project, named after its folder. Worktrees count toward their main repo. Outside a git repo, the session's folder is the project. If two sessions are open on the same project at once, the overlapping time is counted once.

**Naming and grouping.** `/time name <name> [folder]` gives a folder a name, and every repo and folder under it counts toward that project, past time included. Use it to bill a whole client folder as one project, or to keep loose subfolders together. The most specific name wins, so a repo inside a named folder can still have its own name. Folders given the same name are one project. `/time name <folder>` with no name removes that folder's name. Unnamed folders that share a name are told apart by their parent, like `website (acme)` and `website (personal)`.

**Settings:** idle limit, rounding (for example `6` rounds each project's day up to tenths of an hour), hourly rate (shows amounts), export folder, and whether the export describes the work.

**Cloud sessions and other machines.** A cloud session runs in a container that is thrown away, so its time would be lost. Set `syncRepo` to a private GitHub repository (say `you/timesheet-data`) and every session pushes its own blocks to `sessions/<month>/<session id>.json` there, at most once a minute and as each turn ends. Reports, the pane and exports pull the other sessions' files back, at most every two minutes. A cloud session's work in a repo counts under the folder where this machine works in the same repo (matched by its GitHub remote), so your names apply to it. If two sessions overlap on one project, that time counts once. `/time sync` pushes and pulls now and shows any error.

The token: the `githubToken` option (kept in secure storage), else the `TIMESHEET_GITHUB_TOKEN` variable, else `gh auth token`. On your own machine `gh` is usually enough. For a cloud environment, which has no options dialog, set `TIMESHEET_SYNC_REPO` (e.g. `you/timesheet-data`) and `TIMESHEET_GITHUB_TOKEN` in the environment's variables, the token a fine-grained one that can only read and write the contents of the sync repository. `cloud/setup.sh` in this marketplace installs the mod there.

**Data:** one JSON file per session in `~/.claude/timesheet/`. Each session writes only its own file, so parallel sessions can't overwrite each other's time.

**Descriptions.** Each prompt you send is kept with its block as a one-line note (up to 160 characters; slash commands are skipped). An export sends each project's notes for the range, day by day, to Haiku in one call per project, and writes back one line per day. The notes stay in your files and in your sync repository, if you set one, and go to the model only when you export. Turn off "Describe the work" to leave the column empty.

## Install

```
/plugin marketplace add CandidDan/claude-mods
/plugin install timesheet@candiddan
```

Or for development: `claude --plugin-dir /path/to/timesheet`.
