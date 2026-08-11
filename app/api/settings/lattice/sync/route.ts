import { NextResponse } from "next/server";
import { deleteByExternalId, getAllTasks, upsertByExternalId } from "@/lib/storage";
import { applySecretsToEnv, updateSecrets } from "@/lib/secrets";
import { similarity } from "@/lib/action-dedup-heuristic";
import type { Bucket, Task } from "@/lib/types";

const DUP_THRESHOLD = 0.5;

/**
 * Same rule as ingest/run.ts::shouldSkipAsDuplicate: don't create a new
 * task if there's already a live task that means the same thing. Prevents
 * bookmarklet syncs from duplicating morning-brief seeds or manual tasks.
 */
function findSemanticDup(
  incoming: { title: string; externalId?: string },
  existing: Task[],
  opts?: { includeCompleted?: boolean },
): Task | null {
  let best: { task: Task; score: number } | null = null;
  for (const t of existing) {
    if (t.externalId === incoming.externalId) continue;
    if (!opts?.includeCompleted && t.completed) continue;
    const score = similarity(t.title, incoming.title);
    if (score < DUP_THRESHOLD) continue;
    if (!best || score > best.score) best = { task: t, score };
  }
  return best?.task ?? null;
}

/**
 * Bookmarklet-driven Lattice sync.
 *
 * Because Lattice's session cookies are HttpOnly (JS on the page can't
 * read them), the *browser* has to run the actual GraphQL query — where
 * the browser attaches those cookies automatically. This endpoint just
 * accepts the already-extracted action items and merges them into the
 * task store, same way an adapter's ingest() result would.
 *
 * Trust boundary: we only accept requests whose Origin is a *.latticehq.com
 * tab, and we clamp/validate every field before persisting.
 */

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && /^https:\/\/([a-z0-9-]+\.)*latticehq\.com$/i.test(origin) ? origin : "";
  if (!allowed) return {};
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    // Chrome's Private Network Access: a public HTTPS page fetching
    // http://localhost must be explicitly opted-in on the target. Without
    // this header the bookmarklet fails with a generic "Failed to fetch".
    "access-control-allow-private-network": "true",
    vary: "origin",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

interface IncomingItem {
  externalId?: string;
  title?: string;
  sourceRef?: string;
  url?: string;
  bucket?: string;
}

const VALID_BUCKETS: Bucket[] = ["now", "next", "later"];

export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get("origin"));
  if (Object.keys(headers).length === 0) {
    return NextResponse.json({ error: "origin not allowed" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    items?: IncomingItem[];
    who?: string;
  } | null;
  if (!body || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "expected { items: [...] }" }, { status: 400, headers });
  }

  // Validate + normalize incoming items.
  const clean: {
    externalId: string;
    title: string;
    bucket: Bucket;
    sourceRef?: string;
    url?: string;
  }[] = [];
  const { decodeHtmlEntities } = await import("@/lib/decode-html");
  for (const raw of body.items) {
    if (!raw || typeof raw !== "object") continue;
    const externalId = String(raw.externalId ?? "").trim();
    // Lattice's GraphQL payload delivers action-item text with HTML
    // entities (`&amp;`, `&#39;`, `&gt;`, ...) still encoded. Decode at
    // ingest so stored titles are clean going forward. Length check
    // uses the *decoded* text since that's what the user sees.
    const title = decodeHtmlEntities(String(raw.title ?? "").trim());
    if (!externalId.startsWith("lattice:action:") || !title) continue;
    if (externalId.length > 200 || title.length > 500) continue;
    const bucket = (VALID_BUCKETS as string[]).includes(raw.bucket ?? "")
      ? (raw.bucket as Bucket)
      : "next";
    clean.push({
      externalId,
      title,
      bucket,
      sourceRef:
        typeof raw.sourceRef === "string"
          ? decodeHtmlEntities(raw.sourceRef).slice(0, 300)
          : undefined,
      url:
        typeof raw.url === "string" && /^https?:\/\//.test(raw.url)
          ? raw.url.slice(0, 500)
          : undefined,
    });
  }

  const incomingIds = new Set(clean.map((i) => i.externalId));

  await applySecretsToEnv();

  // Snapshot once so all incoming items compare against the same baseline.
  const preSync = await getAllTasks();

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const item of clean) {
    const alreadyLinked = preSync.some((t) => t.externalId === item.externalId);
    if (!alreadyLinked) {
      const dup = findSemanticDup(item, preSync, { includeCompleted: true });
      if (dup) {
        // A task (live or completed) already covers this commitment.
        // Including completed tasks prevents re-creating items the user
        // already finished — Lattice recurring 1:1s often re-surface the
        // same action item with a different externalId.
        skipped++;
        continue;
      }
    }
    const { created: wasCreated, tombstoned } = await upsertByExternalId({
      externalId: item.externalId,
      title: item.title,
      bucket: item.bucket,
      source: "lattice",
      sourceRef: item.sourceRef,
      url: item.url,
    });
    if (tombstoned) {
      skipped++;
      continue;
    }
    if (wasCreated) created++;
    else updated++;
  }

  // Remove any Lattice action tasks that weren't in the current sync —
  // they've either been completed on Lattice's side or reassigned to
  // someone else. deleteByExternalId honors the checked-off guard, so a
  // task the user has already marked complete stays as history.
  // Also skip items the user has re-categorized (e.g. moved to Reading
  // List) — that's a signal they've claimed the task and it shouldn't
  // be auto-removed just because Lattice no longer surfaces it.
  const existing = await getAllTasks();
  let removed = 0;
  for (const t of existing) {
    const eid = t.externalId ?? "";
    if (!eid.startsWith("lattice:action:")) continue;
    if (incomingIds.has(eid)) continue;
    if (t.category) continue;
    const { deleted } = await deleteByExternalId(eid, { source: "lattice" });
    if (deleted) removed++;
  }

  const syncedAt = new Date().toISOString();
  try {
    await updateSecrets({ LATTICE_LAST_SYNCED_AT: syncedAt });
  } catch {
    // last-synced is metadata — persistence is best-effort.
  }

  return NextResponse.json(
    {
      ok: true,
      received: body.items.length,
      accepted: clean.length,
      created,
      updated,
      removed,
      skipped,
      syncedAt,
      who: body.who ?? null,
    },
    { headers },
  );
}
