import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { mergeLatticeItems } from "../sync/route";

/**
 * Local-Chrome Lattice session refresh.
 *
 * Runs `scripts/refresh-lattice-session.sh` server-side. That script
 * reads Lattice's HttpOnly session cookies (access_token, refresh_token,
 * latticeInfo, viewerContext, plus the Cloudflare pair) directly out of
 * Chrome's cookie DB using the macOS Keychain, then replays the same
 * GraphQL query the bookmarklet runs — all without a bookmarks-bar click.
 *
 * The script emits the extracted action items as JSON on stdout. We feed
 * them straight into `mergeLatticeItems`, the same merge pipeline the
 * bookmarklet POST handler uses, so dedup / tombstone / removed-item
 * logic stays identical across both entry points.
 *
 * The bookmarklet remains as the fallback for the "not on this Mac" case
 * (remote dev server, Chrome quit, Keychain unavailable, non-macOS host).
 */

const execFileAsync = promisify(execFile);

function isAvailable(): { ok: boolean; reason?: string; scriptPath?: string } {
  if (process.platform !== "darwin") {
    return { ok: false, reason: "Local-Chrome refresh is macOS-only." };
  }
  const scriptPath = path.join(process.cwd(), "scripts", "refresh-lattice-session.sh");
  if (!existsSync(scriptPath)) {
    return { ok: false, reason: `Script not found at ${scriptPath}.` };
  }
  return { ok: true, scriptPath };
}

export async function GET() {
  const avail = isAvailable();
  return NextResponse.json({ available: avail.ok, reason: avail.reason ?? null });
}

interface ScriptPayload {
  ok: boolean;
  subdomain?: string;
  who?: string;
  items?: Array<{
    externalId: string;
    title: string;
    bucket: string;
    sourceRef?: string;
    url?: string;
  }>;
  stats?: { totalActs: number; mineActs: number };
  skipped?: boolean;
}

export async function POST() {
  const avail = isAvailable();
  if (!avail.ok) {
    return NextResponse.json({ error: avail.reason }, { status: 400 });
  }

  // 25s cap — same as Slack. Cookie decrypt + GraphQL round-trip is
  // normally <2s; longer means a stuck Keychain prompt or Chrome upgrade.
  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync("/bin/bash", [avail.scriptPath!], {
      cwd: process.cwd(),
      timeout: 25_000,
      maxBuffer: 2_000_000,
      env: { ...process.env, SKIP_LATTICE_REFRESH: "0" },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; code?: number; message?: string };
    const detail = (err.stderr || err.message || "unknown error").trim();
    return NextResponse.json(
      {
        error: `refresh-lattice-session.sh failed (exit ${err.code ?? "?"}): ${detail}`,
        hint: hintFor(detail, err.code ?? null),
      },
      { status: 500 },
    );
  }

  let payload: ScriptPayload;
  try {
    payload = JSON.parse(stdout.trim()) as ScriptPayload;
  } catch {
    return NextResponse.json(
      { error: "Script output was not valid JSON.", stdout, stderr },
      { status: 500 },
    );
  }
  if (!payload.ok) {
    return NextResponse.json(
      { error: "Script reported failure.", stdout, stderr },
      { status: 500 },
    );
  }
  if (payload.skipped) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  if (!Array.isArray(payload.items)) {
    return NextResponse.json(
      { error: "Script payload missing items array.", stdout, stderr },
      { status: 500 },
    );
  }

  const merged = await mergeLatticeItems({
    items: payload.items,
    who: payload.who,
  });

  return NextResponse.json({
    ...merged,
    subdomain: payload.subdomain,
    stats: payload.stats,
  });
}

function hintFor(detail: string, exitCode: number | null): string | null {
  if (exitCode === 1 || /no.*lattice.*workspace|no.*lattice.*cookies/i.test(detail)) {
    return "Sign into your Lattice workspace in Chrome (https://<yourco>.latticehq.com), then click Refresh again. If you have multiple workspaces, set LATTICE_SUBDOMAIN in secrets.local.json to pick one.";
  }
  if (exitCode === 2 || /401|403|unauthorized|forbidden/i.test(detail)) {
    return "Chrome has Lattice cookies, but Lattice rejected the session. Sign out and back into Lattice, then click Refresh again.";
  }
  if (/Keychain|Chrome Safe Storage/i.test(detail)) {
    return "macOS Keychain is locked or denied access. Unlock the login keychain and retry — you may see a one-time prompt.";
  }
  if (/pycryptodome|Crypto\.Cipher/i.test(detail)) {
    return "Python dependency missing. Run: pip3 install --user --break-system-packages pycryptodome";
  }
  if (/unsupported.*scheme/i.test(detail)) {
    return "Chrome's cookie encryption scheme changed. The script needs updating (likely app-bound encryption).";
  }
  return null;
}
