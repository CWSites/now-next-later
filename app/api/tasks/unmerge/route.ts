import { NextResponse } from "next/server";
import { z } from "zod";
import { unmergeTasks } from "@/lib/storage";

const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  bucket: z.string(),
  notes: z.string().optional(),
  url: z.string().optional(),
  source: z.string().optional(),
  sourceRef: z.string().optional(),
  externalId: z.string().optional(),
  completed: z.boolean().optional(),
  completedAt: z.string().optional(),
  archived: z.boolean().optional(),
  updatedAt: z.string().optional(),
});

const UnmergeSchema = z.object({
  snapshot: z.object({
    source: TaskSchema,
    target: TaskSchema,
  }),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = UnmergeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const result = await unmergeTasks(parsed.data.snapshot as Parameters<typeof unmergeTasks>[0]);
  if (!result.undone) {
    return NextResponse.json(
      { error: result.reason ?? "undo failed" },
      { status: 404 },
    );
  }
  return NextResponse.json({ undone: true });
}
