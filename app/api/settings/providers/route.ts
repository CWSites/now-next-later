import { NextResponse } from "next/server";
import {
  applySecretsToEnv,
  getDisabledProviders,
  PROVIDERS,
  setProviderDisabled,
  type Provider,
} from "@/lib/secrets";

/**
 * Per-provider enable/disable toggle.
 *
 * GET  → { disabled: Provider[] } — current disabled set.
 * POST → { provider, disabled } body; returns updated { disabled: Provider[] }.
 *
 * Disabled providers are skipped by the ingest loop and the connection test
 * matrix, so a user can silence a known-broken provider (e.g. Granola API
 * access gated by workspace admin) without wiping credentials they'll want
 * back later.
 */

const VALID = new Set(PROVIDERS.map((p) => p.id));

export async function GET() {
  await applySecretsToEnv();
  return NextResponse.json({ disabled: Array.from(getDisabledProviders()) });
}

export async function POST(req: Request) {
  await applySecretsToEnv();
  const body = (await req.json().catch(() => null)) as
    | { provider?: string; disabled?: boolean }
    | null;
  if (!body || typeof body.provider !== "string" || typeof body.disabled !== "boolean") {
    return NextResponse.json(
      { error: "expected { provider: string, disabled: boolean }" },
      { status: 400 },
    );
  }
  const provider = body.provider.toLowerCase();
  if (!VALID.has(provider as Provider)) {
    return NextResponse.json(
      { error: `unknown provider '${provider}'. Valid: ${Array.from(VALID).join(", ")}.` },
      { status: 400 },
    );
  }
  const updated = await setProviderDisabled(provider as Provider, body.disabled);
  return NextResponse.json({ disabled: Array.from(updated) });
}
