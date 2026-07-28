import type { Adapter, IngestItem } from "./base";
import type { Bucket } from "@/lib/types";
import { refreshAccessToken } from "@/lib/gcal-auth";

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

  async ingest(): Promise<IngestItem[]> {
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
    for (const ev of events) {
      if (ev.status === "cancelled") continue;
      // Skip all-day events (they only have `date`, not `dateTime`).
      const startIso = ev.start?.dateTime;
      if (!startIso) continue;

      // Skip events the user has declined.
      const self = ev.attendees?.find((a) => a.self);
      if (self?.responseStatus === "declined") continue;

      // Skip working-location / focus-time system events unless they have a real title.
      if (ev.eventType && ["workingLocation", "outOfOffice"].includes(ev.eventType)) continue;

      const startsAt = new Date(startIso);
      const bucket = bucketFor(startsAt);

      const title = ev.summary?.trim() || "(no title)";

      // Filter recurring / low-signal meetings the user has opted out of.
      if (skipTitles.length > 0) {
        const lower = title.toLowerCase();
        if (skipTitles.some((s) => lower.includes(s))) continue;
      }
      const time = startsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const day = startsAt.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
      const isToday = startsAt <= endOfDay;
      const when = isToday ? `today ${time}` : `${day} ${time}`;

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

    return items;
  },
};
