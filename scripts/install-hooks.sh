#!/usr/bin/env bash
# One-time setup for repo-local git hooks + personal PII pattern list.
#
#   ./scripts/install-hooks.sh
#
# Idempotent — safe to re-run.
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
GIT_DIR=$(git rev-parse --git-dir)

cd "$REPO_ROOT"

# 1. Point git at the tracked hooks directory.
current=$(git config --local --get core.hooksPath 2>/dev/null || echo "")
if [[ "$current" != ".githooks" ]]; then
  git config --local core.hooksPath .githooks
  echo "✓ set core.hooksPath = .githooks"
else
  echo "✓ core.hooksPath already .githooks"
fi

# 2. Make sure the pre-commit script is executable.
chmod +x .githooks/pre-commit
echo "✓ .githooks/pre-commit is executable"

# 3. Seed the local (never-committed) personal-term list from the template.
local_file="$GIT_DIR/pii-patterns.local"
if [[ ! -e "$local_file" ]]; then
  cp .githooks/pii-patterns.example "$local_file"
  echo "✓ created $local_file (edit this to add personal terms — it is NOT tracked by git)"
else
  echo "✓ $local_file already exists — leaving it untouched"
fi

cat <<EOF

Setup complete.

Next steps:
  1. Edit $local_file — add regex patterns for names, emails, or codenames
     you want blocked from commits. Read the header comment for format.
  2. Test the hook end-to-end:
       # Any real-looking Atlassian token (starts with ATATT + 10+ token bytes)
       # will do — pull one from a rotated/expired credential you trust.
       echo 'const t = "<PASTE_A_REAL_LOOKING_TOKEN_HERE>";' > /tmp/leak.ts
       git add /tmp/leak.ts   # (or a real file)
       git commit -m "test"   # should be blocked
  3. Bypass in emergencies with:  git commit --no-verify   (leaves no audit trail)
EOF
