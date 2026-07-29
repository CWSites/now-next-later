import { describe, it, expect } from "vitest";
import { mapEvents, type GCalMappableEvent } from "@/lib/gcal-mapper";
import type { Task } from "@/lib/types";

/**
 * Regression guardrail: calendar events must ONLY populate the "now"
 * column, and only for today. Any drift to Next/Later re-introduces the
 * bug from Jul 29 where recurring events for Wed/Thu/Fri leaked in as
 * "today X:00 PM" tasks in the Next column.
 */

const NOON_TODAY = new Date("2026-07-29T12:00:00-04:00");

function makeEvent(overrides: Partial<GCalMappableEvent>): GCalMappableEvent {
  return {
    id: overrides.id ?? "evt_" + Math.random().toString(36).slice(2, 8),
    summary: "Test Meeting",
    status: "confirmed",
    start: { dateTime: "2026-07-29T15:00:00-04:00" },
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "task_" + Math.random().toString(36).slice(2, 8),
    title: "Test",
    bucket: "now",
    position: 0,
    completed: false,
    createdAt: "2026-07-29T00:00:00Z",
    updatedAt: "2026-07-29T00:00:00Z",
    ...overrides,
  };
}

describe("gcal mapper", () => {
  describe("bucket rule", () => {
    it("puts today's events in the Now bucket only", () => {
      const events = [
        makeEvent({ id: "morning", start: { dateTime: "2026-07-29T14:00:00-04:00" } }),
        makeEvent({ id: "afternoon", start: { dateTime: "2026-07-29T15:00:00-04:00" } }),
        makeEvent({ id: "evening", start: { dateTime: "2026-07-29T20:00:00-04:00" } }),
      ];
      const { items } = mapEvents(events, { now: NOON_TODAY });
      expect(items).toHaveLength(3);
      for (const item of items) {
        expect(item.bucket).toBe("now");
      }
    });

    it("never emits a Next or Later item, no matter what the event date is", () => {
      const events = [
        makeEvent({ id: "today", start: { dateTime: "2026-07-29T15:00:00-04:00" } }),
        makeEvent({ id: "tomorrow", start: { dateTime: "2026-07-30T11:00:00-04:00" } }),
        makeEvent({ id: "next-week", start: { dateTime: "2026-08-05T10:00:00-04:00" } }),
        makeEvent({ id: "next-month", start: { dateTime: "2026-08-29T10:00:00-04:00" } }),
      ];
      const { items } = mapEvents(events, { now: NOON_TODAY });
      for (const item of items) {
        expect(item.bucket).toBe("now");
      }
    });
  });

  describe("today-window filter", () => {
    it("drops future events (tomorrow, next week, next month) even if the API returned them", () => {
      const events = [
        makeEvent({ id: "today", start: { dateTime: "2026-07-29T15:00:00-04:00" } }),
        makeEvent({ id: "tomorrow", start: { dateTime: "2026-07-30T15:00:00-04:00" } }),
        makeEvent({ id: "friday", start: { dateTime: "2026-07-31T15:00:00-04:00" } }),
      ];
      const { items, removedExternalIds } = mapEvents(events, { now: NOON_TODAY });
      const ids = items.map((i) => i.externalId);
      expect(ids).toEqual(["gcal:today"]);
      expect(removedExternalIds).toContain("gcal:tomorrow");
      expect(removedExternalIds).toContain("gcal:friday");
    });

    it("drops events in the past", () => {
      const events = [
        makeEvent({ id: "yesterday", start: { dateTime: "2026-07-28T15:00:00-04:00" } }),
        makeEvent({ id: "later-today", start: { dateTime: "2026-07-29T15:00:00-04:00" } }),
      ];
      const { items } = mapEvents(events, { now: NOON_TODAY });
      expect(items.map((i) => i.externalId)).toEqual(["gcal:later-today"]);
    });

    it("keeps events happening exactly at end of day", () => {
      const events = [
        makeEvent({ id: "late", start: { dateTime: "2026-07-29T23:59:00-04:00" } }),
      ];
      const { items } = mapEvents(events, { now: NOON_TODAY });
      expect(items).toHaveLength(1);
    });
  });

  describe("event kind filters", () => {
    it("skips cancelled events", () => {
      const events = [makeEvent({ id: "canx", status: "cancelled" })];
      const { items, removedExternalIds } = mapEvents(events, { now: NOON_TODAY });
      expect(items).toHaveLength(0);
      expect(removedExternalIds).toContain("gcal:canx");
    });

    it("skips all-day events (no dateTime, only date)", () => {
      const events = [makeEvent({ id: "birthday", start: { date: "2026-07-29" } })];
      const { items, removedExternalIds } = mapEvents(events, { now: NOON_TODAY });
      expect(items).toHaveLength(0);
      expect(removedExternalIds).toContain("gcal:birthday");
    });

    it("skips events the user has declined", () => {
      const events = [
        makeEvent({
          id: "declined",
          attendees: [{ self: true, responseStatus: "declined" }],
        }),
      ];
      const { items } = mapEvents(events, { now: NOON_TODAY });
      expect(items).toHaveLength(0);
    });

    it("skips workingLocation and outOfOffice synthetic events", () => {
      const events = [
        makeEvent({ id: "wl", eventType: "workingLocation" }),
        makeEvent({ id: "ooo", eventType: "outOfOffice" }),
      ];
      const { items } = mapEvents(events, { now: NOON_TODAY });
      expect(items).toHaveLength(0);
    });

    it("skips events whose title matches the skip list", () => {
      const events = [
        makeEvent({ id: "keep", summary: "Roadmap Review" }),
        makeEvent({ id: "skip1", summary: "Peppermint Stand-Up" }),
        makeEvent({ id: "skip2", summary: "Tea Time" }),
      ];
      const { items } = mapEvents(events, {
        now: NOON_TODAY,
        skipTitleSubstrings: ["stand-up", "tea time"],
      });
      expect(items.map((i) => i.externalId)).toEqual(["gcal:keep"]);
    });
  });

  describe("stale-task sweep", () => {
    it("marks pre-existing gcal:* tasks in Next or Later for removal", () => {
      const existingTasks = [
        makeTask({ id: "a", bucket: "next", externalId: "gcal:leftover-next" }),
        makeTask({ id: "b", bucket: "later", externalId: "gcal:leftover-later" }),
        makeTask({ id: "c", bucket: "now", externalId: "gcal:actually-today" }),
        makeTask({ id: "d", bucket: "next", externalId: "jira:PROJ-1" }),
      ];
      const { removedExternalIds } = mapEvents([], { now: NOON_TODAY, existingTasks });
      expect(removedExternalIds).toContain("gcal:leftover-next");
      expect(removedExternalIds).toContain("gcal:leftover-later");
      expect(removedExternalIds).not.toContain("gcal:actually-today");
      expect(removedExternalIds).not.toContain("jira:PROJ-1");
    });
  });

  describe("output shape", () => {
    it("prefixes the title with the event summary and adds a 'today HH:MM' label", () => {
      const events = [
        makeEvent({
          id: "sync",
          summary: "Team Sync",
          start: { dateTime: "2026-07-29T15:00:00-04:00" },
        }),
      ];
      const { items } = mapEvents(events, { now: NOON_TODAY });
      expect(items[0].title).toContain("Team Sync");
      expect(items[0].title).toContain("today");
      expect(items[0].externalId).toBe("gcal:sync");
      expect(items[0].bucket).toBe("now");
    });

    it("mentions the video link in the sourceRef when there's a Hangout URL", () => {
      const events = [
        makeEvent({
          id: "vid",
          summary: "Standup",
          hangoutLink: "https://meet.google.com/abc-defg-hij",
        }),
      ];
      const { items } = mapEvents(events, { now: NOON_TODAY });
      expect(items[0].sourceRef).toContain("video link");
    });
  });
});
