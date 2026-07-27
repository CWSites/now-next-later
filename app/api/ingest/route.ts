import { NextResponse } from "next/server";
import { runIngest } from "@/ingest/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const summary = await runIngest();
  return NextResponse.json(summary);
}
