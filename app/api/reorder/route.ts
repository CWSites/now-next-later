import { NextResponse } from "next/server";
import { z } from "zod";
import { reorderBucket } from "@/lib/storage";

const ReorderSchema = z.object({
  bucket: z.enum(["now", "next", "later"]),
  orderedIds: z.array(z.string().uuid()),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = ReorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const tasks = await reorderBucket(parsed.data.bucket, parsed.data.orderedIds);
  return NextResponse.json({ tasks });
}
