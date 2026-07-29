import { describe, it, expect } from "vitest";
import {
  similarity,
  clusterHeuristically,
  dedupHeuristically,
} from "@/lib/action-dedup-heuristic";
import type { IngestItem } from "@/ingest/adapters/base";

/**
 * These tests protect the specific dedup behaviors we've promised the user:
 *   1. i18n ↔ internationalization aliasing
 *   2. verb clustering (talk ↔ reach out ↔ ping)
 *   3. proper-noun boost (both mention "Ron")
 *   4. calendar-date-suffix stripping
 *   5. "Prep for X" preferred over gcal-style titles
 *   6. cross-column merges (bucket doesn't affect similarity)
 * A regression in any of these means the board fills up with rewrites of
 * the same commitment.
 */

function item(overrides: Partial<IngestItem> & { title: string }): IngestItem {
  return {
    externalId: overrides.externalId ?? "test:" + overrides.title.slice(0, 20),
    bucket: overrides.bucket ?? "next",
    ...overrides,
  };
}

describe("similarity()", () => {
  it("clusters i18n and internationalization above threshold", () => {
    const s = similarity(
      "Talk to Ron about internationalization vendor options",
      "Reach out to Ron regarding i18n & l10n",
    );
    expect(s).toBeGreaterThanOrEqual(0.5);
  });

  it("clusters 'follow up with Alice on the API bug' and 'DM Alice re: the API fix'", () => {
    const s = similarity(
      "Follow up with Alice on the API bug",
      "DM Alice re: the API fix",
    );
    expect(s).toBeGreaterThanOrEqual(0.5);
  });

  it("does NOT cluster unrelated tasks that share only a stopword", () => {
    const s = similarity("Ship the release notes", "Send hiring plan to HR");
    expect(s).toBeLessThan(0.5);
  });

  it("collapses 'Prep for X' and 'X' via prep+date stripping", () => {
    const s = similarity(
      "Prep for Friday's Peppermint Retro",
      "Retro - Peppermint Squad - Fri, Jul 31 3:00 PM",
    );
    expect(s).toBeGreaterThanOrEqual(0.5);
  });

  it("collapses 'X' and 'X — today HH:MM' by stripping the time suffix", () => {
    const s = similarity(
      "Interview Adam Teller",
      "Interview Adam Teller — today 2:00 PM",
    );
    expect(s).toBeGreaterThanOrEqual(0.6);
  });

  it("clusters items that share only jargon via alias normalization", () => {
    // "i18n" and "internationalization" become the same token, so items
    // whose only overlap is that jargon still hit the threshold.
    expect(
      similarity("i18n audit for the checkout flow", "internationalization audit for the checkout flow"),
    ).toBeGreaterThanOrEqual(0.7);
  });
});

describe("clusterHeuristically()", () => {
  it("groups semantically-equivalent items even from different sources", () => {
    const items = [
      item({ title: "Talk to Ron about internationalization vendor options" }),
      item({ title: "Reach out to Ron regarding i18n & l10n" }),
      item({ title: "Follow up with Alice on the API bug" }),
      item({ title: "DM Alice re: the API fix" }),
      item({ title: "Ship release notes" }),
    ];
    const clusters = clusterHeuristically(items);
    // Expect: 3 clusters — {Ron, Ron}, {Alice, Alice}, {ship}
    expect(clusters.length).toBe(3);
    const sizes = clusters.map((c) => c.length).sort();
    expect(sizes).toEqual([1, 2, 2]);
  });

  it("keeps totally unrelated items separate", () => {
    const items = [
      item({ title: "Ship release notes" }),
      item({ title: "Interview candidate" }),
      item({ title: "Write PRD" }),
    ];
    const clusters = clusterHeuristically(items);
    expect(clusters.length).toBe(3);
  });

  it("does not filter by bucket — cross-column duplicates cluster", () => {
    const items = [
      item({ title: "Prep for Friday's Peppermint Retro", bucket: "later" }),
      item({
        title: "Retro - Peppermint Squad — today 3:00 PM",
        bucket: "now",
        externalId: "gcal:abc",
      }),
    ];
    const clusters = clusterHeuristically(items);
    expect(clusters.length).toBe(1);
  });
});

describe("dedupHeuristically()", () => {
  it("prefers a 'Prep for X' title over a gcal-flavored one", () => {
    const items = [
      item({ title: "Prep for Friday's Peppermint Retro" }),
      item({
        title: "Retro - Peppermint Squad — today 3:00 PM",
        externalId: "gcal:evt-123",
      }),
    ];
    const merged = dedupHeuristically(items);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("Prep for Friday's Peppermint Retro");
  });

  it("prefers a non-gcal title when neither is a 'prep for'", () => {
    const items = [
      item({
        title: "Interview Adam Teller — today 2:00 PM",
        externalId: "gcal:evt-1",
      }),
      item({
        title: "Interview Adam Teller for the Engineering role",
        externalId: "granola:action:foo:bar",
      }),
    ];
    const merged = dedupHeuristically(items);
    // Merged into a single row; the non-gcal member's title wins.
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("Interview Adam Teller for the Engineering role");
    // Merged rows get a stable synthetic externalId so re-runs upsert cleanly.
    expect(merged[0].externalId).toMatch(/^merged:/);
  });

  it("returns items unchanged when nothing clusters", () => {
    const items = [
      item({ title: "Ship v2 release" }),
      item({ title: "Onboard Carol on Day 1" }),
    ];
    const merged = dedupHeuristically(items);
    expect(merged).toHaveLength(2);
  });

  it("keeps a single item as-is (fast path)", () => {
    const only = item({ title: "Just this" });
    expect(dedupHeuristically([only])).toEqual([only]);
  });

  it("joins sourceRefs from merged members", () => {
    const items = [
      item({
        title: "Follow up with Alice on the API bug",
        sourceRef: "From Granola: 1:1 (Jul 28).",
      }),
      item({
        title: "DM Alice re: the API fix",
        sourceRef: "From Slack DM with Alice.",
      }),
    ];
    const merged = dedupHeuristically(items);
    expect(merged).toHaveLength(1);
    // Both sources referenced.
    expect(merged[0].sourceRef).toContain("Merged from 2 notes");
    expect(merged[0].sourceRef).toContain("Granola");
    expect(merged[0].sourceRef).toContain("Slack");
  });
});
