import type { Adapter, AdapterIngestResult, IngestItem } from "./base";
import { extractActionItems, isMine } from "@/lib/granola-extract";
import { dedupHeuristically } from "@/lib/action-dedup-heuristic";

/**
 * Granola adapter.
 *
 * Rather than surfacing "review notes" placeholders, this adapter fetches
 * each recent note's full body and extracts action items directly. The
 * heavy lifting lives in lib/granola-extract.ts; here we handle:
 *   - listing recent notes (skipping ones whose title matches the skip list)
 *   - fetching each note's full markdown
 *   - filtering extracted actions to ones assigned to me / unassigned
 *   - upserting stable externalIds so re-runs don't duplicate
 *   - retiring old `granola:note:*` fallback tasks now that we're extracting
 */

const API = "https://public-api.granola.ai/v1";

interface GranolaNoteMeta {
  id: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  owner?: { name?: string; email?: string };
}

interface GranolaNoteFull extends GranolaNoteMeta {
  web_url?: string;
  summary_markdown?: string;
  summary_text?: string;
  calendar_event?: { event_title?: string; scheduled_start_time?: string };
}

export const granolaAdapter: Adapter = {
  name: "granola",

  enabled() {
    return Boolean(process.env.GRANOLA_API_KEY);
  },

  disabledReason() {
    return "Paste GRANOLA_API_KEY in Settings (Granola app → Settings → API keys).";
  },

  async ingest(): Promise<AdapterIngestResult> {
    const token = process.env.GRANOLA_API_KEY!;
    const skipTitles = (process.env.GRANOLA_SKIP_TITLES ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    // 1) list recent notes (metadata only, no body)
    const listRes = await fetch(`${API}/notes?limit=50`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!listRes.ok) {
      throw new Error(
        `Granola /notes failed: ${listRes.status} ${(await listRes.text()).slice(0, 200)}`,
      );
    }
    const listData = (await listRes.json()) as {
      notes?: GranolaNoteMeta[];
      data?: GranolaNoteMeta[];
    };
    const notes = listData.notes ?? listData.data ?? [];

    // Restrict to the recent window so we don't hit N-per-note calls on a
    // whole archive. Granola's list returns newest first; 14 days is enough
    // to catch anything still active.
    const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
    const recent = notes.filter((n) => {
      const t = new Date(n.updated_at ?? n.created_at ?? 0).getTime();
      if (Number.isNaN(t)) return true;
      return t >= cutoff;
    });

    // Identity for "is this action item mine?" comparisons. The first note's
    // owner is always the authenticated user (Granola's /notes only returns
    // notes you own or are a member of, and owner reflects the note holder).
    const meOwner = recent.find((n) => n.owner?.name)?.owner;
    const myNames = [meOwner?.name, meOwner?.email?.split("@")[0]]
      .filter((s): s is string => Boolean(s))
      .flatMap((s) => [s, s.split(/\s+/)[0]]);

    const items: IngestItem[] = [];
    const removedExternalIds: string[] = [];

    for (const meta of recent) {
      const title = meta.title ?? "(untitled note)";
      const lowerTitle = title.toLowerCase();
      if (skipTitles.some((s) => lowerTitle.includes(s))) {
        // Also retire the old-shape fallback task if we had one for this note.
        removedExternalIds.push(`granola:note:${meta.id}`);
        continue;
      }

      // 2) fetch full note for the markdown body
      let full: GranolaNoteFull;
      try {
        const res = await fetch(`${API}/notes/${meta.id}`, {
          headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        });
        if (!res.ok) continue;
        full = (await res.json()) as GranolaNoteFull;
      } catch {
        continue;
      }

      const md = full.summary_markdown ?? full.summary_text ?? "";
      const actions = md ? extractActionItems(md) : [];
      const mine = actions.filter((a) => isMine(a, myNames));

      // Always retire the old "Review notes:" fallback for this note — we're
      // replacing it with either extracted actions or nothing at all.
      removedExternalIds.push(`granola:note:${meta.id}`);

      if (mine.length === 0) continue;

      const noteTitle = full.title ?? title;
      const dateLabel = full.calendar_event?.scheduled_start_time
        ? new Date(full.calendar_event.scheduled_start_time).toLocaleDateString([], {
            month: "short",
            day: "numeric",
          })
        : full.created_at
          ? new Date(full.created_at).toLocaleDateString([], { month: "short", day: "numeric" })
          : "";
      const suffix = dateLabel ? ` (${dateLabel})` : "";

      for (const a of mine) {
        items.push({
          externalId: `granola:action:${meta.id}:${a.slug}`,
          title: a.title,
          bucket: "next",
          sourceRef: `From Granola: ${noteTitle}${suffix}${a.owner ? ` — ${a.owner}` : ""}.`,
          notes: a.detail,
          url: full.web_url,
        });
      }
    }

    // Cross-note dedup: free, self-contained heuristic (alias expansion,
    // action-verb clustering, proper-noun boost, Jaccard on residual
    // tokens). Catches common rewrites like i18n ↔ internationalization
    // and "talk to Ron" ↔ "reach out to Ron" without any API keys or
    // network calls. See lib/action-dedup-heuristic.ts.
    const deduped = dedupHeuristically(items);
    // If dedup merged items, retire the individual externalIds so we don't
    // leave the old un-merged tasks sitting around from a previous ingest.
    if (deduped.length < items.length) {
      const survivingIds = new Set(deduped.map((i) => i.externalId));
      for (const orig of items) {
        if (!survivingIds.has(orig.externalId)) removedExternalIds.push(orig.externalId);
      }
    }

    return { items: deduped, removedExternalIds };
  },
};
