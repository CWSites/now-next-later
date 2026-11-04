#!/usr/bin/env bash
# Thin wrapper around scripts/refresh-greenhouse-session.py.
#
# Mirrors scripts/refresh-slack-tokens.sh:
#   1. Honor SKIP_GREENHOUSE_REFRESH=1 for offline dev
#   2. Ensure pycryptodome is available (Chrome cookie decrypt)
#   3. Keep a stable on-disk path so the auto-refresh API route can exec it

set -euo pipefail

if [[ "${SKIP_GREENHOUSE_REFRESH:-0}" == "1" ]]; then
  echo "[greenhouse-refresh] SKIP_GREENHOUSE_REFRESH=1, skipping."
  exit 0
fi

command -v python3 >/dev/null || { echo "error: python3 required" >&2; exit 1; }

if ! python3 -c "import Crypto.Cipher" 2>/dev/null; then
  echo "[greenhouse-refresh] installing pycryptodome (user site)…" >&2
  python3 -m pip install --user --quiet --break-system-packages \
    pycryptodome >&2
fi

exec python3 "$(dirname "$0")/refresh-greenhouse-session.py" "$@"
