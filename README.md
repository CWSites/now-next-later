# now-next-later

A local browser-based to-do app organized into three buckets:

- **Now** — today
- **Next** — this week
- **Later** — this month

Tasks live in a plain local JSON file (`data/tasks.json`) that is **not** checked into this repo — your task list stays on your machine. Claude Desktop can read and write tasks via an included MCP server.

## Quick start

```bash
git clone <your-fork-or-this-repo>
cd now-next-later
npm install
npm run dev
# open http://localhost:3000
```

On first run the app creates `data/tasks.json` from an empty template. It is gitignored, so nothing about your task list ever ends up in a commit.

## Secrets & PII pre-commit hook (recommended)

This repo ships with a pre-commit hook that scans staged files for API tokens, PEM keys, and configurable personal terms before allowing a commit. To turn it on:

```bash
./scripts/install-hooks.sh
```

That sets `core.hooksPath` to `.githooks/` and seeds a **local, never-committed** pattern file at `.git/pii-patterns.local`. Edit that file to add regex patterns for your name, email, employer, coworker names, internal codenames — anything you want the hook to block.

Example block:

```
$ git commit -m "docs: fix typo"
✗ Atlassian API token in notes.md
    12:const t = "ATATT<snip real-token-shaped bytes here>";
✗ Personal term (\bmyname\b) in notes.md
    3:# Draft by MyName

Commit blocked — staged files look like they contain secrets or personal information.
```

Bypass sparingly with `git commit --no-verify` or `SKIP_PII_CHECK=1 git commit …`. A GitHub Actions workflow (`.github/workflows/secrets-scan.yml`) runs [gitleaks](https://github.com/gitleaks/gitleaks) on every push and PR as a second line of defense in case the local hook is bypassed.

## Optional: sync your task list across machines via a private repo

Sync is **off by default**. Fresh clones and forks will never auto-commit or push anywhere.

To turn it on, point `DATA_REPO_PATH` at a **separate private git repo you own** (not this repo, not a fork of this repo) and explicitly enable sync in `.env.local`:

```
DATA_REPO_PATH=/absolute/path/to/your/private/tasks-repo
GIT_SYNC_ENABLED=1
GIT_SYNC_DEBOUNCE_MS=2000
```

With those set, the app will `git pull --rebase --autostash` on load and auto-commit + push changes to `data/tasks.json` (debounced 2s) in the target repo. Unset either variable — or leave `GIT_SYNC_ENABLED` at its default — to keep everything local.

There is also a CI check (`.github/workflows/no-sync-artifacts.yml`) that rejects any PR touching `data/tasks.json`, so an accidentally-configured fork can't open a PR containing personal task data against upstream.

## Claude Desktop integration (MCP)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (replace `/absolute/path/to/now-next-later` with your checkout path):

```json
{
  "mcpServers": {
    "now-next-later": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/now-next-later/mcp/server.ts"],
      "env": {
        "DATA_REPO_PATH": "/absolute/path/to/now-next-later"
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

## Optional: ingest adapters

The repo includes pluggable ingest adapters under `ingest/adapters/` (Fellow, Google Calendar, Granola, Jira, Slack) that can pull action items from external sources into your buckets:

```bash
npm run ingest
```

Each adapter reads credentials from `secrets.local.json` (gitignored) — see `ingest/adapters/*.ts` for the shape it expects. To run daily on macOS, copy `launchd/now-next-later.ingest.plist.example` to `~/Library/LaunchAgents/`, edit the placeholders inside, and `launchctl load` it. If you don't configure any adapter credentials, `npm run ingest` is a no-op.

## Keyboard shortcuts

- `n` — focus the "Now" new-task input

## Configuration (`.env.local`)

```
DATA_REPO_PATH=            # unset = local-only (default); set to a private repo path to sync
GIT_SYNC_ENABLED=0         # 1 to enable sync (also requires DATA_REPO_PATH); default off
GIT_SYNC_DEBOUNCE_MS=2000  # debounce window before commit+push
```
