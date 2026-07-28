import type { Adapter, AdapterIngestResult, IngestItem } from "./base";
import type { Bucket } from "@/lib/types";
import { refreshAccessToken } from "@/lib/gcal-auth";
import { getAllTasks } from "@/lib/storage";

/**
 * Google Calendar adapter.
 *
 * Surfaces today's calendar events into the Now bucket so the daily brief
 * shows what's coming up. Skips declined events, all-day events (birthdays,
 * OOO, etc.), and events without a scheduled start time.
 *
 * Bucket rule (kept simple, expand later if useful):
 *   - Today (from now onward)          → now
 *   - Rest of this week                → next
 *   - Rest of this month               → later
 *   - Past events                      → excluded
 */

interface GCalEvent {
  id: string;
  summary?: string;
  status?: string; // "confirmed" | "tentative" | "cancelled"
  htmlLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string; email?: string }>;
  organizer?: { self?: boolean; email?: string };
  location?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ uri?: string; entryPointType?: string }> };
  eventType?: string;
}

export const gcalAdapter: Adapter = {
  name: "gcal",

  enabled() {
    return Boolean(
      process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_REFRESH_TOKEN,
    );
  },

  disabledReason() {
    return "Set Google credentials in Settings and click 'Connect Google Calendar'.";
  },

  async ingest(): Promise<AdapterIngestResult> {
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN!;

    const accessToken = await refreshAccessToken(refreshToken, clientId, clientSecret);

    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: endOfMonth.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "50",
    });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      throw new Error(`Google Calendar list failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { items?: GCalEvent[] };
    const events = data.items ?? [];

    // Bucket boundaries: end of today / end of this week (Sun-end) / end of month.
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const endOfWeek = new Date(endOfDay);
    // Advance to Sunday 23:59.
    const daysUntilSun = (7 - endOfDay.getDay()) % 7;
    endOfWeek.setDate(endOfDay.getDate() + daysUntilSun);

    function bucketFor(startsAt: Date): Bucket {
      if (startsAt <= endOfDay) return "now";
      if (startsAt <= endOfWeek) return "next";
      return "later";
    }

    // User-configurable skip list. Case-insensitive substring match against
    // the event title. Empty entries are ignored so trailing/leading commas
    // don't blackhole every event.
    const skipTitles = (process.env.GCAL_SKIP_TITLES ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);

    const items: IngestItem[] = [];
    const removedExternalIds: string[] = [];

    // Sweep: purge any pre-existing gcal:* task that isn't in Now. Since we
    // only ingest today's events into Now, anything gcal:* in Next or Later
    // is a leftover from an older adapter version and should be cleaned up.
    // Runner's deleteByExternalId honors the completed-task guard, so we
    // won't blow away meetings the user has already checked off.
    const existing = await getAllTasks();
    for (const t of existing) {
      const eid = t.externalId ?? "";
      if (!eid.startsWith("gcal:")) continue;
      if (t.bucket !== "now") removedExternalIds.push(eid);
    }

    // Helper for adding a would-be-created externalId to the removal list.
    // Runner will delete any existing task that matches — this makes filter
    // changes retroactive for events still inside the fetch window.
    const skipAndRemove = (id: string) => removedExternalIds.push(`gcal:${id}`);

    for (const ev of events) {
      const evId = ev.id;
      if (ev.status === "cancelled") {
        if (evId) skipAndRemove(evId);
        continue;
      }
      // Skip all-day events (they only have `date`, not `dateTime`).
      const startIso = ev.start?.dateTime;
      if (!startIso) {
        if (evId) skipAndRemove(evId);
        continue;
      }

      // Skip events the user has declined.
      const self = ev.attendees?.find((a) => a.self);
      if (self?.responseStatus === "declined") {
        if (evId) skipAndRemove(evId);
        continue;
      }

      // Skip working-location / focus-time system events unless they have a real title.
      if (ev.eventType && ["workingLocation", "outOfOffice"].includes(ev.eventType)) {
        if (evId) skipAndRemove(evId);
        continue;
      }

      const startsAt = new Date(startIso);
      const bucket = bucketFor(startsAt);

      const title = ev.summary?.trim() || "(no title)";

      // Filter recurring / low-signal meetings the user has opted out of.
      if (skipTitles.length > 0) {
        const lower = title.toLowerCase();
        if (skipTitles.some((s) => lower.includes(s))) {
          if (evId) skipAndRemove(evId);
          continue;
        }
      }
      const time = startsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const when = `today ${time}`;

      const conf = ev.hangoutLink || ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
      const url = ev.htmlLink;

      items.push({
        externalId: `gcal:${ev.id}`,
        title: `${title} — ${when}`,
        bucket,
        sourceRef: conf ? `On your calendar ${when} (video link).` : `On your calendar ${when}.`,
        url,
      });
    }

    return { items, removedExternalIds };
  },
};
