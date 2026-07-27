#!/usr/bin/env node
/**
 * One-shot backfill: scan existing tasks for Jira ticket IDs mentioned in
 * title or notes, and stamp externalId + url so future Jira ingest runs
 * match cleanly instead of creating duplicates.
 *
 *   npm run backfill:links -- [--dry-run]
 *
 * Idempotent: tasks that already have an externalId are skipped.
 * Never touches: completed, bucket, position, title, notes.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_FILE, REPO_ROOT } from "../lib/storage";
import type { TasksFile } from "../lib/types";

const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const raw = await fs.readFile(DATA_FILE, "utf8");
  const file = JSON.parse(raw) as TasksFile;

  const jiraBase = process.env.JIRA_URL?.replace(/\/+$/, "") ?? "https://example.atlassian.net";

  let updated = 0;
  const changes: string[] = [];
  for (const t of file.tasks) {
    if (t.externalId) continue;
    const haystack = `${t.title} ${t.notes ?? ""} ${t.sourceRef ?? ""}`;
    const m = haystack.match(JIRA_KEY_RE);
    if (!m) continue;
    const key = m[1];
    t.externalId = `jira:${key}`;
    t.url = `${jiraBase}/browse/${key}`;
    // Preserve everything else — bucket, position, completed, title, notes.
    updated++;
    changes.push(`  ${key} → ${t.title.slice(0, 60)}${t.completed ? " (✓ completed, preserved)" : ""}`);
  }

  console.log(`Scanned ${file.tasks.length} tasks, ${updated} matched a Jira key.`);
  changes.forEach((c) => console.log(c));

  if (updated === 0) {
    console.log("Nothing to backfill.");
    return;
  }
  if (dryRun) {
    console.log("(dry-run — no writes)");
    return;
  }

  await fs.writeFile(DATA_FILE, JSON.stringify(file, null, 2) + "\n");
  console.log(`Wrote ${path.relative(REPO_ROOT, DATA_FILE)}. Git sync will push shortly.`);

  // Trigger git-sync directly since we bypassed storage.ts.
  const { queueSync } = await import("../lib/git-sync");
  queueSync(REPO_ROOT, DATA_FILE, `backfill: ${updated} Jira link(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
