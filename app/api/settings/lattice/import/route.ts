import { NextResponse } from "next/server";
import { applySecretsToEnv, updateSecrets } from "@/lib/secrets";

/**
 * Bookmarklet-friendly endpoint. Accepts a POST from a Lattice tab with
 * the user's active session cookies, verifies them by running the "me"
 * GraphQL query, and stores the cookie header in secrets.local.json.
 *
 * Cross-origin from app.latticehq.com → localhost, so we handle CORS
 * preflight and reflect only *.latticehq.com origins.
 */

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && /^https:\/\/([a-z0-9-]+\.)*latticehq\.com$/i.test(origin) ? origin : "";
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

async function verifyLatticeCookie(
  cookie: string,
  graphqlOrigin: string,
): Promise<{ ok: boolean; user?: string; error?: string }> {
  const url = `${graphqlOrigin.replace(/\/+$/, "")}/graphql`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      cookie,
      // Some GraphQL servers require an Origin header on cross-origin
      // requests; sending the workspace's own origin keeps us honest.
      origin: graphqlOrigin,
      referer: `${graphqlOrigin}/`,
    },
    body: JSON.stringify({
      query: "query WhoAmI { me { id name email } }",
    }),
  });
  if (!res.ok) {
    return { ok: false, error: `${url} → HTTP ${res.status}` };
  }
  const data = (await res.json()) as {
    data?: { me?: { id?: string; name?: string; email?: string } };
    errors?: Array<{ message: string }>;
  };
  if (data.errors?.length) {
    return { ok: false, error: data.errors[0].message.slice(0, 120) };
  }
  const me = data.data?.me;
  if (!me?.id) {
    return { ok: false, error: "graphql returned no me.id" };
  }
  return { ok: true, user: me.name ?? me.email ?? me.id };
}

export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get("origin"));
  const body = (await req.json().catch(() => null)) as {
    cookie?: string;
    graphqlOrigin?: string;
  } | null;

  if (!body || typeof body.cookie !== "string" || body.cookie.trim().length === 0) {
    return NextResponse.json({ error: "expected { cookie, graphqlOrigin }" }, { status: 400, headers });
  }
  const cookie = body.cookie.trim();
  // Fall back to app.latticehq.com if the bookmarklet is an older version.
  const graphqlOrigin =
    (typeof body.graphqlOrigin === "string" && body.graphqlOrigin.trim()) ||
    "https://app.latticehq.com";

  // Only accept origins under latticehq.com so a malicious page can't get us
  // to POST cookies to arbitrary hosts.
  if (!/^https:\/\/([a-z0-9-]+\.)*latticehq\.com$/i.test(graphqlOrigin)) {
    return NextResponse.json(
      { error: `graphqlOrigin must be a *.latticehq.com URL, got ${graphqlOrigin}` },
      { status: 400, headers },
    );
  }

  const check = await verifyLatticeCookie(cookie, graphqlOrigin);
  if (!check.ok) {
    return NextResponse.json(
      { error: check.error ?? "Lattice rejected the session cookie" },
      { status: 400, headers },
    );
  }

  await applySecretsToEnv();
  await updateSecrets({
    LATTICE_COOKIE: cookie,
    LATTICE_GRAPHQL_ORIGIN: graphqlOrigin,
  });
  return NextResponse.json({ ok: true, user: check.user, graphqlOrigin }, { headers });
}
