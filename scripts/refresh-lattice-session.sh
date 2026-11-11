#!/usr/bin/env bash
# Thin wrapper around scripts/refresh-lattice-session.py.
#
# The Python script pulls Lattice session cookies (HttpOnly: access_token,
# refresh_token, latticeInfo, viewerContext, plus the Cloudflare pair)
# straight out of Chrome's cookie DB using the macOS Keychain, then
# replays the same GraphQL query the bookmarklet runs. Output on stdout
# is the extracted action items as JSON — the Node route that invokes
# this script merges them via the same code path the bookmarklet POSTs.
#
# This wrapper exists to:
#   1. Honor SKIP_LATTICE_REFRESH=1 (offline / debugging shortcut)
#   2. Install pycryptodome on first run so fresh clones don't have to
#      fish for the right pip incantation
#   3. Keep the path stable so the API route doesn't have to care
#      whether we add other prep steps later
#
# Deps:
#   pycryptodome — AES-CBC decrypt of Chrome's v10 cookie scheme

set -euo pipefail

if [[ "${SKIP_LATTICE_REFRESH:-0}" == "1" ]]; then
  echo '{"ok":true,"skipped":true}'
  exit 0
fi

command -v python3 >/dev/null || { echo "error: python3 required" >&2; exit 1; }

if ! python3 -c "import Crypto.Cipher" 2>/dev/null; then
  echo "[lattice-refresh] installing pycryptodome (user site)…" >&2
  python3 -m pip install --user --quiet --break-system-packages pycryptodome >&2
fi

exec python3 "$(dirname "$0")/refresh-lattice-session.py" "$@"
