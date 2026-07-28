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
      "content-type": "application/json; charset=utf-8",
      accept: "application/json",
      cookie,
      origin: graphqlOrigin,
      referer: `${graphqlOrigin}/`,
      "x-lattice-deployment": "us-prod-1",
      "x-lattice-is-real-company": "true",
      "x-lattice-market-segment": "smb_high",
      "x-timezone": "America/New_York",
    },
    body: JSON.stringify({
      query: `query NnlProbe { viewer { user { name email entityId } } }`,
    }),
  });
  if (!res.ok) return { ok: false, error: `${url} → HTTP ${res.status}` };
  const data = (await res.json()) as {
    data?: { viewer?: { user?: { name?: string; email?: string; entityId?: string } } };
    errors?: Array<{ message: string }>;
  };
  if (data.errors?.length) return { ok: false, error: data.errors[0].message.slice(0, 160) };
  const user = data.data?.viewer?.user;
  if (!user?.entityId) return { ok: false, error: "viewer.user empty — JWT may already be expired" };
  return { ok: true, user: user.name ?? user.email ?? user.entityId };
}

export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get("origin"));
  const body = (await req.json().catch(() => null)) as {
    cookie?: string;
    graphqlOrigin?: string;
    probeUser?: { entityId?: string; name?: string; email?: string };
  } | null;

  if (!body || typeof body.graphqlOrigin !== "string") {
    return NextResponse.json({ error: "expected { graphqlOrigin, cookie }" }, { status: 400, headers });
  }
  const cookie = (body.cookie ?? "").trim();
  const graphqlOrigin = body.graphqlOrigin.trim() || "https://app.latticehq.com";

  if (!/^https:\/\/([a-z0-9-]+\.)*latticehq\.com$/i.test(graphqlOrigin)) {
    return NextResponse.json(
      { error: `graphqlOrigin must be a *.latticehq.com URL, got ${graphqlOrigin}` },
      { status: 400, headers },
    );
  }

  const check = await verifyLatticeCookie(cookie, graphqlOrigin);
  if (!check.ok) {
    const probe = body.probeUser;
    const probeId = probe?.entityId;
    const hint = probeId
      ? `Your browser CAN auth (as ${probe?.name ?? probe?.email ?? probeId}) but the server cannot. That usually means the session cookies Lattice actually uses are HttpOnly — JS on the page can't read them, so we can't relay them to the server.`
      : "Neither the browser nor the server could authenticate. Sign in and retry.";
    return NextResponse.json(
      {
        error: check.error ?? "Lattice rejected the session cookie",
        hint,
        cookieVisibleToJs: cookie.length,
      },
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
