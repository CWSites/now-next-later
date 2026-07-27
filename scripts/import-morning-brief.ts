#!/usr/bin/env node
/**
 * Parse the latest morning-brief artifact and import its Today / This Week /
 * This Month checklists as Now / Next / Later tasks.
 *
 *   npm run import:brief -- [--path /path/to/index.html] [--dry-run]
 *
 * Default path: ~/Documents/Claude/Artifacts/morning-brief/index.html
 *
 * Dedupe: tasks with source="morning-brief" and identical title (case-
 * insensitive) that already exist are skipped — safe to run daily.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createTask, getAllTasks } from "../lib/storage";
import type { Bucket } from "../lib/types";

const DEFAULT_PATH = path.join(
  os.homedir(),
  "Documents/Claude/Artifacts/morning-brief/index.html",
);

const SECTION_TO_BUCKET: Record<string, Bucket> = {
  Today: "now",
  "This Week": "next",
  "This Month": "later",
};

interface ParsedItem {
  bucket: Bucket;
  title: string;
  sourceRef: string;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parseBrief(html: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  // Split by section-heading so each chunk begins with a section name.
  const sectionRegex =
    /<div class="section-heading[^"]*">([^<]+)<\/div>([\s\S]*?)(?=<div class="section-heading|<\/div>\s*<\/div>\s*<\/body>|$)/g;

  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(html)) !== null) {
    const sectionName = match[1].trim();
    const bucket = SECTION_TO_BUCKET[sectionName];
    if (!bucket) continue;

    const body = match[2];
    const itemRegex =
      /<div class="check-title">([\s\S]*?)<\/div>\s*<div class="check-sentence">([\s\S]*?)<\/div>/g;
    let m: RegExpExecArray | null;
    while ((m = itemRegex.exec(body)) !== null) {
      const title = stripTags(m[1]);
      const sourceRef = stripTags(m[2]);
      if (title) items.push({ bucket, title, sourceRef });
    }
  }
  return items;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const pathArg = args.indexOf("--path");
  const briefPath = pathArg !== -1 ? args[pathArg + 1] : DEFAULT_PATH;

  const html = await fs.readFile(briefPath, "utf8");
  const items = parseBrief(html);

  if (items.length === 0) {
    console.error("No items parsed. Check the artifact structure at:", briefPath);
    process.exit(1);
  }

  const existing = await getAllTasks();
  const existingKeys = new Set(
    existing
      .filter((t) => t.source === "morning-brief")
      .map((t) => t.title.trim().toLowerCase()),
  );

  const toCreate = items.filter((it) => !existingKeys.has(it.title.toLowerCase()));
  const skipped = items.length - toCreate.length;

  console.log(`Source: ${briefPath}`);
  console.log(`Parsed ${items.length} items across ${new Set(items.map((i) => i.bucket)).size} buckets.`);
  console.log(`  ${toCreate.length} new, ${skipped} already imported.`);

  if (dryRun) {
    for (const it of toCreate) {
      console.log(`  [${it.bucket}] ${it.title} — ${it.sourceRef}`);
    }
    console.log("(dry-run — no writes)");
    return;
  }

  for (const it of toCreate) {
    await createTask({
      title: it.title,
      bucket: it.bucket,
      notes: it.sourceRef,
      source: "morning-brief",
      sourceRef: it.sourceRef,
    });
    console.log(`  + [${it.bucket}] ${it.title}`);
  }

  console.log(`Imported ${toCreate.length} task(s). Git sync will push shortly.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
