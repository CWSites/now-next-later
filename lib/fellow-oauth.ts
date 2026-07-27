import "server-only";
import { randomBytes, createHash } from "node:crypto";

/**
 * OAuth 2.0 helpers for Fellow's MCP server.
 *
 * Fellow implements the standard MCP hosted-server auth pattern:
 *   - Discovery at /.well-known/oauth-authorization-server
 *   - Dynamic client registration (RFC 7591) with token_endpoint_auth_method=none
 *   - Authorization code + PKCE (S256), refresh_token grant
 *
 * We register once (storing the resulting client_id), then run the code
 * flow with PKCE. Refresh token is persisted in secrets.local.json and
 * exchanged for a fresh access token on each ingest.
 */

export const FELLOW_MCP_URL = "https://fellow.app/mcp";
export const FELLOW_ISSUER = "https://fellow.app";
export const FELLOW_SCOPES = [
  "read_action_items",
  "read_meeting_content",
  "read_calendar",
];

// Hardcoded endpoints (verified from /.well-known/oauth-authorization-server).
// If Fellow ever moves these, swap to discovering them at runtime.
export const FELLOW_ENDPOINTS = {
  authorize: "https://fellow.app/mcp/authorize",
  token: "https://fellow.app/mcp/token",
  register: "https://fellow.app/mcp/register",
};

export function getRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/settings/fellow/callback`;
}

/** RFC 7636 PKCE code_verifier: 43-128 unreserved chars. */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function codeChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Register a public OAuth client with Fellow. Called once and the returned
 * client_id is persisted so we can reuse it across sessions.
 */
export async function registerClient(redirectUri: string): Promise<{ client_id: string }> {
  const res = await fetch(FELLOW_ENDPOINTS.register, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "now-next-later (local)",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: FELLOW_SCOPES.join(" "),
    }),
  });
  if (!res.ok) {
    throw new Error(`Fellow client registration failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { client_id: string };
  if (!data.client_id) throw new Error("Fellow registration returned no client_id.");
  return { client_id: data.client_id };
}

export function buildAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: FELLOW_SCOPES.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${FELLOW_ENDPOINTS.authorize}?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
}

export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const res = await fetch(FELLOW_ENDPOINTS.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`Fellow token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
): Promise<string> {
  const res = await fetch(FELLOW_ENDPOINTS.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });
  if (!res.ok) {
    throw new Error(`Fellow token refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  if (!data.access_token) throw new Error("Fellow refresh returned no access_token.");
  return data.access_token;
}
