import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteTask, updateTask } from "@/lib/storage";

const UpdateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  notes: z.string().max(5000).nullable().optional(),
  bucket: z.enum(["now", "next", "later"]).optional(),
  completed: z.boolean().optional(),
  archived: z.boolean().optional(),
  position: z.number().int().nonnegative().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const task = await updateTask(id, parsed.data);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ task });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteTask(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
