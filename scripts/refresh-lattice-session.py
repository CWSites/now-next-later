#!/usr/bin/env python3
"""
Refresh Lattice 1:1 action items without a bookmarklet click.

Lattice's session cookies (`access_token`, `refresh_token`, `latticeInfo`,
`viewerContext`) are all HttpOnly, so they can't be read by JS running on
the page — which is why the UI's fallback is a bookmarklet that calls
Lattice's GraphQL from the signed-in tab itself.

This script short-circuits that by reading the cookies directly out of
Chrome's cookie DB (AES-GCM / AES-CBC v10, decrypted with the key stored
in the macOS Keychain under "Chrome Safe Storage"), reconstructing the
Cookie header the browser would have sent, and replaying the same GraphQL
query the bookmarklet runs.

Discovery order:
  1. LATTICE_SUBDOMAIN env var, if set (e.g. "acme").
  2. First `<sub>.latticehq.com` host_key that has an `access_token`
     cookie in Chrome's DB.

Output on stdout (single JSON object) when successful:
  {
    "ok": true,
    "subdomain": "<your-workspace>",
    "who": "<viewer name>",
    "items": [ { externalId, title, bucket, sourceRef, url }, ... ],
    "stats": { "totalActs": N, "mineActs": N }
  }

Exit codes:
  0  success
  1  no Chrome cookies / no signed-in Lattice workspace
  2  GraphQL returned non-OK (session rejected — sign in again)
  3  dependency missing (should be installed by the .sh wrapper)
  4  internal error — see stderr

The tokens themselves never touch secrets.local.json — they're ephemeral
to the GraphQL call. Only `LATTICE_LAST_SYNCED_AT` is persisted, by the
Node route that invokes this script (same as the bookmarklet path).

Dependencies: pycryptodome (Chrome cookie AES decrypt). Installed by the
.sh wrapper on first run.
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path


HOME = Path.home()
CHROME_COOKIES = HOME / "Library/Application Support/Google/Chrome/Default/Cookies"


def log(msg: str) -> None:
    """Keep stdout reserved for the final JSON payload."""
    print(f"[lattice-refresh] {msg}", file=sys.stderr)


@dataclass
class CookieRow:
    host_key: str
    name: str
    value: str


# --------------------------------------------------------------- Chrome read


def _keychain_password() -> str | None:
    try:
        pw = subprocess.run(
            ["security", "find-generic-password", "-w", "-s", "Chrome Safe Storage"],
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout.strip()
    except Exception as e:
        log(f"keychain read failed: {e}")
        return None
    if not pw:
        log("keychain has no 'Chrome Safe Storage' entry")
        return None
    return pw


def _decrypt_v10(enc: bytes, pw: str) -> bytes | None:
    """Chrome macOS cookies are AES-128-CBC with a PBKDF2-derived key.
    Chrome 117+ prepends a 32-byte SHA-256(host_key) integrity prefix to
    the plaintext; we strip it if present.
    """
    try:
        from Crypto.Cipher import AES  # type: ignore
        from Crypto.Protocol.KDF import PBKDF2  # type: ignore
    except ImportError:
        log("pycryptodome missing — install with pip3 install --user pycryptodome")
        return None
    if enc[:3] != b"v10":
        log(f"unsupported cookie scheme {enc[:3]!r} (app-bound encryption?)")
        return None
    key = PBKDF2(pw.encode(), b"saltysalt", dkLen=16, count=1003)
    pt = AES.new(key, AES.MODE_CBC, IV=b" " * 16).decrypt(enc[3:])
    try:
        pt = pt[: -pt[-1]]  # strip PKCS#7 padding
    except Exception:
        return None
    return pt


def _looks_like_integrity_prefixed(pt: bytes) -> bool:
    """Heuristic: Chrome 117+ prepends 32 bytes of SHA-256 before the real
    cookie value. If the first 32 bytes look binary and the remainder is
    printable ASCII, strip them.
    """
    if len(pt) <= 32:
        return False
    head, tail = pt[:32], pt[32:]
    if not tail:
        return False
    # If the head has any non-printable bytes and the tail is all printable,
    # the prefix is the integrity hash.
    head_has_bin = any(b < 0x20 or b > 0x7E for b in head)
    tail_all_print = all(0x20 <= b <= 0x7E for b in tail)
    return head_has_bin and tail_all_print


def read_lattice_cookies() -> tuple[str, list[CookieRow]] | None:
    """Return (subdomain, cookies) where cookies covers every
    *.latticehq.com entry needed to replay a GraphQL call. Returns None
    if we can't find a signed-in workspace.
    """
    if not CHROME_COOKIES.is_file():
        log("no Chrome Default profile cookies DB")
        return None
    pw = _keychain_password()
    if not pw:
        return None

    with tempfile.TemporaryDirectory() as tmp:
        dst = Path(tmp) / "Cookies"
        shutil.copy2(CHROME_COOKIES, dst)
        con = sqlite3.connect(f"file:{dst}?mode=ro", uri=True)
        try:
            rows = con.execute(
                "SELECT host_key, name, encrypted_value FROM cookies "
                "WHERE host_key LIKE '%latticehq.com'"
            ).fetchall()
        finally:
            con.close()

    if not rows:
        log("no *.latticehq.com cookies in Chrome. Sign into Lattice and retry.")
        return None

    # Decrypt + collect.
    decoded: list[CookieRow] = []
    for host_key, name, enc in rows:
        if not enc:
            # Non-encrypted cookies are stored in a separate column we don't
            # read here; they're not needed for session replay.
            continue
        pt = _decrypt_v10(enc, pw)
        if pt is None:
            continue
        if _looks_like_integrity_prefixed(pt):
            pt = pt[32:]
        try:
            value = pt.decode("utf-8")
        except UnicodeDecodeError:
            continue
        decoded.append(CookieRow(host_key=host_key, name=name, value=value))

    # Pick the workspace subdomain.
    forced = (os.environ.get("LATTICE_SUBDOMAIN") or "").strip().lower()
    subdomain: str | None = None
    if forced:
        subdomain = forced
    else:
        # Any host_key of the form "<sub>.latticehq.com" with an access_token.
        candidates: list[str] = []
        for c in decoded:
            if c.name == "access_token" and c.host_key.endswith(".latticehq.com"):
                sub = c.host_key[: -len(".latticehq.com")].lstrip(".")
                if sub and "." not in sub:
                    candidates.append(sub)
        # De-dupe, keep first.
        seen: set[str] = set()
        for s in candidates:
            if s not in seen:
                seen.add(s)
                subdomain = subdomain or s

    if not subdomain:
        log(
            "no signed-in Lattice workspace found in Chrome cookies. Sign "
            "into https://<yourco>.latticehq.com and retry, or set "
            "LATTICE_SUBDOMAIN."
        )
        return None

    # Filter cookies to those a browser would send to <sub>.latticehq.com:
    # host_key `.latticehq.com` applies to every subdomain; host_key
    # `<sub>.latticehq.com` applies only to that subdomain (we skip other
    # subdomains).
    target_host = f"{subdomain}.latticehq.com"
    keep: list[CookieRow] = []
    for c in decoded:
        hk = c.host_key
        if hk == target_host or hk == "." + target_host:
            keep.append(c)
        elif hk == ".latticehq.com" or hk == "latticehq.com":
            keep.append(c)

    if not any(c.name == "access_token" for c in keep):
        log(
            f"cookies for {target_host} don't include access_token. "
            "The workspace may be signed out — sign in and retry."
        )
        return None

    return subdomain, keep


# --------------------------------------------------------------- GraphQL


GRAPHQL_QUERY = (
    "query OneOnOnesActionItemsSidebarQuery { viewer { user { entityId name "
    "preferredName userActiveOneOnOneRelationshipUsers { entityId name "
    "preferredName viewerUserRelationship { oneOnOneMeetings(first: 1) { edges "
    "{ node { entityId actionItems { entityId completedAt dueDate body "
    "createdAt assigneeUser { entityId viewerIsUser name id } id } id } } } id "
    "} id } id } id } }"
)


def _cookie_header(cookies: list[CookieRow]) -> str:
    return "; ".join(f"{c.name}={c.value}" for c in cookies)


def fetch_action_items(subdomain: str, cookies: list[CookieRow]) -> dict:
    """Mirror the bookmarklet's fetch 1:1, server-side."""
    origin = f"https://{subdomain}.latticehq.com"
    body = json.dumps(
        {"id": "OneOnOnesActionItemsSidebarQuery", "query": GRAPHQL_QUERY}
    ).encode()
    req = urllib.request.Request(
        origin + "/graphql",
        data=body,
        method="POST",
        headers={
            "content-type": "application/json; charset=utf-8",
            "x-lattice-deployment": "us-prod-1",
            "x-lattice-is-real-company": "true",
            "x-lattice-market-segment": "smb_high",
            "x-lattice-products": '{"OneOnOnesActionItemsSidebarQuery":"oneOnOnes"}',
            "x-timezone": "America/New_York",
            "origin": origin,
            "referer": origin + "/",
            # Lattice's edge (Cloudflare) blocks the default Python UA. Any
            # browser-shaped UA works; we're already presenting the user's
            # own session cookies so the fingerprinting is a formality.
            "user-agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
            "cookie": _cookie_header(cookies),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read()
            data = json.loads(raw.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as e:
        snippet = e.read()[:200].decode("utf-8", errors="replace") if e.fp else ""
        raise RuntimeError(f"HTTP {e.code} from Lattice GraphQL: {snippet}") from e
    except Exception as e:
        raise RuntimeError(f"Lattice GraphQL request failed: {e}") from e
    if data.get("errors"):
        msg = data["errors"][0].get("message", "unknown")
        raise RuntimeError(f"GraphQL error: {msg}")
    return data


# --------------------------------------------------------------- Transform


def _strip_markup(s: str) -> str:
    import re

    s = re.sub(r"<[^>]+>", "", s or "")
    s = s.replace("&nbsp;", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def extract_items(subdomain: str, payload: dict) -> tuple[list[dict], str, dict]:
    """Returns (items, who_name, stats)."""
    origin = f"https://{subdomain}.latticehq.com"
    viewer = ((payload.get("data") or {}).get("viewer") or {}).get("user") or {}
    my_entity_id = viewer.get("entityId")
    who_name = viewer.get("preferredName") or viewer.get("name") or ""
    if not my_entity_id:
        raise RuntimeError("GraphQL response missing viewer.user.entityId")

    rels = viewer.get("userActiveOneOnOneRelationshipUsers") or []
    items: list[dict] = []
    total_acts = 0
    mine_acts = 0
    assigned_to_others = 0
    unassigned_skipped = 0

    from datetime import datetime

    for rel in rels:
        other = rel.get("preferredName") or rel.get("name") or "someone"
        edges = (
            ((rel.get("viewerUserRelationship") or {}).get("oneOnOneMeetings") or {}).get(
                "edges"
            )
            or []
        )
        for edge in edges:
            acts = ((edge or {}).get("node") or {}).get("actionItems") or []
            for a in acts:
                total_acts += 1
                if a.get("completedAt"):
                    continue

                # Assignee gate. Lattice gives us two signals on the
                # assignee: `entityId` (compare to our viewer id) and
                # `viewerIsUser` (Lattice's own "is this the signed-in
                # user?" flag). Require BOTH — if either disagrees we're
                # looking at an item assigned to the other person (which
                # I probably asked them to do) and it must not land on my
                # list. If there's no assignee at all, skip rather than
                # default to mine; an unowned action item on a 1:1 is
                # ambiguous and the user's rule is "don't assume mine."
                assignee = a.get("assigneeUser")
                if not assignee or not assignee.get("entityId"):
                    unassigned_skipped += 1
                    continue
                if assignee.get("entityId") != my_entity_id:
                    assigned_to_others += 1
                    continue
                if assignee.get("viewerIsUser") is False:
                    # Defensive: if entityId matched but viewerIsUser is
                    # explicitly false, trust Lattice's flag and skip.
                    assigned_to_others += 1
                    continue

                mine_acts += 1
                body = _strip_markup(a.get("body") or "")
                if not body:
                    continue
                due_suffix = ""
                if a.get("dueDate"):
                    try:
                        d = datetime.fromisoformat(a["dueDate"].replace("Z", "+00:00"))
                        due_suffix = f" (due {d.strftime('%b %-d')})"
                    except Exception:
                        pass
                eid = a.get("entityId") or a.get("id")
                items.append(
                    {
                        "externalId": f"lattice:action:{eid}",
                        "title": body,
                        "bucket": "next",
                        # Include the assignee name so the user can audit
                        # misattributions at a glance in the task card.
                        "sourceRef": (
                            f"From Lattice 1:1 with {other}{due_suffix} — "
                            f"assigned to {assignee.get('name') or 'you'}."
                        ),
                        "url": (
                            f"{origin}/users/{rel.get('entityId')}/1-1s"
                            if rel.get("entityId")
                            else None
                        ),
                    }
                )

    return items, who_name, {
        "totalActs": total_acts,
        "mineActs": mine_acts,
        "assignedToOthers": assigned_to_others,
        "unassignedSkipped": unassigned_skipped,
    }


# --------------------------------------------------------------------- main


def main() -> int:
    if os.environ.get("SKIP_LATTICE_REFRESH") == "1":
        log("SKIP_LATTICE_REFRESH=1, skipping")
        print(json.dumps({"ok": True, "skipped": True}))
        return 0

    found = read_lattice_cookies()
    if not found:
        return 1
    subdomain, cookies = found
    log(f"using subdomain={subdomain} ({len(cookies)} cookies)")

    try:
        payload = fetch_action_items(subdomain, cookies)
    except RuntimeError as e:
        msg = str(e)
        log(msg)
        # Classify: auth-ish failures → exit 2 (session invalid). Everything
        # else → exit 4 (internal).
        if any(
            frag in msg.lower()
            for frag in ("401", "403", "unauthorized", "forbidden", "login")
        ):
            return 2
        return 4

    items, who, stats = extract_items(subdomain, payload)
    log(
        f"extracted {stats['mineActs']} items assigned to me out of "
        f"{stats['totalActs']} total action items across 1:1s "
        f"({stats['assignedToOthers']} assigned to others, "
        f"{stats['unassignedSkipped']} unassigned — skipped)"
    )

    print(
        json.dumps(
            {
                "ok": True,
                "subdomain": subdomain,
                "who": who,
                "items": items,
                "stats": stats,
            }
        )
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log(f"internal error: {type(e).__name__}: {e}")
        sys.exit(4)
