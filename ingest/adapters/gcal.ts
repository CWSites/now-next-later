import type { Adapter, AdapterIngestResult } from "./base";
import { refreshAccessToken } from "@/lib/gcal-auth";
import { getAllTasks } from "@/lib/storage";
import { mapEvents, type GCalMappableEvent } from "@/lib/gcal-mapper";

/**
 * Google Calendar adapter — thin fetcher that hands the raw event list
 * off to the pure mapper in lib/gcal-mapper.ts (which is unit-tested).
 *
 * The rule the mapper enforces:
 *   Calendar events ONLY populate the "now" column, and only for today.
 *
 * Any pre-existing gcal:* tasks in Next / Later are swept into
 * removedExternalIds on every refresh so a stale ingest can't linger.
 */

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

    // Ask Google for the whole day (start-of-day through end-of-day). The
    // mapper filters events with startsAt < now into removedExternalIds so
    // meetings that already happened get swept from the board on the next
    // refresh instead of sitting in "now" showing a stale time.
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const params = new URLSearchParams({
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
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
    const data = (await res.json()) as { items?: GCalMappableEvent[] };
    const events = data.items ?? [];

    const skipTitleSubstrings = (process.env.GCAL_SKIP_TITLES ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const existingTasks = await getAllTasks();

    return mapEvents(events, { now, existingTasks, skipTitleSubstrings });
  },
};
