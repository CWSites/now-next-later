import { describe, it, expect } from "vitest";
import {
  startOfLocalDay,
  startOfLocalWeek,
  groupRecentlyCompleted,
  isArchivedForToday,
} from "@/lib/completions";
import type { Task } from "@/lib/types";

/**
 * Guardrails around the "auto-archive at midnight" contract and the
 * Recently Completed grouping. Regressions here mean checked-off tasks
 * either linger too long (visual clutter) or vanish too early (feels
 * like tasks were deleted).
 */

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? "t_" + Math.random().toString(36).slice(2, 6),
    title: "Test",
    bucket: "now",
    position: 0,
    completed: false,
    createdAt: "2026-07-27T00:00:00Z",
    updatedAt: "2026-07-27T00:00:00Z",
    ...overrides,
  };
}

// A stable "now" reference: Tuesday July 29 2026 at 2 PM local.
const TUE_2PM = new Date("2026-07-29T14:00:00-04:00");

describe("startOfLocalDay", () => {
  it("returns midnight of the same day", () => {
    const start = startOfLocalDay(TUE_2PM);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getDate()).toBe(TUE_2PM.getDate());
  });
});

describe("startOfLocalWeek", () => {
  it("returns Monday 00:00 for a Tuesday", () => {
    const start = startOfLocalWeek(TUE_2PM);
    expect(start.getDay()).toBe(1); // Monday
    expect(start.getHours()).toBe(0);
  });

  it("returns Monday 00:00 for a Sunday (uses Mon-based week)", () => {
    const sun = new Date("2026-08-02T14:00:00-04:00"); // Sunday
    const start = startOfLocalWeek(sun);
    expect(start.getDay()).toBe(1);
    // Should be Mon Jul 27
    expect(start.getDate()).toBe(27);
  });

  it("returns Monday 00:00 for a Monday (same day, clamped)", () => {
    const mon = new Date("2026-07-27T14:00:00-04:00"); // Monday
    const start = startOfLocalWeek(mon);
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(27);
  });
});

describe("groupRecentlyCompleted", () => {
  it("puts tasks completed today under 'today'", () => {
    const tasks = [
      makeTask({ completed: true, completedAt: "2026-07-29T10:00:00-04:00" }),
      makeTask({ completed: true, completedAt: "2026-07-29T13:00:00-04:00" }),
    ];
    const { today, earlierThisWeek } = groupRecentlyCompleted(tasks, TUE_2PM);
    expect(today).toHaveLength(2);
    expect(earlierThisWeek).toHaveLength(0);
  });

  it("puts tasks completed earlier this week (but not today) under earlierThisWeek", () => {
    const tasks = [
      makeTask({ completed: true, completedAt: "2026-07-27T09:00:00-04:00" }), // Monday
      makeTask({ completed: true, completedAt: "2026-07-28T15:00:00-04:00" }), // Monday
    ];
    const { today, earlierThisWeek } = groupRecentlyCompleted(tasks, TUE_2PM);
    expect(today).toHaveLength(0);
    expect(earlierThisWeek).toHaveLength(2);
  });

  it("ignores tasks completed before the start of this week", () => {
    const tasks = [
      makeTask({ completed: true, completedAt: "2026-07-20T10:00:00-04:00" }), // last week
    ];
    const { today, earlierThisWeek } = groupRecentlyCompleted(tasks, TUE_2PM);
    expect(today).toHaveLength(0);
    expect(earlierThisWeek).toHaveLength(0);
  });

  it("ignores incomplete tasks", () => {
    const tasks = [makeTask({ completed: false, completedAt: null })];
    const { today, earlierThisWeek } = groupRecentlyCompleted(tasks, TUE_2PM);
    expect(today).toHaveLength(0);
    expect(earlierThisWeek).toHaveLength(0);
  });

  it("sorts each group most-recent-first", () => {
    const tasks = [
      makeTask({ id: "a", completed: true, completedAt: "2026-07-29T09:00:00-04:00" }),
      makeTask({ id: "b", completed: true, completedAt: "2026-07-29T13:00:00-04:00" }),
      makeTask({ id: "c", completed: true, completedAt: "2026-07-29T11:00:00-04:00" }),
    ];
    const { today } = groupRecentlyCompleted(tasks, TUE_2PM);
    expect(today.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("safely ignores tasks with invalid completedAt strings", () => {
    const tasks = [makeTask({ completed: true, completedAt: "not-a-date" })];
    const { today, earlierThisWeek } = groupRecentlyCompleted(tasks, TUE_2PM);
    expect(today).toHaveLength(0);
    expect(earlierThisWeek).toHaveLength(0);
  });
});

describe("isArchivedForToday", () => {
  it("returns false for incomplete tasks", () => {
    const t = makeTask({ completed: false });
    expect(isArchivedForToday(t, TUE_2PM)).toBe(false);
  });

  it("returns false for tasks completed today (still visible on the board)", () => {
    const t = makeTask({ completed: true, completedAt: "2026-07-29T10:00:00-04:00" });
    expect(isArchivedForToday(t, TUE_2PM)).toBe(false);
  });

  it("returns true for tasks completed on a previous day", () => {
    const t = makeTask({ completed: true, completedAt: "2026-07-28T23:00:00-04:00" });
    expect(isArchivedForToday(t, TUE_2PM)).toBe(true);
  });

  it("returns true for tasks explicitly archived (manual button)", () => {
    const t = makeTask({
      completed: true,
      completedAt: "2026-07-29T10:00:00-04:00",
      archived: true,
    });
    expect(isArchivedForToday(t, TUE_2PM)).toBe(true);
  });

  it("returns false when completedAt is missing (defensive)", () => {
    const t = makeTask({ completed: true, completedAt: null });
    expect(isArchivedForToday(t, TUE_2PM)).toBe(false);
  });
});
