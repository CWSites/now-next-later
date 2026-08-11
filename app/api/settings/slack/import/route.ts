import { NextResponse } from "next/server";
import { applySecretsToEnv, updateSecrets } from "@/lib/secrets";

/**
 * Bookmarklet-friendly endpoint. Accepts a POST from a Slack tab with the
 * user's active xoxc token (and optionally a matching xoxd cookie), verifies
 * the pair authenticates against Slack, and stores them in
 * secrets.local.json.
 *
 * The `d` cookie on app.slack.com is HttpOnly, so browser-side bookmarklets
 * can't read it. When the body omits xoxd we fall back to the xoxd already in
 * secrets storage — the user pastes it once via the settings UI and the
 * bookmarklet then refreshes only the volatile xoxc half.
 *
 * Cross-origin from slack.com → localhost, so we handle CORS preflight
 * and reflect any *.slack.com origin. Never reflects an arbitrary origin;
 * never returns the saved tokens.
 */

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && /^https:\/\/([a-z0-9-]+\.)*slack\.com$/i.test(origin) ? origin : "";
  if (!allowed) return {};
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    // Chrome's Private Network Access: a public HTTPS page fetching
    // http://localhost must be explicitly opted-in on the target. Without
    // this header the bookmarklet fails with a generic "Failed to fetch".
    "access-control-allow-private-network": "true",
    vary: "origin",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get("origin"));
  const body = (await req.json().catch(() => null)) as
    | { xoxc?: string; xoxd?: string; workspace?: string }
    | null;

  if (!body || typeof body.xoxc !== "string") {
    return NextResponse.json(
      { error: "expected { xoxc, xoxd? }" },
      { status: 400, headers },
    );
  }
  const xoxc = body.xoxc.trim();
  if (!xoxc.startsWith("xoxc-")) {
    return NextResponse.json(
      { error: "xoxc must start with xoxc-" },
      { status: 400, headers },
    );
  }

  // xoxd is optional in the payload — if the bookmarklet couldn't read the
  // HttpOnly `d` cookie, reuse the value the user pasted previously.
  await applySecretsToEnv();
  const bodyXoxd = typeof body.xoxd === "string" ? body.xoxd.trim() : "";
  const rawXoxd = bodyXoxd || (process.env.SLACK_MCP_XOXD_TOKEN ?? "").trim();
  if (!rawXoxd) {
    return NextResponse.json(
      {
        error:
          "no xoxd on record — paste your `d` cookie value into the Slack xoxd cookie field once, then click the bookmarklet again",
      },
      { status: 400, headers },
    );
  }
  // Users typically copy the `d` cookie value straight from Chrome DevTools
  // → Application → Cookies, which shows the percent-encoded form (e.g.
  // "xoxd-abc%2Fdef%3D"). We always re-encode below when building the cookie
  // header, so unless we decode first the outbound header double-encodes and
  // Slack replies invalid_auth. Try both the decoded and raw forms so either
  // paste style works.
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (v: string) => {
    if (v && !seen.has(v)) {
      seen.add(v);
      candidates.push(v);
    }
  };
  if (rawXoxd.includes("%")) {
    try {
      push(decodeURIComponent(rawXoxd));
    } catch {
      // malformed percent-encoding — fall through to the raw value
    }
  }
  push(rawXoxd);

  if (!candidates.some((c) => c.startsWith("xoxd-"))) {
    return NextResponse.json(
      { error: "stored xoxd must start with xoxd-" },
      { status: 400, headers },
    );
  }

  // Verify against Slack before persisting. Try each candidate encoding and
  // keep the first one Slack accepts.
  let auth:
    | {
        ok: boolean;
        error?: string;
        user?: string;
        team?: string;
        url?: string;
      }
    | null = null;
  let xoxd = "";
  const errorsSeen: string[] = [];
  for (const candidate of candidates) {
    if (!candidate.startsWith("xoxd-")) continue;
    const authRes = await fetch("https://slack.com/api/auth.test", {
      headers: {
        authorization: `Bearer ${xoxc}`,
        cookie: `d=${encodeURIComponent(candidate)}`,
        accept: "application/json",
      },
    });
    const parsed = (await authRes.json()) as {
      ok: boolean;
      error?: string;
      user?: string;
      team?: string;
      url?: string;
    };
    if (parsed.ok) {
      auth = parsed;
      xoxd = candidate;
      break;
    }
    errorsSeen.push(parsed.error ?? `http_${authRes.status}`);
  }
  if (!auth || !auth.ok) {
    const err = errorsSeen[0] ?? "unknown";
    const hint =
      err === "invalid_auth"
        ? " — the stored xoxd cookie is stale. In Slack DevTools → Application → Cookies → https://app.slack.com, copy the `d` cookie value and re-paste it into the Slack xoxd cookie field, then click the bookmarklet again."
        : "";
    return NextResponse.json(
      { error: `Slack rejected tokens: ${err}${hint}` },
      { status: 400, headers },
    );
  }

  // Only persist keys the caller actually supplied. If xoxd came from
  // storage, re-writing it is a no-op but keeps the write symmetric when the
  // caller did include a fresh value. When we had to decode a percent-
  // encoded paste, persist the decoded form so future calls skip the retry.
  const updates: Record<string, string> = { SLACK_MCP_XOXC_TOKEN: xoxc };
  if (bodyXoxd) updates.SLACK_MCP_XOXD_TOKEN = xoxd;
  else if (xoxd !== rawXoxd) updates.SLACK_MCP_XOXD_TOKEN = xoxd;
  await updateSecrets(updates);

  return NextResponse.json(
    { ok: true, user: auth.user, team: auth.team, workspaceHint: body.workspace ?? null },
    { headers },
  );
}
