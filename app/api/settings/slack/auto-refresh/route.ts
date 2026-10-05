import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { applySecretsToEnv } from "@/lib/secrets";

/**
 * Local-Chrome Slack token refresh.
 *
 * Runs `scripts/refresh-slack-tokens.sh` server-side — the same script that
 * runs on `predev`. It extracts a fresh `xoxc` from the open app.slack.com
 * tab via AppleScript and decrypts `xoxd` from Chrome's cookie DB using the
 * macOS Keychain. Both tokens get written to `secrets.local.json`, then we
 * re-apply secrets to process.env and verify against Slack's auth.test.
 *
 * This is the "I'm on my own Mac with Chrome signed into Slack" fast path.
 * The dragged bookmarklet remains as the fallback for everything else
 * (Chrome quit, different machine, remote dev server, Keychain locked, etc.).
 *
 * Not exposed when running on non-macOS hosts or when the script is missing.
 */

const execFileAsync = promisify(execFile);

function isAvailable(): { ok: boolean; reason?: string; scriptPath?: string } {
  if (process.platform !== "darwin") {
    return { ok: false, reason: "Local-Chrome refresh is macOS-only." };
  }
  const scriptPath = path.join(process.cwd(), "scripts", "refresh-slack-tokens.sh");
  if (!existsSync(scriptPath)) {
    return { ok: false, reason: `Script not found at ${scriptPath}.` };
  }
  return { ok: true, scriptPath };
}

export async function GET() {
  const avail = isAvailable();
  return NextResponse.json({ available: avail.ok, reason: avail.reason ?? null });
}

export async function POST() {
  const avail = isAvailable();
  if (!avail.ok) {
    return NextResponse.json({ error: avail.reason }, { status: 400 });
  }

  // Run the script. 25s cap — AppleScript + Keychain + sqlite usually
  // completes in <2s, but Chrome auto-launch adds latency when it isn't
  // already running. Anything longer is a stuck prompt.
  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync("/bin/bash", [avail.scriptPath!], {
      cwd: process.cwd(),
      timeout: 25_000,
      maxBuffer: 1_000_000,
      env: { ...process.env, SKIP_SLACK_REFRESH: "0" },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; code?: number; message?: string };
    const detail = (err.stderr || err.message || "unknown error").trim();
    return NextResponse.json(
      {
        error: `refresh-slack-tokens.sh failed (exit ${err.code ?? "?"}): ${detail}`,
        hint: hintFor(detail),
      },
      { status: 500 },
    );
  }

  // Re-read secrets.local.json into process.env so this process (and any
  // subsequent request) uses the fresh tokens without a dev-server restart.
  await applySecretsToEnv();

  const xoxc = (process.env.SLACK_MCP_XOXC_TOKEN ?? "").trim();
  const xoxd = (process.env.SLACK_MCP_XOXD_TOKEN ?? "").trim();
  if (!xoxc.startsWith("xoxc-") || !xoxd.startsWith("xoxd-")) {
    return NextResponse.json(
      { error: "Script ran but tokens are missing or malformed after reload.", stdout, stderr },
      { status: 500 },
    );
  }

  // Verify against Slack. Mirrors the import route — try the raw value and
  // a URL-decoded form in case the stored xoxd is percent-encoded.
  const candidates = Array.from(
    new Set(
      [xoxd.includes("%") ? safeDecode(xoxd) : "", xoxd].filter(
        (v): v is string => !!v && v.startsWith("xoxd-"),
      ),
    ),
  );
  let user: string | undefined;
  let team: string | undefined;
  let lastErr = "unknown";
  for (const candidate of candidates) {
    const res = await fetch("https://slack.com/api/auth.test", {
      headers: {
        authorization: `Bearer ${xoxc}`,
        cookie: `d=${encodeURIComponent(candidate)}`,
        accept: "application/json",
      },
    });
    const parsed = (await res.json()) as {
      ok: boolean;
      error?: string;
      user?: string;
      team?: string;
    };
    if (parsed.ok) {
      user = parsed.user;
      team = parsed.team;
      lastErr = "";
      break;
    }
    lastErr = parsed.error ?? `http_${res.status}`;
  }
  if (lastErr) {
    return NextResponse.json(
      {
        error: `Tokens refreshed from Chrome, but Slack rejected them: ${lastErr}.`,
        xoxcLast4: xoxc.slice(-4),
        xoxdLast4: xoxd.slice(-4),
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    user,
    team,
    xoxcLast4: xoxc.slice(-4),
    xoxdLast4: xoxd.slice(-4),
  });
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return "";
  }
}

function hintFor(detail: string): string | null {
  if (/no browser had extractable Slack credentials/i.test(detail)) {
    return "Sign into https://app.slack.com/client in Firefox or Chrome, then click Refresh again. Firefox is preferred — it works entirely from disk.";
  }
  if (/every candidate pair was rejected/i.test(detail)) {
    return "Browser state was readable but Slack rejected the tokens. Sign out and back into Slack in your browser, then click Refresh again.";
  }
  if (/Keychain|Chrome Safe Storage/i.test(detail)) {
    return "macOS Keychain is locked or denied access. Unlock the login keychain and retry — you may see a one-time prompt.";
  }
  if (/pycryptodome|cramjam|Crypto\.Cipher/i.test(detail)) {
    return "Python dependency missing. Run: pip3 install --user --break-system-packages pycryptodome cramjam";
  }
  if (/unsupported.*scheme/i.test(detail)) {
    return "Chrome's cookie encryption scheme changed. The script needs updating to use CDP instead of on-disk decryption.";
  }
  return null;
}
