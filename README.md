# now-next-later

A local browser-based to-do app organized into three buckets:

- **Now** — today
- **Next** — this week
- **Later** — this month

Tasks live in a plain JSON file (`data/tasks.json`) that is auto-committed and pushed to this git repo, so your list stays in sync across every machine that has the repo checked out. Claude Desktop can read and write tasks via an included MCP server.

## Quick start

```bash
git clone git@github.com:CWSites/now-next-later.git
cd now-next-later
npm install
npm run dev
# open http://localhost:3000
```

## How sync works

- On page load and on first MCP call, the app runs `git pull --rebase --autostash`.
- After every change (add / edit / complete / reorder / delete), changes to `data/tasks.json` are debounced (2s) and committed + pushed with a descriptive message.
- If two machines edit simultaneously, `git pull --rebase` runs before every push. Conflicts on `data/tasks.json` are rare because each task is a self-contained JSON object; when they do happen, resolve manually and the app picks up the merged file on next load.
- Toggle off with `GIT_SYNC_ENABLED=0` in `.env.local` (useful on planes).

## Setting up on a new machine

1. `git clone` the repo.
2. `npm install`
3. Make sure `git push` works without a prompt (SSH key or credential helper).
4. `npm run dev`

That's it. Your tasks are already there.

## Claude Desktop integration (MCP)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "now-next-later": {
      "command": "npx",
      "args": ["tsx", "/path/to/now-next-later/mcp/server.ts"],
      "env": {
        "DATA_REPO_PATH": "/path/to/now-next-later"
      }
    }
  }
}
```

Restart Claude Desktop. Then you can say things like:

- "What's on my Now list?"
- "Add 'call the plumber' to Next."
- "Move the plumber task to Now."
- "Mark task X complete."

### Available MCP tools

| Tool | Description |
|------|-------------|
| `list_tasks` | List tasks; filter by `bucket` and `includeCompleted`. |
| `add_task` | Create a task (`title`, optional `bucket`, `notes`). |
| `complete_task` | Mark complete/incomplete. |
| `move_task` | Move to a different bucket. |
| `update_task` | Change title or notes. |
| `delete_task` | Delete permanently. |
| `reorder_bucket` | Replace the ordered id list for a bucket. |

Because the MCP server and the web UI share the same JSON file, changes made by Claude appear on next page refresh (and vice versa).

## Importing the morning brief

The [`morning-brief` skill](file://$HOME/Documents/Claude/Scheduled/morning-brief/SKILL.md) writes an HTML artifact to `~/Documents/Claude/Artifacts/morning-brief/index.html` each weekday. Import its Today / This Week / This Month checklists into Now / Next / Later:

```bash
npm run import:brief             # imports new items, skips already-imported ones
npm run import:brief -- --dry-run
npm run import:brief -- --path /some/other/index.html
```

Dedupe is per-title within tasks tagged `source: "morning-brief"`, so it's safe to re-run every morning. Existing tasks in your list keep their state (position, completion) even if the brief still mentions them.

## Keyboard shortcuts

- `n` — focus the "Now" new-task input

## Configuration (`.env.local`)

```
DATA_REPO_PATH=            # defaults to app repo root
GIT_SYNC_ENABLED=1         # set to 0 to disable sync
GIT_SYNC_DEBOUNCE_MS=2000  # debounce window before commit+push
```

## Roadmap

See open [issues](https://github.com/CWSites/now-next-later/issues). Next up: [#1 auto-rollover buckets by date](https://github.com/CWSites/now-next-later/issues/1).
