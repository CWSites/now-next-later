import type { Adapter, AdapterIngestResult, IngestItem } from "./base";
import { extractActionItems } from "@/lib/granola-extract";
import { dedupHeuristically } from "@/lib/action-dedup-heuristic";
import { getAllTasks } from "@/lib/storage";

/**
 * Granola adapter.
 *
 * We fetch each recent note's full body, extract action items from the
 * markdown, then attribute them to the current user only when we can do
 * so unambiguously. Key correctness rules:
 *
 *   1. Determine "me" once, up front — from GRANOLA_ME_EMAIL if set, else
 *      the most-frequent owner email across the batch. This is the user
 *      the API key belongs to.
 *   2. Only process notes where "me" is either the owner or in the
 *      attendee list. Notes shared with the user but where they didn't
 *      attend (e.g. someone else's meeting notes shared for visibility)
 *      never yield tasks — any "(Alex)" tag in them refers to a
 *      different Alex who was actually in the room.
 *   3. Per-note ownership disambiguation: if multiple attendees share
 *      a first name (Alex + Alexander, Chris + Christine), items tagged
 *      with just that first name require a full-name or email match to
 *      count as mine. Otherwise a lone first-name tag is fine.
 *
 * This mirrors how a human triaging Granola notes would decide: "was I
 * actually in that meeting, and if so, is this tag unambiguously me?"
 */

const API = "https://public-api.granola.ai/v1";

interface GranolaAttendee {
  name?: string;
  email?: string;
}

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
  attendees?: GranolaAttendee[];
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
    const configuredEmail = (process.env.GRANOLA_ME_EMAIL ?? "").trim().toLowerCase();

    // Pre-load existing granola action tasks so we can purge stale ones
    // (from notes we've decided to skip this run, either because the user
    // wasn't a real attendee or because the ownership was ambiguous).
    const existingTasks = await getAllTasks();
    const existingActionsByNote = new Map<string, string[]>();
    for (const t of existingTasks) {
      const eid = t.externalId ?? "";
      const m = eid.match(/^granola:action:([^:]+):/);
      if (!m) continue;
      const arr = existingActionsByNote.get(m[1]) ?? [];
      arr.push(eid);
      existingActionsByNote.set(m[1], arr);
    }

    // 1) list recent notes
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

    const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
    const recent = notes.filter((n) => {
      const t = new Date(n.updated_at ?? n.created_at ?? 0).getTime();
      if (Number.isNaN(t)) return true;
      return t >= cutoff;
    });

    // 2) determine "me": explicit config wins, else most-frequent owner.
    const meEmail = configuredEmail || guessMostFrequentOwnerEmail(recent);
    if (!meEmail) {
      // Nothing to attribute to — bail with no items rather than misassign.
      return { items: [], removedExternalIds: [] };
    }
    const meFirstName = firstNameFromEmail(meEmail);

    const items: IngestItem[] = [];
    const removedExternalIds: string[] = [];

    // Helper: when we skip a note entirely, retire everything it ever
    // spawned so ghosts from previous ingests don't linger.
    const retireNote = (noteId: string) => {
      removedExternalIds.push(`granola:note:${noteId}`);
      const prior = existingActionsByNote.get(noteId) ?? [];
      for (const eid of prior) removedExternalIds.push(eid);
    };

    for (const meta of recent) {
      const title = meta.title ?? "(untitled note)";
      const lowerTitle = title.toLowerCase();
      if (skipTitles.some((s) => lowerTitle.includes(s))) {
        retireNote(meta.id);
        continue;
      }

      // Fetch full note (need attendees + summary_markdown).
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

      // Correctness gate: I must have actually been in this meeting.
      // Retire the note (fallback + any prior action tasks) either way —
      // if I skip it, nothing from it should linger on the board.
      const attendees = full.attendees ?? [];
      const isOwner = (full.owner?.email ?? "").toLowerCase() === meEmail;
      const isAttendee = attendees.some((a) => (a.email ?? "").toLowerCase() === meEmail);
      if (!isOwner && !isAttendee) {
        retireNote(meta.id);
        continue;
      }
      // Just retire the fallback — we'll upsert fresh action tasks below
      // and those either match previous externalIds (updated in place) or
      // are new.
      removedExternalIds.push(`granola:note:${meta.id}`);

      const md = full.summary_markdown ?? full.summary_text ?? "";
      if (!md) continue;
      const actions = extractActionItems(md);

      // Ambiguity: another attendee shares my first name (Alex + Alexander,
      // Chris + Christine). If so, first-name-only tags aren't enough.
      const firstNameCollision = attendees.some((a) => {
        const other = firstNameFromEmail(a.email ?? "") || firstNameFromName(a.name ?? "");
        if (!other) return false;
        if ((a.email ?? "").toLowerCase() === meEmail) return false;
        return normalizeFirstName(other) === normalizeFirstName(meFirstName);
      });

      const mine = actions.filter((a) => attributedToMe(a.owner, meEmail, meFirstName, firstNameCollision));
      if (mine.length === 0) {
        // Nothing attributable to me from this note — retire any prior
        // action tasks that WERE attributed to me in an earlier run.
        const prior = existingActionsByNote.get(meta.id) ?? [];
        for (const eid of prior) removedExternalIds.push(eid);
        continue;
      }

      // Also purge any prior action tasks from this note whose slug isn't
      // in the new set (item was edited out of the note, or ownership
      // rules now exclude it).
      const newSlugs = new Set(mine.map((a) => `granola:action:${meta.id}:${a.slug}`));
      const prior = existingActionsByNote.get(meta.id) ?? [];
      for (const eid of prior) {
        if (!newSlugs.has(eid)) removedExternalIds.push(eid);
      }

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

    const deduped = dedupHeuristically(items);
    if (deduped.length < items.length) {
      const survivingIds = new Set(deduped.map((i) => i.externalId));
      for (const orig of items) {
        if (!survivingIds.has(orig.externalId)) removedExternalIds.push(orig.externalId);
      }
    }

    return { items: deduped, removedExternalIds };
  },
};

// ------------------------ helpers ------------------------

function guessMostFrequentOwnerEmail(notes: GranolaNoteMeta[]): string {
  const counts = new Map<string, number>();
  for (const n of notes) {
    const email = n.owner?.email?.toLowerCase();
    if (email) counts.set(email, (counts.get(email) ?? 0) + 1);
  }
  let best: { email: string; n: number } | null = null;
  for (const [email, n] of counts) {
    if (!best || n > best.n) best = { email, n };
  }
  return best?.email ?? "";
}

function firstNameFromEmail(email: string): string {
  if (!email) return "";
  const local = email.split("@")[0];
  return local.split(/[._-]/)[0] ?? "";
}

function firstNameFromName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function normalizeFirstName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Decide whether an action item's owner tag refers to me.
 *
 *   - No tag                                 → treat as mine (unassigned).
 *   - Full name / email exact match          → mine.
 *   - First-name match, no collision in room → mine.
 *   - First-name match, another same-name    → NOT mine (ambiguous, skip
 *                                              rather than misassign).
 *   - Different name                         → not mine.
 */
function attributedToMe(
  ownerTag: string | undefined,
  myEmail: string,
  myFirstName: string,
  collision: boolean,
): boolean {
  if (!ownerTag) return true;
  const tag = ownerTag.trim().toLowerCase();
  if (!tag) return true;
  if (tag === myEmail) return true;
  const myFirst = normalizeFirstName(myFirstName);
  const tagFirst = normalizeFirstName(firstNameFromName(ownerTag));
  if (tagFirst !== myFirst) return false;
  // First names match. If there's no ambiguity in the room, accept.
  if (!collision) return true;
  // Ambiguous — require the tag to include full-name/email disambiguation.
  const nameParts = ownerTag.trim().split(/\s+/);
  if (nameParts.length < 2) return false; // just "Alex" is ambiguous
  // With a last name, require it to look like ours. We don't know user's
  // last name (only email), so approximate: last-name token should appear
  // as a segment of the email local-part (e.g. jane.doe@example.com
  // matches "Jane Doe").
  const emailLocal = myEmail.split("@")[0].toLowerCase();
  const lastToken = nameParts[nameParts.length - 1].toLowerCase().replace(/[^a-z]/g, "");
  return emailLocal.includes(lastToken);
}
