import { NextResponse } from "next/server";
import { z } from "zod";
import { getPriorities, savePriorities } from "@/lib/storage";

export const dynamic = "force-dynamic";

const PrioritySchema = z.object({
  id: z.string().trim().min(1).max(50),
  label: z.string().trim().min(1).max(80),
  rank: z.number().int().min(1).max(99),
  color: z.string().trim().max(20).optional(),
  retired: z.boolean().optional(),
});

const PutSchema = z.object({
  priorities: z.array(PrioritySchema).max(50),
});

export async function GET() {
  const priorities = await getPriorities();
  return NextResponse.json({ priorities });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // Reject duplicate ids — they'd silently clobber each other when
  // tasks look up their label by id.
  const ids = parsed.data.priorities.map((p) => p.id);
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: "duplicate priority ids" }, { status: 400 });
  }
  const priorities = await savePriorities(parsed.data.priorities);
  return NextResponse.json({ priorities });
}
