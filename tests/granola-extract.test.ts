import { describe, it, expect } from "vitest";
import { extractActionItems, isMine } from "@/lib/granola-extract";

/**
 * Regression guardrails for the Granola markdown parser. If any of these
 * break, the Granola adapter starts creating garbage tasks (or missing
 * real ones).
 */

describe("extractActionItems", () => {
  it("finds bold-prefixed bullets under 'Next Steps'", () => {
    const md = `### Next Steps

- **Do the thing** (Dave)

  Longer description here.

- **Do another thing** (Alice)

- **Third thing without owner**
`;
    const items = extractActionItems(md);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ title: "Do the thing", owner: "Dave" });
    expect(items[0].detail).toContain("Longer description");
    expect(items[1].owner).toBe("Alice");
    expect(items[2].owner).toBeUndefined();
  });

  it("accepts alternative headings (Action Items / Follow-ups / TODOs)", () => {
    for (const heading of ["## Action Items", "### Follow-ups", "#### TODOs", "### To-dos"]) {
      const md = `${heading}\n\n- **Something to do**\n`;
      const items = extractActionItems(md);
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe("Something to do");
    }
  });

  it("is case-insensitive on the heading text", () => {
    const md = "### next STEPS\n\n- **A thing**\n";
    expect(extractActionItems(md)).toHaveLength(1);
  });

  it("stops when a non-action heading appears", () => {
    const md = `### Next Steps

- **First**

### Discussion Notes

- **Should not be an action**
`;
    const items = extractActionItems(md);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("First");
  });

  it("returns [] when the note has no action-items section", () => {
    const md = `### Overview\n\nJust a summary with no follow-ups.\n`;
    expect(extractActionItems(md)).toHaveLength(0);
  });

  it("falls back to plain-text bullets when there's no bold prefix", () => {
    const md = `## Action Items\n\n- Send Carol the memo\n- Call Frank about vendor options\n`;
    const items = extractActionItems(md);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Send Carol the memo");
  });

  it("produces stable slugs so re-runs don't duplicate", () => {
    const md = "### Next Steps\n\n- **Send memo to Eve** (Dave)\n";
    const a = extractActionItems(md);
    const b = extractActionItems(md);
    expect(a[0].slug).toBe(b[0].slug);
  });
});

describe("isMine", () => {
  it("keeps unowned items", () => {
    expect(isMine({ title: "x", slug: "x" }, ["Dave"])).toBe(true);
  });

  it("keeps items owned by me (first-name match)", () => {
    expect(isMine({ title: "x", slug: "x", owner: "Dave" }, ["Dave", "Doe"])).toBe(true);
  });

  it("keeps items owned by me (full-name match)", () => {
    expect(isMine({ title: "x", slug: "x", owner: "Jane Doe" }, ["Jane Doe"])).toBe(true);
  });

  it("drops items owned by someone else", () => {
    expect(isMine({ title: "x", slug: "x", owner: "Alice" }, ["Dave"])).toBe(false);
  });

  it("is case-insensitive on the name comparison", () => {
    expect(isMine({ title: "x", slug: "x", owner: "jane doe" }, ["Jane Doe"])).toBe(true);
  });
});
