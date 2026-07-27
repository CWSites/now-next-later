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
 */
export async function GET(req: Request) {
  await applySecretsToEnv();
  const url = new URL(req.url);
  const redirectUri = getRedirectUri(url.origin);

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
