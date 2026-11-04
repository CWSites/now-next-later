#!/usr/bin/env python3
"""
Refresh Greenhouse session cookie + CSRF token in secrets.local.json from
the open Chrome tab, for users who don't have Harvest API access.

Approach:
  1. AppleScript into whichever Chrome tab is on *.greenhouse.io. Read the
     subdomain (so multi-tenant hosts like app7.greenhouse.io are preserved)
     and the <meta name="csrf-token"> content attribute.
  2. Decrypt all cookies for *.greenhouse.io from Chrome's cookie DB using
     the macOS Keychain's "Chrome Safe Storage" entry (same v10/v11 scheme
     Slack's refresh script uses).
  3. Verify the session is live by hitting the host root and checking that
     we don't get redirected to /users/sign_in.
  4. Write GREENHOUSE_HOST, GREENHOUSE_SESSION_COOKIE, GREENHOUSE_CSRF_TOKEN
     to secrets.local.json with a timestamped backup.

Exits:
  0  success
  1  no Greenhouse tab open in Chrome (sign in once, keep tab open)
  2  cookies readable but server rejected them (session expired)
  3  dependency missing
  4  internal error

Dependency: pycryptodome (Chrome cookie AES-CBC decrypt). Installed by the
.sh wrapper if missing.
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional


HOME = Path.home()
REPO_ROOT = Path(__file__).resolve().parent.parent
SECRETS_FILE = REPO_ROOT / "secrets.local.json"


def log(msg: str) -> None:
    print(f"[greenhouse-refresh] {msg}", file=sys.stderr)


# --------------------------------------------------------- Chrome tab scrape


def scrape_open_tab() -> Optional[tuple[str, str]]:
    """Return (host, csrf_token) from the first open *.greenhouse.io tab.

    We prefer a tab on an `app*.greenhouse.io` host because that's the
    recruiter-facing UI where the session cookie is minted. The careers-side
    `boards.greenhouse.io` has no recruiter session.
    """
    script = r"""
tell application "Google Chrome"
  repeat with w in windows
    repeat with t in tabs of w
      set u to URL of t
      if u contains ".greenhouse.io/" then
        set theHost to do shell script "python3 -c 'import sys,urllib.parse as p; print(p.urlparse(sys.argv[1]).hostname or \"\")' " & quoted form of u
        set csrf to execute t javascript "(document.querySelector('meta[name=\"csrf-token\"]')||{}).content||''"
        return theHost & "||" & csrf
      end if
    end repeat
  end repeat
  return ""
end tell
"""
    try:
        out = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except FileNotFoundError:
        log("osascript not found \u2014 this script is macOS-only")
        return None
    raw = (out.stdout or "").strip()
    if not raw or "||" not in raw:
        err = (out.stderr or "").strip()
        if err:
            log(f"AppleScript error: {err}")
        return None
    host, csrf = raw.split("||", 1)
    host = host.strip()
    csrf = csrf.strip()
    if not host.endswith(".greenhouse.io"):
        log(f"unexpected host from Chrome tab: {host!r}")
        return None
    if not csrf:
        log(
            "found a Greenhouse tab but no <meta name=csrf-token>. "
            "Make sure the open tab is the recruiter app (app*.greenhouse.io), "
            "not boards.greenhouse.io, and that you're signed in. "
            "You may also need Chrome \u2192 View \u2192 Developer \u2192 "
            "'Allow JavaScript from Apple Events'."
        )
        return None
    return host, csrf


# ------------------------------------------------------------ Chrome cookies


def _keychain_password() -> Optional[str]:
    try:
        pw = subprocess.run(
            ["security", "find-generic-password", "-w", "-s", "Chrome Safe Storage"],
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout.strip()
    except Exception as e:
        log(f"Keychain read failed: {e}")
        return None
    return pw or None


def _decrypt_v10(enc: bytes, key: bytes) -> Optional[bytes]:
    try:
        from Crypto.Cipher import AES  # type: ignore
    except ImportError:
        log("pycryptodome missing \u2014 install with pip3 install --user pycryptodome")
        return None
    try:
        pt = AES.new(key, AES.MODE_CBC, IV=b" " * 16).decrypt(enc)
        pt = pt[: -pt[-1]]  # PKCS#7
    except Exception as e:
        log(f"AES decrypt failed: {e}")
        return None
    # Chrome 117+ prepends a 32-byte SHA-256 of host_key.
    try:
        # If the bytes decode cleanly as-is, keep them. Otherwise, try
        # trimming the 32-byte prefix.
        pt.decode("utf-8")
        return pt
    except UnicodeDecodeError:
        try:
            pt[32:].decode("utf-8")
            return pt[32:]
        except Exception:
            return None


def read_greenhouse_cookies() -> dict[str, str]:
    """Return {name: value} for every cookie whose host matches *.greenhouse.io."""
    cookies_src = HOME / "Library/Application Support/Google/Chrome/Default/Cookies"
    if not cookies_src.is_file():
        log("no Chrome Default profile cookies DB")
        return {}
    pw = _keychain_password()
    if not pw:
        log("Keychain has no 'Chrome Safe Storage' entry")
        return {}
    try:
        from Crypto.Protocol.KDF import PBKDF2  # type: ignore
    except ImportError:
        log("pycryptodome missing")
        return {}
    key = PBKDF2(pw.encode(), b"saltysalt", dkLen=16, count=1003)

    out: dict[str, str] = {}
    with tempfile.TemporaryDirectory() as tmp:
        dst = Path(tmp) / "Cookies"
        shutil.copy2(cookies_src, dst)
        con = sqlite3.connect(f"file:{dst}?mode=ro", uri=True)
        try:
            rows = con.execute(
                "SELECT host_key, name, encrypted_value FROM cookies "
                "WHERE host_key LIKE '%greenhouse.io'"
            ).fetchall()
        finally:
            con.close()
    for host_key, name, enc in rows:
        if not isinstance(enc, (bytes, bytearray)) or len(enc) < 4:
            continue
        if enc[:3] not in (b"v10", b"v11"):
            log(f"skip cookie {host_key} {name}: unsupported scheme {enc[:3]!r}")
            continue
        dec = _decrypt_v10(bytes(enc[3:]), key)
        if dec is None:
            continue
        # Last writer wins \u2014 cookies for `.greenhouse.io` and
        # `app7.greenhouse.io` with the same name occasionally coexist; the
        # host-scoped one is what the browser actually sends.
        out[name] = dec.decode("utf-8", errors="replace")
    return out


# ----------------------------------------------------------------- verify


def verify_session(host: str, cookie_header: str) -> tuple[bool, str]:
    """Hit https://<host>/ and ensure we're not redirected to sign_in.

    Greenhouse's recruiter app serves 200 on `/` when signed in and 302s to
    `/users/sign_in` when not. We don't follow redirects so the signal is
    unambiguous.
    """
    req = urllib.request.Request(
        f"https://{host}/",
        headers={
            "cookie": cookie_header,
            "accept": "text/html",
            # Mirror a normal browser UA \u2014 Greenhouse's WAF sometimes
            # 403s obvious-python UAs.
            "user-agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
        },
        method="GET",
    )

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):  # type: ignore[override]
            return None

    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=10) as resp:
            status = resp.status
            location = resp.headers.get("location", "")
    except urllib.error.HTTPError as e:
        status = e.code
        location = e.headers.get("location", "") if e.headers else ""
    except Exception as e:
        return False, f"network: {e}"
    if 200 <= status < 300:
        return True, ""
    if status in (301, 302, 303, 307, 308) and "sign_in" not in location:
        # Some orgs redirect `/` to `/dashboard` while signed in; that's fine.
        return True, ""
    return False, f"http {status} \u2192 {location or '(no location)'}"


# -------------------------------------------------------------- persistence


def update_secrets_file(host: str, cookie_header: str, csrf: str) -> None:
    if not SECRETS_FILE.is_file():
        raise RuntimeError(f"{SECRETS_FILE} not found")
    with SECRETS_FILE.open("r", encoding="utf-8") as f:
        data = json.load(f)
    data["GREENHOUSE_HOST"] = host
    data["GREENHOUSE_SESSION_COOKIE"] = cookie_header
    data["GREENHOUSE_CSRF_TOKEN"] = csrf
    backup = SECRETS_FILE.with_name(f"{SECRETS_FILE.name}.bak.{int(time.time())}")
    shutil.copy2(SECRETS_FILE, backup)
    body = json.dumps(data, indent=2) + "\n"
    SECRETS_FILE.write_text(body, encoding="utf-8")
    os.chmod(SECRETS_FILE, 0o600)


# ------------------------------------------------------------------- main


def main() -> int:
    if os.environ.get("SKIP_GREENHOUSE_REFRESH") == "1":
        log("SKIP_GREENHOUSE_REFRESH=1, skipping")
        return 0

    scraped = scrape_open_tab()
    if not scraped:
        log(
            "no recruiter Greenhouse tab open in Chrome. Sign into "
            "https://app.greenhouse.io/ (you'll be redirected to your "
            "app*.greenhouse.io subdomain), keep the tab open, and retry."
        )
        return 1
    host, csrf = scraped

    cookies = read_greenhouse_cookies()
    if not cookies:
        log("no greenhouse.io cookies found in Chrome's DB")
        return 1

    # Serialize every cookie we found as a single Cookie header. Over-sending
    # is harmless; under-sending (just picking _session_id) breaks when
    # Greenhouse adds device-trust or CSRF-double-submit cookies.
    cookie_header = "; ".join(f"{k}={v}" for k, v in cookies.items())

    ok, err = verify_session(host, cookie_header)
    if not ok:
        log(f"session verify failed: {err}")
        log(
            "cookies were readable but the server rejected them. Sign out "
            "and back into Greenhouse in Chrome, then retry."
        )
        return 2

    update_secrets_file(host, cookie_header, csrf)
    print(f"updated: {SECRETS_FILE}")
    print(f"  host:   {host}")
    print(f"  cookies: {len(cookies)} ({', '.join(sorted(cookies.keys()))})")
    print(f"  csrf:   \u2026{csrf[-6:]}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log(f"internal error: {type(e).__name__}: {e}")
        sys.exit(4)
