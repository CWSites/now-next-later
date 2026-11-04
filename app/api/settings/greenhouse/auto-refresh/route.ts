import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { applySecretsToEnv } from "@/lib/secrets";

/**
 * Local-Chrome Greenhouse session refresh.
 *
 * Runs `scripts/refresh-greenhouse-session.sh` server-side. The script:
 *  - reads the recruiter subdomain + CSRF meta tag out of the open
 *    *.greenhouse.io Chrome tab via AppleScript,
 *  - decrypts every *.greenhouse.io cookie from Chrome's cookie DB using the
 *    macOS Keychain,
 *  - verifies against `https://<host>/` that we're not getting bounced to
 *    /users/sign_in,
 *  - writes GREENHOUSE_HOST, GREENHOUSE_SESSION_COOKIE, GREENHOUSE_CSRF_TOKEN
 *    into secrets.local.json.
 *
 * This is the "I don't have Harvest API access" fallback. When
 * GREENHOUSE_API_KEY is also set, the Harvest adapter still wins (see
 * `greenhouseAuthMode`); the session route exists so recruiters without
 * admin can still populate the Hiring bucket.
 */

const execFileAsync = promisify(execFile);

function isAvailable(): { ok: boolean; reason?: string; scriptPath?: string } {
  if (process.platform !== "darwin") {
    return { ok: false, reason: "Local-Chrome refresh is macOS-only." };
  }
  const scriptPath = path.join(
    process.cwd(),
    "scripts",
    "refresh-greenhouse-session.sh",
  );
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

  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync("/bin/bash", [avail.scriptPath!], {
      cwd: process.cwd(),
      timeout: 25_000,
      maxBuffer: 1_000_000,
      env: { ...process.env, SKIP_GREENHOUSE_REFRESH: "0" },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (e: unknown) {
    const err = e as {
      stdout?: string;
      stderr?: string;
      code?: number;
      message?: string;
    };
    const detail = (err.stderr || err.message || "unknown error").trim();
    return NextResponse.json(
      {
        error: `refresh-greenhouse-session.sh failed (exit ${err.code ?? "?"}): ${detail}`,
        hint: hintFor(detail),
      },
      { status: 500 },
    );
  }

  // Re-read secrets.local.json into process.env so the next ingest run uses
  // the fresh values without a dev-server restart.
  await applySecretsToEnv();

  const host = (process.env.GREENHOUSE_HOST ?? "").trim();
  const cookie = (process.env.GREENHOUSE_SESSION_COOKIE ?? "").trim();
  const csrf = (process.env.GREENHOUSE_CSRF_TOKEN ?? "").trim();
  if (!host || !cookie || !csrf) {
    return NextResponse.json(
      {
        error:
          "Script ran but one or more of GREENHOUSE_HOST / _SESSION_COOKIE / _CSRF_TOKEN is missing after reload.",
        stdout,
        stderr,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    host,
    cookieCount: cookie.split(";").length,
    csrfLast6: csrf.slice(-6),
  });
}

function hintFor(detail: string): string | null {
  if (/no recruiter Greenhouse tab open/i.test(detail)) {
    return "Sign into https://app.greenhouse.io/ in Chrome, keep the tab open, then click Refresh again.";
  }
  if (/server rejected them/i.test(detail)) {
    return "Cookies were readable but Greenhouse rejected them. Sign out and back in (or re-complete SSO), then retry.";
  }
  if (/Keychain|Chrome Safe Storage/i.test(detail)) {
    return "macOS Keychain is locked or denied access. Unlock the login keychain and retry — you may see a one-time prompt.";
  }
  if (/pycryptodome|Crypto\.Cipher/i.test(detail)) {
    return "Python dependency missing. Run: pip3 install --user --break-system-packages pycryptodome";
  }
  if (/Allow JavaScript from Apple Events/i.test(detail)) {
    return "In Chrome: View → Developer → Allow JavaScript from Apple Events, then click Refresh again.";
  }
  return null;
}
