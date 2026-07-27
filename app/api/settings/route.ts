import { NextResponse } from "next/server";
import { getSecretsView, updateSecrets } from "@/lib/secrets";

export async function GET() {
  const settings = await getSecretsView();
  return NextResponse.json({ settings });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { updates?: Record<string, string> };
  if (!body?.updates || typeof body.updates !== "object") {
    return NextResponse.json({ error: "expected { updates: {...} }" }, { status: 400 });
  }
  await updateSecrets(body.updates);
  const settings = await getSecretsView();
  return NextResponse.json({ settings });
}
