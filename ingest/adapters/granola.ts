import type { Adapter, IngestItem } from "./base";

/**
 * Granola adapter — calls the public API at public-api.granola.ai.
 *
 * v1: pulls recent notes and surfaces one task per note into the Next
 * bucket, so the daily brief can prompt "review this meeting's notes."
 * If the notes API response includes structured action items we can
 * split those out into individual tasks in a follow-up.
 */

const API = "https://public-api.granola.ai/v1";

interface GranolaNote {
  id: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  url?: string;
  // Best-effort — actual field names to be confirmed once we see a live
  // response. The mapping below reads whichever fields are present.
  content?: string;
  summary?: string;
  action_items?: Array<{ text?: string; done?: boolean; id?: string }>;
  meeting?: { title?: string; start_time?: string };
}

export const granolaAdapter: Adapter = {
  name: "granola",

  enabled() {
    return Boolean(process.env.GRANOLA_API_KEY);
  },

  disabledReason() {
    return "Paste GRANOLA_API_KEY in Settings (Granola app → Settings → API keys).";
  },

  async ingest(): Promise<IngestItem[]> {
    const token = process.env.GRANOLA_API_KEY!;

    // Pull notes updated in the last 14 days so we're covering both today's
    // meetings and anything still open from last week.
    const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const params = new URLSearchParams({
      updated_since: since,
      limit: "50",
    });

    const res = await fetch(`${API}/notes?${params.toString()}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Granola /notes failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as { data?: GranolaNote[]; notes?: GranolaNote[] };
    const notes = data.data ?? data.notes ?? [];

    const items: IngestItem[] = [];
    for (const n of notes) {
      const title = n.title || n.meeting?.title || "(untitled note)";
      const when = n.meeting?.start_time || n.created_at;
      const suffix = when
        ? ` (${new Date(when).toLocaleDateString([], { month: "short", day: "numeric" })})`
        : "";

      // If the response includes structured action items, prefer emitting
      // one task per open item — that's much higher signal than "review
      // note X". Fall back to a single "review note" task otherwise.
      const openActions = (n.action_items ?? []).filter((a) => !a.done && a.text);
      if (openActions.length > 0) {
        for (const a of openActions) {
          items.push({
            externalId: `granola:action:${n.id}:${a.id ?? Buffer.from(a.text!).toString("base64").slice(0, 12)}`,
            title: a.text!.trim(),
            bucket: "next",
            sourceRef: `From Granola: ${title}${suffix}.`,
            url: n.url,
          });
        }
      } else {
        items.push({
          externalId: `granola:note:${n.id}`,
          title: `Review notes: ${title}${suffix}`,
          bucket: "next",
          sourceRef: `In Granola notes${suffix}.`,
          url: n.url,
        });
      }
    }

    return items;
  },
};
