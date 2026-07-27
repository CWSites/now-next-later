import { NextResponse } from "next/server";
import { applySecretsToEnv, updateSecrets } from "@/lib/secrets";
import { exchangeCodeForTokens, getRedirectUri } from "@/lib/fellow-oauth";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const cookies = new Map(
    (req.headers.get("cookie") ?? "")
      .split(";")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const eq = c.indexOf("=");
        return [c.slice(0, eq), c.slice(eq + 1)];
      }),
  );
  const cookieState = cookies.get("fellow_oauth_state");
  const codeVerifier = cookies.get("fellow_oauth_verifier");

  const settingsUrl = new URL("/settings", url.origin);

  function bounce(status: string): NextResponse {
    settingsUrl.searchParams.set("fellow", status);
    const res = NextResponse.redirect(settingsUrl);
    // Clear round-trip cookies.
    res.cookies.set("fellow_oauth_state", "", { path: "/", maxAge: 0 });
    res.cookies.set("fellow_oauth_verifier", "", { path: "/", maxAge: 0 });
    return res;
  }

  if (error) return bounce(`error:${error}`);
  if (!code) return bounce("error:missing-code");
  if (!state || !cookieState || state !== cookieState) return bounce("error:state-mismatch");
  if (!codeVerifier) return bounce("error:missing-verifier");

  await applySecretsToEnv();
  const clientId = process.env.FELLOW_CLIENT_ID;
  if (!clientId) return bounce("error:missing-client-id");

  try {
    const redirectUri = getRedirectUri(url.origin);
    const tokens = await exchangeCodeForTokens(code, clientId, redirectUri, codeVerifier);
    if (!tokens.refresh_token) return bounce("error:no-refresh-token");
    await updateSecrets({ FELLOW_REFRESH_TOKEN: tokens.refresh_token });
    return bounce("connected");
  } catch (err) {
    return bounce(`error:${(err as Error).message.slice(0, 80)}`);
  }
}
