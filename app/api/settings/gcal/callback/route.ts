import { NextResponse } from "next/server";
import { applySecretsToEnv, updateSecrets } from "@/lib/secrets";
import { exchangeCodeForTokens, getRedirectUri } from "@/lib/gcal-auth";

/**
 * OAuth callback: exchange the ?code for tokens and stash the refresh_token
 * into secrets.local.json. Then bounce back to /settings.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const cookieState = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("gcal_oauth_state="))
    ?.split("=")[1];

  const settingsUrl = new URL("/settings", url.origin);

  if (error) {
    settingsUrl.searchParams.set("gcal", `error:${error}`);
    return NextResponse.redirect(settingsUrl);
  }
  if (!code) {
    settingsUrl.searchParams.set("gcal", "error:missing-code");
    return NextResponse.redirect(settingsUrl);
  }
  if (!state || !cookieState || state !== cookieState) {
    settingsUrl.searchParams.set("gcal", "error:state-mismatch");
    return NextResponse.redirect(settingsUrl);
  }

  await applySecretsToEnv();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    settingsUrl.searchParams.set("gcal", "error:missing-client-config");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const redirectUri = getRedirectUri(url.origin);
    const tokens = await exchangeCodeForTokens(code, clientId, clientSecret, redirectUri);
    if (!tokens.refresh_token) {
      settingsUrl.searchParams.set("gcal", "error:no-refresh-token");
      return NextResponse.redirect(settingsUrl);
    }
    await updateSecrets({ GOOGLE_REFRESH_TOKEN: tokens.refresh_token });
    settingsUrl.searchParams.set("gcal", "connected");
  } catch (err) {
    settingsUrl.searchParams.set("gcal", `error:${(err as Error).message.slice(0, 80)}`);
  }

  const res = NextResponse.redirect(settingsUrl);
  // Clear the state cookie.
  res.cookies.set("gcal_oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}
