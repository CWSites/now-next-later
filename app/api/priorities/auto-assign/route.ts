import { NextResponse } from "next/server";
import { z } from "zod";
import { getAllTasks, getPriorities, updateTask } from "@/lib/storage";
import { suggestPriority } from "@/lib/auto-assign-priority";

export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    /** When true, re-score tasks that already have a priorityId and
     *  overwrite only if a *different* priority scores strictly higher
     *  than the current one's keywords. Defaults to false so the
     *  button is a safe sweep. */
    overwrite: z.boolean().optional(),
    /** Dry-run — compute assignments without writing. */
    dryRun: z.boolean().optional(),
  })
  .default({});

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { overwrite = false, dryRun = false } = parsed.data;

  const [tasks, priorities] = await Promise.all([getAllTasks(), getPriorities()]);
  if (priorities.length === 0) {
    return NextResponse.json({ assigned: 0, considered: 0, assignments: [] });
  }

  const assignments: Array<{
    id: string;
    title: string;
    priorityId: string;
    score: number;
    evidence: string[];
    previousPriorityId?: string;
  }> = [];

  let considered = 0;
  for (const t of tasks) {
    // Skip completed/archived tasks — rescoring stale items creates
    // noise and risks dragging historical work into current priorities.
    if (t.completed || t.archived) continue;
    if (t.priorityId && !overwrite) continue;
    considered++;

    const suggestion = suggestPriority(t, priorities);
    if (!suggestion) continue;
    if (t.priorityId === suggestion.priorityId) continue;

    assignments.push({
      id: t.id,
      title: t.title,
      priorityId: suggestion.priorityId,
      score: suggestion.score,
      evidence: suggestion.evidence,
      previousPriorityId: t.priorityId,
    });
  }

  if (!dryRun) {
    // Serial writes — tasks.json access is serialized inside storage
    // anyway, so firing in parallel wouldn't help and would make error
    // reporting messier.
    for (const a of assignments) {
      await updateTask(a.id, { priorityId: a.priorityId });
    }
  }

  return NextResponse.json({
    assigned: assignments.length,
    considered,
    dryRun,
    assignments,
  });
}
