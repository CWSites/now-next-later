import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extractRules, recordMergeForLearning } from "@/lib/dedup-learner";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

describe("extractRules()", () => {
  it("detects alias gap (single non-overlapping token per side)", () => {
    const rules = extractRules("schedule the retro", "schedule the retrospective");
    expect(rules).toEqual([{ type: "alias", token: "retro", mapsTo: "retrospective" }]);
  });

  it("maps shorter token to longer token", () => {
    const rules = extractRules("schedule the retrospective", "schedule the retro");
    expect(rules).toEqual([{ type: "alias", token: "retro", mapsTo: "retrospective" }]);
  });

  it("detects action verb gap (one side has ACTION_MARKER)", () => {
    // "ping" collapses to __contact__, "nudge" doesn't
    const rules = extractRules("nudge Alice about the report", "ping Alice about the report");
    expect(rules).toEqual([{ type: "actionVerb", token: "nudge" }]);
  });

  it("detects action verb gap regardless of direction", () => {
    const rules = extractRules("ping Alice about the report", "nudge Alice about the report");
    expect(rules).toEqual([{ type: "actionVerb", token: "nudge" }]);
  });

  it("returns nothing when symmetric difference is too large", () => {
    const rules = extractRules(
      "fix the login bug on the dashboard",
      "resolve authentication issue in admin panel",
    );
    expect(rules).toEqual([]);
  });

  it("returns nothing when titles are identical after normalization", () => {
    const rules = extractRules("check with Alice", "check with Alice");
    expect(rules).toEqual([]);
  });

  it("skips alias if token is a stopword", () => {
    // "today" and "tomorrow" are both stopwords, so they're filtered before
    // reaching extractRules — the normalized token sets are identical.
    const rules = extractRules("do it today", "do it tomorrow");
    expect(rules).toEqual([]);
  });
});

describe("recordMergeForLearning()", () => {
  let tmpDir: string;
  let origEnv: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dedup-learner-test-"));
    await fs.mkdir(path.join(tmpDir, "data"), { recursive: true });
    origEnv = process.env.DATA_REPO_PATH;
    process.env.DATA_REPO_PATH = tmpDir;
  });

  afterEach(async () => {
    if (origEnv === undefined) delete process.env.DATA_REPO_PATH;
    else process.env.DATA_REPO_PATH = origEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates rules file on first merge", async () => {
    await recordMergeForLearning("schedule the retro", "schedule the retrospective");
    const raw = await fs.readFile(path.join(tmpDir, "data/learned-dedup-rules.json"), "utf8");
    const rules = JSON.parse(raw);
    expect(rules.version).toBe(1);
    expect(rules.aliases.retro).toBe("retrospective");
    expect(rules.mergeLog).toHaveLength(1);
    expect(rules.mergeLog[0].similarityAtMerge).toBeLessThan(0.5);
  });

  it("skips rule extraction when similarity >= 0.5", async () => {
    // "ping Alice" and "call Alice" both collapse to "__contact__ alice" → high similarity
    await recordMergeForLearning("ping Alice about budget", "call Alice about budget");
    const raw = await fs.readFile(path.join(tmpDir, "data/learned-dedup-rules.json"), "utf8");
    const rules = JSON.parse(raw);
    expect(rules.mergeLog[0].rulesExtracted).toEqual([]);
    expect(Object.keys(rules.aliases)).toHaveLength(0);
  });

  it("caps merge log at 100 entries", async () => {
    // Seed with 100 existing entries
    const seed = {
      version: 1,
      aliases: {},
      actionVerbs: [],
      mergeLog: Array.from({ length: 100 }, (_, i) => ({
        mergedAt: new Date().toISOString(),
        sourceTitle: `task-a-${i}`,
        targetTitle: `task-b-${i}`,
        similarityAtMerge: 0.8,
        rulesExtracted: [],
      })),
    };
    await fs.writeFile(
      path.join(tmpDir, "data/learned-dedup-rules.json"),
      JSON.stringify(seed),
    );
    await recordMergeForLearning("one more source", "one more target");
    const raw = await fs.readFile(path.join(tmpDir, "data/learned-dedup-rules.json"), "utf8");
    const rules = JSON.parse(raw);
    expect(rules.mergeLog).toHaveLength(100);
    expect(rules.mergeLog[99].sourceTitle).toBe("one more source");
  });

  it("does not overwrite existing learned alias", async () => {
    const seed = {
      version: 1,
      aliases: { retro: "retrospective" },
      actionVerbs: [],
      mergeLog: [],
    };
    await fs.writeFile(
      path.join(tmpDir, "data/learned-dedup-rules.json"),
      JSON.stringify(seed),
    );
    // Try to learn a different mapping for "retro"
    await recordMergeForLearning("retro with team", "retroactive with team");
    const raw = await fs.readFile(path.join(tmpDir, "data/learned-dedup-rules.json"), "utf8");
    const rules = JSON.parse(raw);
    expect(rules.aliases.retro).toBe("retrospective");
  });
});
