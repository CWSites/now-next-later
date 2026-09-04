#!/usr/bin/env bash
# Refresh Slack xoxc + xoxd tokens in secrets.local.json without DevTools.
#
# - xoxc: read from the live app.slack.com tab in Google Chrome via AppleScript
#         (localConfig_v2 in localStorage).
# - xoxd: decrypted directly from Chrome's Cookies SQLite DB using the
#         "Chrome Safe Storage" key in the macOS login Keychain (v10 scheme:
#         AES-128-CBC, PBKDF2-HMAC-SHA1, 1003 iters, salt="saltysalt",
#         IV=16 spaces). Requires an unlocked Keychain (may prompt once).
#
# Requirements: macOS, Google Chrome signed in to Slack, jq, python3 with
# pycryptodome (auto-installed to --user if missing).
#
# Usage: ./scripts/refresh-slack-tokens.sh
#
# Runs automatically before `npm run dev` (see "predev" in package.json).
# Set SKIP_SLACK_REFRESH=1 to bypass (e.g. offline, Chrome closed).
#
# Never commit secrets.local.json or its .bak.* siblings (see .gitignore).

set -euo pipefail

if [[ "${SKIP_SLACK_REFRESH:-0}" == "1" ]]; then
  echo "[slack-refresh] SKIP_SLACK_REFRESH=1, skipping."
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="${REPO_ROOT}/secrets.local.json"

if [[ ! -f "$SECRETS" ]]; then
  echo "error: $SECRETS not found" >&2
  exit 1
fi
command -v jq        >/dev/null || { echo "error: jq required"        >&2; exit 1; }
command -v osascript >/dev/null || { echo "error: osascript required" >&2; exit 1; }
command -v sqlite3   >/dev/null || { echo "error: sqlite3 required"   >&2; exit 1; }
command -v python3   >/dev/null || { echo "error: python3 required"   >&2; exit 1; }

if ! python3 -c "from Crypto.Cipher import AES" 2>/dev/null; then
  echo "installing pycryptodome (user site)…" >&2
  python3 -m pip install --user --quiet --break-system-packages pycryptodome >&2
fi

TMPDIR_="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_"' EXIT
COOKIES_SRC="${HOME}/Library/Application Support/Google/Chrome/Default/Cookies"
COOKIES_COPY="${TMPDIR_}/Cookies"

[[ -f "$COOKIES_SRC" ]] || { echo "error: Chrome Default profile cookies not found" >&2; exit 1; }
cp "$COOKIES_SRC" "$COOKIES_COPY"

# --- xoxc via AppleScript in Chrome -----------------------------------------
XOXC=$(osascript <<'AS'
tell application "Google Chrome"
  repeat with w in windows
    repeat with t in tabs of w
      if (URL of t) starts with "https://app.slack.com/" then
        return execute t javascript "Object.values(JSON.parse(localStorage.localConfig_v2).teams).find(x => x.token.startsWith('xoxc-')).token"
      end if
    end repeat
  end repeat
  return ""
end tell
AS
)
if [[ "$XOXC" != xoxc-* ]]; then
  echo "error: no signed-in app.slack.com tab found in Chrome. Open https://app.slack.com/client and sign in, then re-run." >&2
  exit 1
fi

# --- xoxd via Chrome cookie DB + Keychain -----------------------------------
CHROME_PW=$(security find-generic-password -w -s "Chrome Safe Storage" 2>/dev/null || true)
if [[ -z "$CHROME_PW" ]]; then
  echo "error: could not read 'Chrome Safe Storage' from Keychain" >&2
  exit 1
fi

XOXD=$(CHROME_PW="$CHROME_PW" COOKIES_DB="$COOKIES_COPY" python3 <<'PY'
import os, sqlite3, sys
from Crypto.Cipher import AES
from Crypto.Protocol.KDF import PBKDF2

key = PBKDF2(os.environ["CHROME_PW"].encode(), b"saltysalt", dkLen=16, count=1003)
con = sqlite3.connect(os.environ["COOKIES_DB"])
row = con.execute(
  "SELECT encrypted_value FROM cookies WHERE host_key LIKE '%slack.com' AND name='d' LIMIT 1"
).fetchone()
if not row:
  print("ERR:no_d_cookie", file=sys.stderr); sys.exit(1)
enc = row[0]
if enc[:3] != b"v10":
  print(f"ERR:unsupported_scheme:{enc[:3]!r}", file=sys.stderr); sys.exit(1)
pt = AES.new(key, AES.MODE_CBC, IV=b" " * 16).decrypt(enc[3:])
pt = pt[:-pt[-1]]  # strip PKCS#7 padding
# Chrome 117+ on macOS prepends a 32-byte SHA-256 of host_key for integrity.
if not pt.startswith(b"xoxd-") and pt[32:].startswith(b"xoxd-"):
  pt = pt[32:]
if not pt.startswith(b"xoxd-"):
  print("ERR:decrypt_bad_prefix", file=sys.stderr); sys.exit(1)
print(pt.decode())
PY
)
[[ "$XOXD" == xoxd-* ]] || { echo "error: xoxd decrypt failed" >&2; exit 1; }

# --- write secrets.local.json (with backup) ---------------------------------
BACKUP="${SECRETS}.bak.$(date +%s)"
cp "$SECRETS" "$BACKUP"

OUT="$(mktemp)"
jq --arg xoxc "$XOXC" --arg xoxd "$XOXD" \
  '.SLACK_MCP_XOXC_TOKEN=$xoxc | .SLACK_MCP_XOXD_TOKEN=$xoxd' \
  "$SECRETS" > "$OUT"
mv "$OUT" "$SECRETS"

echo "updated: $SECRETS"
echo "backup:  $BACKUP"
echo "  xoxc …${XOXC: -4}"
echo "  xoxd …${XOXD: -4}"
echo
echo "Restart the dev server so applySecretsToEnv() re-reads the file."
