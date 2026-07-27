import { NextResponse } from "next/server";
import { z } from "zod";
import { createTask, getAllTasks, REPO_ROOT } from "@/lib/storage";
import { ensurePulled } from "@/lib/git-sync";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  title: z.string().min(1).max(500),
  bucket: z.enum(["now", "next", "later"]).optional(),
  notes: z.string().max(5000).optional(),
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
  const task = await createTask(parsed.data);
  return NextResponse.json({ task }, { status: 201 });
}
