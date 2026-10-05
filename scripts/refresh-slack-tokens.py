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


def _applescript_xoxc() -> str | None:
    script = r"""
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
"""
    try:
        out = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except FileNotFoundError:
        return None
    tok = (out.stdout or "").strip()
    if tok.startswith("xoxc-"):
        return tok
    err = (out.stderr or "").strip() or "(no stderr)"
    log(f"chrome: AppleScript did not return xoxc ({err or 'empty'})")
    return None


def _chrome_xoxd() -> str | None:
    cookies_src = HOME / "Library/Application Support/Google/Chrome/Default/Cookies"
    if not cookies_src.is_file():
        log("chrome: no Default profile cookies DB")
        return None
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


def try_chrome(_workspace_match: str) -> Iterable[TokenPair]:
    xoxc = _applescript_xoxc()
    xoxd = _chrome_xoxd()
    if xoxc and xoxd:
        yield TokenPair(xoxc=xoxc, xoxd=xoxd, source="chrome")
    elif not xoxc and not xoxd:
        log("chrome: nothing extractable (no running Slack tab + no cookie DB match)")
    elif not xoxc:
        log("chrome: have xoxd but no xoxc (need signed-in Slack tab + Apple Events toggle)")
    else:
        log("chrome: have xoxc but no xoxd (Keychain unavailable or cookie DB missing `d`)")


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
