import { NextResponse } from "next/server";
import { z } from "zod";
import { createTask, getAllTasks, getPriorities, REPO_ROOT } from "@/lib/storage";
import { ensurePulled } from "@/lib/git-sync";
import { suggestPriority } from "@/lib/auto-assign-priority";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  title: z.string().min(1).max(500),
  bucket: z.enum(["now", "next", "later"]).optional(),
  notes: z.string().max(5000).optional(),
  url: z
    .string()
    .trim()
    .max(2000)
    .url("url must be a valid URL")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  category: z.string().trim().max(50).optional(),
  priorityId: z.string().trim().max(50).optional(),
});

export async function GET() {
  await ensurePulled(REPO_ROOT);
  const tasks = await getAllTasks();
  return NextResponse.json({ tasks });
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // Only auto-assign when the caller didn't pick a priority themselves.
  // Users typing a task from the Add input never set one; adapters may
  // in future, so we respect any value they pass. Reading-list items
  // (category === "book") are also exempt because a priority badge on a
  // book is just noise.

  let input = parsed.data;
  if (!input.priorityId && input.category !== "book") {
    const priorities = await getPriorities();
    const suggestion = suggestPriority(input, priorities);
    if (suggestion) {
      input = { ...input, priorityId: suggestion.priorityId };
    }
  }
  const task = await createTask(input);
  return NextResponse.json({ task }, { status: 201 });
}
