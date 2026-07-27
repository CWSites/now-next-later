import { NextResponse } from "next/server";
import { applySecretsToEnv, updateSecrets } from "@/lib/secrets";

/**
 * Bookmarklet-friendly endpoint. Accepts a POST from a Slack tab with the
 * user's active xoxc/xoxd pair, verifies they authenticate against Slack,
 * and stores them in secrets.local.json.
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

  if (!body || typeof body.xoxc !== "string" || typeof body.xoxd !== "string") {
    return NextResponse.json(
      { error: "expected { xoxc, xoxd }" },
      { status: 400, headers },
    );
  }
  const xoxc = body.xoxc.trim();
  const xoxd = body.xoxd.trim();
  if (!xoxc.startsWith("xoxc-") || !xoxd.startsWith("xoxd-")) {
    return NextResponse.json(
      { error: "tokens must start with xoxc- and xoxd-" },
      { status: 400, headers },
    );
  }

  // Verify against Slack before persisting.
  const authRes = await fetch("https://slack.com/api/auth.test", {
    headers: {
      authorization: `Bearer ${xoxc}`,
      cookie: `d=${encodeURIComponent(xoxd)}`,
      accept: "application/json",
    },
  });
  const auth = (await authRes.json()) as {
    ok: boolean;
    error?: string;
    user?: string;
    team?: string;
    url?: string;
  };
  if (!auth.ok) {
    return NextResponse.json(
      { error: `Slack rejected tokens: ${auth.error ?? "unknown"}` },
      { status: 400, headers },
    );
  }

  await applySecretsToEnv();
  await updateSecrets({
    SLACK_MCP_XOXC_TOKEN: xoxc,
    SLACK_MCP_XOXD_TOKEN: xoxd,
  });

  return NextResponse.json(
    { ok: true, user: auth.user, team: auth.team, workspaceHint: body.workspace ?? null },
    { headers },
  );
}
