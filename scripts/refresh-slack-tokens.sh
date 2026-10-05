#!/usr/bin/env bash
# Thin wrapper around scripts/refresh-slack-tokens.py.
#
# The heavy lifting (browser discovery, token extraction, Slack
# auth.test, secrets.local.json rewrite) is in the Python script. This
# wrapper only exists to:
#   1. Honor SKIP_SLACK_REFRESH=1 (dev shortcut when offline / debugging)
#   2. Install the two Python deps on first run so new clones don't have
#      to fish for the right pip incantation
#   3. Keep the same path on disk so predev + the auto-refresh API route
#      (app/api/settings/slack/auto-refresh) keep working unchanged
#
# Deps:
#   pycryptodome — AES-CBC decrypt of Chrome's `d` cookie (v10 scheme)
#   cramjam      — snappy decompress of Firefox's localConfig_v2 blob
#
# Both ship pre-built wheels for macOS arm64 + x86_64, so install is
# fast and needs no system packages (unlike python-snappy / plyvel).

set -euo pipefail

if [[ "${SKIP_SLACK_REFRESH:-0}" == "1" ]]; then
  echo "[slack-refresh] SKIP_SLACK_REFRESH=1, skipping."
  exit 0
fi

command -v python3 >/dev/null || { echo "error: python3 required" >&2; exit 1; }

if ! python3 -c "import Crypto.Cipher, cramjam" 2>/dev/null; then
  echo "[slack-refresh] installing pycryptodome + cramjam (user site)…" >&2
  python3 -m pip install --user --quiet --break-system-packages \
    pycryptodome cramjam >&2
fi

exec python3 "$(dirname "$0")/refresh-slack-tokens.py" "$@"
