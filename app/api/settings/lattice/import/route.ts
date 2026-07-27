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
    storage?: Record<string, string>;
    probeUser?: { id?: string; name?: string; email?: string };
  } | null;

  if (!body || typeof body.graphqlOrigin !== "string") {
    return NextResponse.json({ error: "expected { graphqlOrigin, cookie? }" }, { status: 400, headers });
  }
  const cookie = (body.cookie ?? "").trim();
  const graphqlOrigin = body.graphqlOrigin.trim() || "https://app.latticehq.com";

  if (!/^https:\/\/([a-z0-9-]+\.)*latticehq\.com$/i.test(graphqlOrigin)) {
    return NextResponse.json(
      { error: `graphqlOrigin must be a *.latticehq.com URL, got ${graphqlOrigin}` },
      { status: 400, headers },
    );
  }

  // Try to auth server-side with what we've got. If it fails and the browser
  // itself just succeeded (probeUser is set), we know the reason: Lattice's
  // session cookies are HttpOnly, so document.cookie can't see them.
  const check = await verifyLatticeCookie(cookie, graphqlOrigin);
  if (!check.ok) {
    const hint =
      body.probeUser?.id
        ? `Your browser CAN auth (as ${body.probeUser.name ?? body.probeUser.email ?? body.probeUser.id}) but the server cannot. That means Lattice's session cookies are HttpOnly and JS on the page can't read them — a security setting on Lattice's side we can't bypass. See the alternative below.`
        : "Neither the browser nor the server could authenticate. Are you actually signed in?";
    // Storage sweep never turned up anything JWT-looking?
    const storageKeys = Object.keys(body.storage ?? {});
    return NextResponse.json(
      {
        error: check.error ?? "Lattice rejected the session cookie",
        hint,
        cookieVisibleToJs: cookie.length,
        interestingStorageKeys: storageKeys,
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
