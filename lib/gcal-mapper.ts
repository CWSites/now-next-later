import type { IngestItem } from "@/ingest/adapters/base";
import type { Task } from "./types";

/**
 * Pure event → task mapping logic for the Google Calendar adapter.
 *
 * Kept separate from ingest/adapters/gcal.ts so it can be unit-tested
 * without mocking Google's HTTP surface. The rule we want to enforce
 * and never regress on:
 *
 *   Calendar events ONLY populate the "now" column, and only for today.
 *   Everything else is filtered out and marked for removal.
 */

export interface GCalMappableEvent {
  id?: string;
  summary?: string;
  status?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  eventType?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ uri?: string; entryPointType?: string }> };
}

export interface MapOptions {
  /** Current time — injectable for tests. Defaults to `new Date()`. */
  now?: Date;
  /** Existing tasks — used to sweep stale gcal:* tasks not in Now. */
  existingTasks?: Task[];
  /** Case-insensitive skip list from settings. */
  skipTitleSubstrings?: string[];
}

export interface MapResult {
  items: IngestItem[];
  removedExternalIds: string[];
}

/**
 * Rule: only events starting today (from now through end of today, local
 * time) are ingested, always into the "now" bucket. Everything else is
 * added to removedExternalIds so the runner cleans up stale entries.
 */
export function mapEvents(events: GCalMappableEvent[], opts: MapOptions = {}): MapResult {
  const now = opts.now ?? new Date();
  const existing = opts.existingTasks ?? [];
  const skipTitles = (opts.skipTitleSubstrings ?? [])
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const items: IngestItem[] = [];
  const removedExternalIds: string[] = [];
  const skipAndRemove = (id: string) => removedExternalIds.push(`gcal:${id}`);

  // Sweep any pre-existing gcal:* task that isn't in Now — leftover from
  // older adapter versions or from prior refreshes that used broader
  // buckets. Runner honors the completed-task guard, so history is safe.
  for (const t of existing) {
    const eid = t.externalId ?? "";
    if (!eid.startsWith("gcal:")) continue;
    if (t.bucket !== "now") removedExternalIds.push(eid);
  }

  for (const ev of events) {
    const evId = ev.id;
    if (ev.status === "cancelled") {
      if (evId) skipAndRemove(evId);
      continue;
    }
    // All-day events (only `date`, no `dateTime`) — never surfaced.
    const startIso = ev.start?.dateTime;
    if (!startIso) {
      if (evId) skipAndRemove(evId);
      continue;
    }
    // Declined events.
    const self = ev.attendees?.find((a) => a.self);
    if (self?.responseStatus === "declined") {
      if (evId) skipAndRemove(evId);
      continue;
    }
    // Working-location / OOO synthetic events.
    if (ev.eventType && ["workingLocation", "outOfOffice"].includes(ev.eventType)) {
      if (evId) skipAndRemove(evId);
      continue;
    }

    const startsAt = new Date(startIso);
    // Enforce the rule: must be today (between now and end of day). Anything
    // in the past OR after today is dropped, even if Google returned it.
    if (startsAt < now || startsAt > endOfDay) {
      if (evId) skipAndRemove(evId);
      continue;
    }

    const title = ev.summary?.trim() || "(no title)";
    if (skipTitles.length > 0) {
      const lower = title.toLowerCase();
      if (skipTitles.some((s) => lower.includes(s))) {
        if (evId) skipAndRemove(evId);
        continue;
      }
    }

    const time = startsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const when = `today ${time}`;
    const conf =
      ev.hangoutLink ||
      ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;

    items.push({
      externalId: `gcal:${ev.id}`,
      title: `${title} — ${when}`,
      bucket: "now",
      sourceRef: conf ? `On your calendar ${when} (video link).` : `On your calendar ${when}.`,
      url: ev.htmlLink,
    });
  }

  return { items, removedExternalIds };
}
