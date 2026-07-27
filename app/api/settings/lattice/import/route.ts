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

async function verifyLatticeCookie(cookie: string): Promise<{ ok: boolean; user?: string; error?: string }> {
  const res = await fetch("https://app.latticehq.com/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      cookie,
    },
    body: JSON.stringify({
      query: "query WhoAmI { me { id name email } }",
    }),
  });
  if (!res.ok) {
    return { ok: false, error: `graphql HTTP ${res.status}` };
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
  const body = (await req.json().catch(() => null)) as { cookie?: string } | null;

  if (!body || typeof body.cookie !== "string" || body.cookie.trim().length === 0) {
    return NextResponse.json({ error: "expected { cookie }" }, { status: 400, headers });
  }
  const cookie = body.cookie.trim();

  const check = await verifyLatticeCookie(cookie);
  if (!check.ok) {
    return NextResponse.json(
      { error: check.error ?? "Lattice rejected the session cookie" },
      { status: 400, headers },
    );
  }

  await applySecretsToEnv();
  await updateSecrets({ LATTICE_COOKIE: cookie });
  return NextResponse.json({ ok: true, user: check.user }, { headers });
}
