import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { applySecretsToEnv } from "@/lib/secrets";
import { buildAuthUrl, getRedirectUri } from "@/lib/gcal-auth";

/**
 * Start the Google OAuth flow. Requires GOOGLE_CLIENT_ID to already be
 * saved in secrets (paste it on /settings first). Redirects the browser
 * to Google's consent screen; Google will call our /callback with the code.
 */
export async function GET(req: Request) {
  await applySecretsToEnv();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Save GOOGLE_CLIENT_ID (and GOOGLE_CLIENT_SECRET) in Settings first." },
      { status: 400 },
    );
  }
  const url = new URL(req.url);
  const redirectUri = getRedirectUri(url.origin);
  // Simple CSRF token stored in a cookie for the round-trip.
  const state = randomBytes(16).toString("hex");
  const authUrl = buildAuthUrl(clientId, redirectUri, state);

  const res = NextResponse.redirect(authUrl);
  res.cookies.set("gcal_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
