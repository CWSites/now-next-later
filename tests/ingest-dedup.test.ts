import { describe, it, expect } from "vitest";
import { shouldSkipAsDuplicate, isUniqueIdSource } from "@/lib/ingest-dedup";
import type { Task } from "@/lib/types";

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? "t_" + Math.random().toString(36).slice(2, 8),
    title: "Test",
    bucket: "now",
    position: 0,
    completed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

describe("ingest dedup", () => {
  it("treats jira externalIds as globally unique", () => {
    expect(isUniqueIdSource("jira:POLARIS-3219")).toBe(true);
    expect(isUniqueIdSource("gcal:abc123")).toBe(false);
    expect(isUniqueIdSource(undefined)).toBe(false);
  });

  it("never suppresses a jira ticket by title similarity to another jira ticket", () => {
    // Regression: POLARIS-3219 and POLARIS-3142 both start with
    // "Buyer - Preview -" and score above the 0.5 similarity threshold,
    // which used to make the second one silently vanish from the board.
    const existing = [
      task({
        externalId: "jira:POLARIS-3142",
        title: "[POLARIS-3142] Buyer - Preview - Ensure Price Per Unit is auto-populated",
      }),
    ];
    const incoming = {
      externalId: "jira:POLARIS-3219",
      title: "[POLARIS-3219] Buyer - Preview - Suggested Supplier Pricing Button replaced",
    };
    expect(shouldSkipAsDuplicate(incoming, existing)).toBeNull();
  });

  it("still dedups non-unique-id sources against similar existing tasks", () => {
    // Granola / gcal / other sources still get title-similarity dedup.
    const existing = [
      task({
        externalId: "granola:xyz",
        title: "Prep for weekly sync with Polaris squad",
      }),
    ];
    const incoming = {
      externalId: "gcal:evt-1",
      title: "Weekly sync with Polaris squad",
    };
    const dupOf = shouldSkipAsDuplicate(incoming, existing);
    expect(dupOf).not.toBeNull();
    expect(dupOf?.externalId).toBe("granola:xyz");
  });

  it("does not dedup a jira ticket against a similarly-titled non-jira task", () => {
    // Unique-ID sources are authoritative even against other sources.
    const existing = [
      task({
        externalId: "granola:xyz",
        title: "Preview page required flag on line items",
      }),
    ];
    const incoming = {
      externalId: "jira:POLARIS-3186",
      title: "[POLARIS-3186] Preview page does not reflect required flag on line items",
    };
    expect(shouldSkipAsDuplicate(incoming, existing)).toBeNull();
  });
});
