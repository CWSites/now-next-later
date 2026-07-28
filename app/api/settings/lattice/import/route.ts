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
  meField: string,
): Promise<{ ok: boolean; user?: string; error?: string }> {
  const url = `${graphqlOrigin.replace(/\/+$/, "")}/graphql`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      cookie,
      origin: graphqlOrigin,
      referer: `${graphqlOrigin}/`,
    },
    body: JSON.stringify({
      query: `query WhoAmI { ${meField} { id name email } }`,
    }),
  });
  if (!res.ok) return { ok: false, error: `${url} → HTTP ${res.status}` };
  const data = (await res.json()) as {
    data?: Record<string, { id?: string; name?: string; email?: string } | null>;
    errors?: Array<{ message: string }>;
  };
  // Some User types may not expose name/email at the top level; retry with
  // just id to at least confirm auth.
  if (data.errors?.length) {
    const narrow = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        cookie,
        origin: graphqlOrigin,
        referer: `${graphqlOrigin}/`,
      },
      body: JSON.stringify({ query: `query WhoAmI { ${meField} { id } }` }),
    });
    const nBody = (await narrow.json()) as {
      data?: Record<string, { id?: string } | null>;
      errors?: Array<{ message: string }>;
    };
    if (nBody.errors?.length) return { ok: false, error: nBody.errors[0].message.slice(0, 120) };
    if (nBody.data?.[meField]?.id) return { ok: true, user: nBody.data[meField]!.id };
    return { ok: false, error: `${meField} returned no id` };
  }
  const me = data.data?.[meField];
  if (!me?.id) return { ok: false, error: `${meField} returned no id` };
  return { ok: true, user: me.name ?? me.email ?? me.id };
}

export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get("origin"));
  const body = (await req.json().catch(() => null)) as {
    cookie?: string;
    graphqlOrigin?: string;
    meField?: string;
    storage?: Record<string, string>;
    probeUser?: { id?: string; name?: string; email?: string };
  } | null;

  if (!body || typeof body.graphqlOrigin !== "string") {
    return NextResponse.json({ error: "expected { graphqlOrigin, cookie? }" }, { status: 400, headers });
  }
  const cookie = (body.cookie ?? "").trim();
  const graphqlOrigin = body.graphqlOrigin.trim() || "https://app.latticehq.com";
  const meField = (body.meField ?? "me").trim() || "me";

  if (!/^https:\/\/([a-z0-9-]+\.)*latticehq\.com$/i.test(graphqlOrigin)) {
    return NextResponse.json(
      { error: `graphqlOrigin must be a *.latticehq.com URL, got ${graphqlOrigin}` },
      { status: 400, headers },
    );
  }
  // meField comes from browser-side introspection; guard against injection
  // by allowing only ASCII identifier chars.
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,64}$/.test(meField)) {
    return NextResponse.json({ error: `invalid meField: ${meField}` }, { status: 400, headers });
  }

  const check = await verifyLatticeCookie(cookie, graphqlOrigin, meField);
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
    LATTICE_ME_FIELD: meField,
  });
  return NextResponse.json({ ok: true, user: check.user, graphqlOrigin, meField }, { headers });
}
