import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { applySecretsToEnv, updateSecrets } from "@/lib/secrets";
import {
  buildAuthUrl,
  codeChallengeFor,
  generateCodeVerifier,
  getRedirectUri,
  registerClient,
} from "@/lib/fellow-oauth";

/**
 * Kick off the Fellow OAuth flow. If we don't have a client_id yet,
 * dynamically register one and save it. Then redirect the browser to
 * Fellow's authorize endpoint with PKCE.
 *
 * Pass `?reset=1` to discard the stored client_id and refresh token and
 * force a fresh dynamic registration. Use this when Fellow's authorize
 * page shows "Mismatching redirect URI" — that means the previously
 * registered client_id is pinned to a different origin (port change,
 * different hostname, tunnel, etc.) and needs to be re-registered against
 * the current one.
 */
export async function GET(req: Request) {
  await applySecretsToEnv();
  const url = new URL(req.url);
  const redirectUri = getRedirectUri(url.origin);
  const reset = url.searchParams.get("reset") === "1";

  if (reset) {
    // Clear both the registration and any tokens tied to it. The refresh
    // token was issued to the old client_id so it's useless once we re-
    // register anyway.
    await updateSecrets({ FELLOW_CLIENT_ID: "", FELLOW_REFRESH_TOKEN: "" });
    delete process.env.FELLOW_CLIENT_ID;
    delete process.env.FELLOW_REFRESH_TOKEN;
  }

  let clientId = process.env.FELLOW_CLIENT_ID;
  if (!clientId) {
    try {
      const reg = await registerClient(redirectUri);
      clientId = reg.client_id;
      await updateSecrets({ FELLOW_CLIENT_ID: clientId });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  const state = randomBytes(16).toString("hex");
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = codeChallengeFor(codeVerifier);
  const authUrl = buildAuthUrl(clientId, redirectUri, state, codeChallenge);

  const res = NextResponse.redirect(authUrl);
  // Both state and code_verifier travel through a cookie because the
  // authorize round-trip goes via Fellow (which won't preserve state
  // for us). httpOnly + short-lived so nothing else can read them.
  res.cookies.set("fellow_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  res.cookies.set("fellow_oauth_verifier", codeVerifier, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
