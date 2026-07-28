import { NextResponse } from "next/server";
import { z } from "zod";
import { mergeTasks } from "@/lib/storage";

/**
 * Merge one task into another. `sourceId` is folded into `targetId` and
 * then deleted; the target keeps its position and any user-set state so
 * the row the user dropped onto is the one that survives.
 */
const MergeSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = MergeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { sourceId, targetId } = parsed.data;
  const result = await mergeTasks(sourceId, targetId);
  if (!result.merged) {
    return NextResponse.json(
      { error: result.reason ?? "merge failed" },
      { status: result.reason === "not-found" ? 404 : 400 },
    );
  }
  return NextResponse.json({ task: result.task });
}
