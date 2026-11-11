#!/usr/bin/env python3
"""
Refresh Slack xoxc + xoxd tokens in secrets.local.json without any manual
clicks, from whichever browser the user signed into Slack with.

Discovery order (first browser whose extraction + auth.test succeeds wins):
  1. Firefox   — reads xoxd from cookies.sqlite (unencrypted) and xoxc from
                 the per-origin localStorage data.sqlite (snappy-compressed).
                 Zero permissions, works even if Firefox is closed.
  2. Chrome    — AppleScript into the live Slack tab for xoxc, Chrome cookie
                 DB + macOS Keychain decryption for xoxd. Requires Chrome
                 running, a signed-in app.slack.com tab, and
                 View → Developer → Allow JavaScript from Apple Events.

Both tokens get written to secrets.local.json with a timestamped .bak.
Validates against slack.com/api/auth.test before persisting so stale local
state never silently clobbers working credentials.

Exits:
  0  success — tokens refreshed and validated
  1  no browser has Slack state we can read (install, sign in once)
  2  extraction worked but Slack rejected the pair (session invalidated)
  3  dependency missing (should be installed by the .sh wrapper)
  4  internal error — see stderr

Dependencies: pycryptodome (Chrome xoxd decrypt), cramjam (Firefox snappy).
Installed by scripts/refresh-slack-tokens.sh before invoking this file.
"""

from __future__ import annotations

import glob
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable


HOME = Path.home()
REPO_ROOT = Path(__file__).resolve().parent.parent
SECRETS_FILE = REPO_ROOT / "secrets.local.json"


# ---------------------------------------------------------------- utilities


def log(msg: str) -> None:
    """Print to stderr so stdout stays reserved for machine-readable summary."""
    print(f"[slack-refresh] {msg}", file=sys.stderr)


@dataclass
class TokenPair:
    xoxc: str
    xoxd: str
    source: str  # "firefox:<profile>" or "chrome"
    team: str | None = None
    domain: str | None = None


# ---------------------------------------------------------------- Slack auth


def auth_test(pair: TokenPair) -> tuple[bool, str, dict]:
    """Hit slack.com/api/auth.test with the pair. Try both the raw and
    URL-decoded xoxd forms since Chrome's DB sometimes stores the decoded
    bytes while Firefox stores the percent-encoded form the browser sends.

    Returns (ok, error, response_json).
    """
    candidates = [pair.xoxd]
    if "%" in pair.xoxd:
        try:
            dec = urllib.parse.unquote(pair.xoxd)
            if dec != pair.xoxd:
                candidates.append(dec)
        except Exception:
            pass
    last_err = "no attempt"
    for cand in candidates:
        if not cand.startswith("xoxd-"):
            continue
        req = urllib.request.Request(
            "https://slack.com/api/auth.test",
            headers={
                "Authorization": f"Bearer {pair.xoxc}",
                "Cookie": f"d={urllib.parse.quote(cand, safe='')}",
                "Accept": "application/json",
            },
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="replace"))
        except Exception as e:
            last_err = f"network: {e}"
            continue
        if data.get("ok"):
            # Normalize the stored xoxd to whatever variant Slack accepted.
            pair.xoxd = cand
            return True, "", data
        last_err = data.get("error", "unknown")
    return False, last_err, {}


# ------------------------------------------------------------------- Firefox


def firefox_profiles() -> list[Path]:
    base = HOME / "Library/Application Support/Firefox/Profiles"
    if not base.is_dir():
        return []
    return sorted(p for p in base.iterdir() if p.is_dir())


def _snappy_decompress(blob: bytes) -> bytes:
    import cramjam  # type: ignore

    return bytes(cramjam.snappy.decompress_raw(blob))


def _read_firefox_cookies(profile: Path, tmpdir: Path) -> dict[str, str]:
    """Return { cookie_name: value } for *.slack.com cookies in this profile."""
    src = profile / "cookies.sqlite"
    if not src.is_file():
        return {}
    dst = tmpdir / f"cookies-{profile.name}.sqlite"
    shutil.copy2(src, dst)
    con = sqlite3.connect(f"file:{dst}?mode=ro", uri=True)
    try:
        rows = con.execute(
            "SELECT name, value FROM moz_cookies WHERE host LIKE '%slack.com'"
        ).fetchall()
    finally:
        con.close()
    return {name: value for name, value in rows}


def _read_firefox_localconfig(profile: Path, tmpdir: Path) -> dict | None:
    src = profile / "storage/default/https+++app.slack.com/ls/data.sqlite"
    if not src.is_file():
        return None
    dst = tmpdir / f"ls-{profile.name}.sqlite"
    shutil.copy2(src, dst)
    con = sqlite3.connect(f"file:{dst}?mode=ro", uri=True)
    try:
        row = con.execute(
            "SELECT value, conversion_type, compression_type, last_access_time "
            "FROM data WHERE key='localConfig_v2'"
        ).fetchone()
    finally:
        con.close()
    if not row:
        return None
    value, conv, comp, _last_access = row
    raw = _snappy_decompress(value) if comp == 1 else bytes(value)
    # Firefox LSNG: conversion_type 0 = UTF-16, 1 = UTF-8 (converted at write).
    text = raw.decode("utf-8" if conv == 1 else "utf-16-le", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        log(f"firefox: localConfig_v2 in {profile.name} is unparseable: {e}")
        return None


def _pick_team(cfg: dict, workspace_match: str) -> dict | None:
    teams = list((cfg.get("teams") or {}).values())
    if not teams:
        return None
    if workspace_match:
        m = workspace_match.lower()
        for t in teams:
            dom = (t.get("domain") or "").lower()
            name = (t.get("name") or "").lower()
            if m in dom or m in name:
                return t
        return None
    return teams[0]


def try_firefox(workspace_match: str) -> Iterable[TokenPair]:
    """Yield candidate TokenPairs from every Firefox profile with Slack state."""
    profiles = firefox_profiles()
    if not profiles:
        log("firefox: not installed")
        return
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        for profile in profiles:
            try:
                cookies = _read_firefox_cookies(profile, tmpdir)
            except sqlite3.DatabaseError as e:
                log(f"firefox: {profile.name} cookies locked / unreadable: {e}")
                continue
            d_cookie = cookies.get("d")
            if not d_cookie or not d_cookie.startswith("xoxd-"):
                log(f"firefox: {profile.name} has no xoxd cookie")
                continue
            try:
                cfg = _read_firefox_localconfig(profile, tmpdir)
            except Exception as e:
                log(f"firefox: {profile.name} localConfig_v2 read failed: {e}")
                continue
            if not cfg:
                log(f"firefox: {profile.name} has no localConfig_v2 for app.slack.com")
                continue
            team = _pick_team(cfg, workspace_match)
            if not team:
                avail = ", ".join(
                    (t.get("domain") or t.get("name") or "?")
                    for t in (cfg.get("teams") or {}).values()
                )
                log(
                    f"firefox: {profile.name} workspace match "
                    f"'{workspace_match or '(any)'}' not found. Available: {avail}"
                )
                continue
            tok = team.get("token", "")
            if not tok.startswith("xoxc-"):
                log(f"firefox: {profile.name} team token isn't xoxc-")
                continue
            yield TokenPair(
                xoxc=tok,
                xoxd=d_cookie,
                source=f"firefox:{profile.name}",
                team=team.get("name"),
                domain=team.get("domain"),
            )


# -------------------------------------------------------------------- Chrome


def _chrome_run_js(js: str, timeout: int = 10) -> tuple[str, str]:
    """Execute `js` in the first signed-in Slack tab found in Chrome.
    Returns (stdout, stderr). stdout is empty if no Slack tab was found.
    """
    # AppleScript string-escape: backslash and double-quote.
    js_as = js.replace("\\", "\\\\").replace('"', '\\"')
    script = (
        'tell application "Google Chrome"\n'
        '  repeat with w in windows\n'
        '    repeat with t in tabs of w\n'
        '      if (URL of t) starts with "https://app.slack.com/" then\n'
        f'        return execute t javascript "{js_as}"\n'
        '      end if\n'
        '    end repeat\n'
        '  end repeat\n'
        '  return ""\n'
        'end tell\n'
    )
    try:
        out = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError:
        return "", "osascript missing"
    except subprocess.TimeoutExpired:
        return "", "osascript timeout"
    return (out.stdout or "").strip(), (out.stderr or "").strip()


def _applescript_xoxc(workspace_match: str) -> str | None:
    m = workspace_match.lower()
    # Pick the team whose domain/name matches workspace_match; fall back to
    # the first xoxc- team if no match string was supplied.
    js = (
        "(function(){"
        "var teams=Object.values(JSON.parse(localStorage.localConfig_v2).teams);"
        f"var m={json.dumps(m)};"
        "var hit=m?teams.find(function(x){var d=(x.domain||'').toLowerCase(),n=(x.name||'').toLowerCase();return d.indexOf(m)>=0||n.indexOf(m)>=0;}):teams.find(function(x){return (x.token||'').indexOf('xoxc-')===0;});"
        "return hit&&hit.token&&hit.token.indexOf('xoxc-')===0?hit.token:'';"
        "})()"
    )
    tok, err = _chrome_run_js(js)
    if tok.startswith("xoxc-"):
        return tok
    log(f"chrome: AppleScript did not return xoxc ({err or 'empty'})")
    return None


def _chrome_live_authtest(xoxc: str) -> bool:
    """Run auth.test inside the Slack tab so the browser attaches the LIVE
    (in-memory) `d` cookie. Confirms the signed-in session is valid even when
    Chrome hasn't flushed `d` to the on-disk Cookies DB yet.

    Uses a window-scoped promise + polling because osascript executes JS
    synchronously and will not await a Promise.
    """
    kick = (
        "(function(){"
        "window.__slackMcpAuth=null;"
        # Same-origin: app.slack.com forwards /api/* to the Slack API.
        # Hitting slack.com/api/auth.test directly from an app.slack.com tab
        # fails CORS ("Failed to fetch"), which the old script treated as an
        # invalid session when the session was actually fine.
        "fetch('/api/auth.test',{"
        "method:'POST',credentials:'include',"
        f"headers:{{Authorization:'Bearer '+{json.dumps(xoxc)}}}"
        "}).then(function(r){return r.json();})"
        ".then(function(j){window.__slackMcpAuth=j;})"
        ".catch(function(e){window.__slackMcpAuth={ok:false,error:String(e)};});"
        "return 'kicked';"
        "})()"
    )
    out, _ = _chrome_run_js(kick)
    if out != "kicked":
        return False
    poll = "JSON.stringify(window.__slackMcpAuth)"
    for _ in range(20):  # ~10s
        time.sleep(0.5)
        out, _ = _chrome_run_js(poll)
        if out and out != "null":
            try:
                data = json.loads(out)
            except json.JSONDecodeError:
                continue
            return bool(data.get("ok"))
    return False


def _chrome_nudge_flush() -> None:
    """Encourage Chrome's CookieMonster to flush pending cookie writes to
    the on-disk Cookies DB. Writing and immediately clearing a non-HttpOnly
    cookie on slack.com dirties the store without affecting Slack state;
    CookieMonster batches a flush shortly after.
    """
    js = (
        "(function(){"
        "try{"
        "document.cookie='slackmcp_flush=1; path=/; domain=.slack.com; max-age=2; secure; samesite=lax';"
        "document.cookie='slackmcp_flush=; path=/; domain=.slack.com; max-age=0; secure; samesite=lax';"
        "}catch(e){}"
        "return 'nudged';"
        "})()"
    )
    _chrome_run_js(js)


def _chrome_xoxd(_pw_cache: list = []) -> str | None:
    cookies_src = HOME / "Library/Application Support/Google/Chrome/Default/Cookies"
    if not cookies_src.is_file():
        log("chrome: no Default profile cookies DB")
        return None
    if _pw_cache:
        pw = _pw_cache[0]
    else:
        try:
            pw = subprocess.run(
                ["security", "find-generic-password", "-w", "-s", "Chrome Safe Storage"],
                capture_output=True,
                text=True,
                timeout=5,
            ).stdout.strip()
        except Exception as e:
            log(f"chrome: Keychain read failed: {e}")
            return None
        if not pw:
            log("chrome: Keychain has no 'Chrome Safe Storage' entry")
            return None
        _pw_cache.append(pw)
    with tempfile.TemporaryDirectory() as tmp:
        dst = Path(tmp) / "Cookies"
        shutil.copy2(cookies_src, dst)
        con = sqlite3.connect(f"file:{dst}?mode=ro", uri=True)
        try:
            row = con.execute(
                "SELECT encrypted_value FROM cookies "
                "WHERE host_key LIKE '%slack.com' AND name='d' LIMIT 1"
            ).fetchone()
        finally:
            con.close()
    if not row:
        log("chrome: no `d` cookie for slack.com in cookie DB")
        return None
    enc = row[0]
    if enc[:3] != b"v10":
        log(f"chrome: unsupported cookie scheme {enc[:3]!r} (app-bound encryption?)")
        return None
    try:
        from Crypto.Cipher import AES  # type: ignore
        from Crypto.Protocol.KDF import PBKDF2  # type: ignore
    except ImportError:
        log("chrome: pycryptodome missing — install with pip3 install --user pycryptodome")
        return None
    key = PBKDF2(pw.encode(), b"saltysalt", dkLen=16, count=1003)
    pt = AES.new(key, AES.MODE_CBC, IV=b" " * 16).decrypt(enc[3:])
    pt = pt[: -pt[-1]]  # strip PKCS#7 padding
    # Chrome 117+ prepends a 32-byte SHA-256 of host_key for integrity.
    if not pt.startswith(b"xoxd-") and pt[32:].startswith(b"xoxd-"):
        pt = pt[32:]
    if not pt.startswith(b"xoxd-"):
        log("chrome: xoxd decrypt produced unexpected prefix")
        return None
    return pt.decode()


def try_chrome(workspace_match: str) -> Iterable[TokenPair]:
    xoxc = _applescript_xoxc(workspace_match)
    if not xoxc:
        log("chrome: no xoxc from live tab (need signed-in Slack tab + Apple Events toggle)")
        return

    # Validate the live session before trusting the on-disk `d` cookie.
    # Chrome buffers HttpOnly cookie writes and only flushes on a timer
    # (~30s), so immediately after sign-in the on-disk `d` is often stale
    # and will auth.test as invalid_auth even when the browser session is
    # perfectly valid. Running auth.test from inside the Slack tab uses the
    # in-memory cookie and tells us whether the session itself is good.
    live_ok = _chrome_live_authtest(xoxc)
    if not live_ok:
        log("chrome: in-tab auth.test rejected — the Slack session itself is invalid")
        return
    log("chrome: in-tab auth.test ok — session is live, resolving xoxd from disk")

    # Session is valid in-browser. Now reconcile the on-disk `d` cookie,
    # polling with flush nudges until auth.test with the pair succeeds.
    # First attempt: whatever's on disk right now.
    for attempt in range(1, 13):  # ~60s worst case
        xoxd = _chrome_xoxd()
        if xoxd:
            pair = TokenPair(xoxc=xoxc, xoxd=xoxd, source="chrome")
            ok, err, _ = auth_test(pair)
            if ok:
                yield pair
                return
            log(
                f"chrome: disk xoxd rejected ({err}) on attempt {attempt}; "
                "Chrome hasn't flushed yet, nudging + retrying"
            )
        else:
            log(f"chrome: no xoxd on disk on attempt {attempt}; nudging + retrying")
        _chrome_nudge_flush()
        time.sleep(5)

    log(
        "chrome: live session is valid but disk xoxd never caught up after "
        "60s. Try switching to the Slack tab (Chrome flushes cookies more "
        "aggressively while the tab is foregrounded) and refresh again."
    )


# -------------------------------------------------------------- persistence


def update_secrets_file(pair: TokenPair) -> None:
    if not SECRETS_FILE.is_file():
        raise RuntimeError(f"{SECRETS_FILE} not found")
    with SECRETS_FILE.open("r", encoding="utf-8") as f:
        data = json.load(f)
    data["SLACK_MCP_XOXC_TOKEN"] = pair.xoxc
    data["SLACK_MCP_XOXD_TOKEN"] = pair.xoxd
    backup = SECRETS_FILE.with_name(f"{SECRETS_FILE.name}.bak.{int(time.time())}")
    shutil.copy2(SECRETS_FILE, backup)
    body = json.dumps(data, indent=2) + "\n"
    SECRETS_FILE.write_text(body, encoding="utf-8")
    os.chmod(SECRETS_FILE, 0o600)


# ---------------------------------------------------------------------- main


Strategy = Callable[[str], Iterable[TokenPair]]
STRATEGIES: list[tuple[str, Strategy]] = [
    ("firefox", try_firefox),
    ("chrome", try_chrome),
]


def main() -> int:
    if os.environ.get("SKIP_SLACK_REFRESH") == "1":
        log("SKIP_SLACK_REFRESH=1, skipping")
        return 0

    workspace_match = (os.environ.get("SLACK_WORKSPACE_MATCH") or "").strip().lower()
    rejected: list[str] = []
    extracted_any = False

    for name, fn in STRATEGIES:
        for pair in fn(workspace_match):
            extracted_any = True
            ok, err, info = auth_test(pair)
            if ok:
                update_secrets_file(pair)
                team = info.get("team") or pair.team or "?"
                user = info.get("user") or "?"
                log(
                    f"ok via {pair.source}: user={user} team={team} "
                    f"xoxc=...{pair.xoxc[-4:]} xoxd=...{pair.xoxd[-4:]}"
                )
                print(f"updated: {SECRETS_FILE}")
                print(f"  source: {pair.source}")
                print(f"  user:   {user}")
                print(f"  team:   {team}")
                print(f"  xoxc:   …{pair.xoxc[-4:]}")
                print(f"  xoxd:   …{pair.xoxd[-4:]}")
                return 0
            rejected.append(f"{pair.source}: {err}")
            log(f"rejected ({pair.source}): {err}")

    if not extracted_any:
        log(
            "no browser had extractable Slack credentials. Sign into "
            "https://app.slack.com/client in Firefox or Chrome and retry."
        )
        return 1

    log("every candidate pair was rejected by Slack:")
    for r in rejected:
        log(f"  - {r}")
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log(f"internal error: {type(e).__name__}: {e}")
        sys.exit(4)
