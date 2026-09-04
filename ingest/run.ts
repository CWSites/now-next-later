import type { Adapter, AdapterIngestResult, AdapterResult } from "./adapters/base";
import { jiraAdapter } from "./adapters/jira";
import { slackAdapter } from "./adapters/slack";
import { gcalAdapter } from "./adapters/gcal";
import { granolaAdapter } from "./adapters/granola";
import { fellowAdapter } from "./adapters/fellow";
import { deleteByExternalId, getAllTasks, upsertByExternalId } from "@/lib/storage";
import { ensurePulled } from "@/lib/git-sync";
import { REPO_ROOT } from "@/lib/storage";
import { applySecretsToEnv } from "@/lib/secrets";
import { shouldSkipAsDuplicate } from "@/lib/ingest-dedup";

// Register adapters here. New adapters just need to be added to this list.
// Lattice is intentionally NOT here — its session cookies are HttpOnly, so
// syncing has to happen in-browser. See components/LatticeBookmarklet.tsx
// and /api/settings/lattice/sync.
const ADAPTERS: Adapter[] = [
  jiraAdapter,
  slackAdapter,
  gcalAdapter,
  granolaAdapter,
  fellowAdapter,
];

export interface IngestSummary {
  startedAt: string;
  finishedAt: string;
  adapters: AdapterResult[];
  totalCreated: number;
  totalUpdated: number;
  totalRemoved: number;
  totalSkipped: number;
}

export async function runIngest(): Promise<IngestSummary> {
  await applySecretsToEnv();
  await ensurePulled(REPO_ROOT);
  const startedAt = new Date().toISOString();
  const results: AdapterResult[] = [];

  // Snapshot the task list once at the start. New items from this ingest
  // run get compared against this baseline (not against each other or
  // items we just upserted), so within-run ordering doesn't matter.
  const preIngest = await getAllTasks();

  for (const adapter of ADAPTERS) {
    if (!adapter.enabled()) {
      results.push({
        name: adapter.name,
        ran: false,
        reason: adapter.disabledReason?.() ?? "disabled",
        fetched: 0,
        created: 0,
        updated: 0,
        removed: 0,
        skipped: 0,
      });
      continue;
    }
    try {
      const raw = await adapter.ingest();
      const normalized: AdapterIngestResult = Array.isArray(raw) ? { items: raw } : raw;
      const items = normalized.items;
      const removals = normalized.removedExternalIds ?? [];
      let created = 0;
      let updated = 0;
      let removed = 0;
      let skipped = 0;
      for (const item of items) {
        // Existing-task upsert (same externalId): always run — that's the
        // normal "refresh this Jira ticket's title" path.
        const existingSame = preIngest.find((t) => t.externalId === item.externalId);
        if (!existingSame) {
          // No same-externalId match: check for semantic duplicates against
          // the pre-ingest snapshot before creating a fresh task.
          const dupOf = shouldSkipAsDuplicate(item, preIngest);
          if (dupOf) {
            skipped++;
            continue;
          }
        }
        const { created: wasCreated, tombstoned } = await upsertByExternalId({
          externalId: item.externalId,
          title: item.title,
          bucket: item.bucket,
          notes: item.notes,
          source: adapter.name,
          sourceRef: item.sourceRef,
          url: item.url,
          sourceCompleted: item.completed,
        });
        if (tombstoned) {
          // User deleted this externalId before — keep it dead.
          skipped++;
          continue;
        }
        if (wasCreated) created++;
        else updated++;
      }
      for (const externalId of removals) {
        const { deleted } = await deleteByExternalId(externalId, { source: adapter.name });
        if (deleted) removed++;
      }
      results.push({
        name: adapter.name,
        ran: true,
        fetched: items.length,
        created,
        updated,
        removed,
        skipped,
      });
    } catch (err) {
      results.push({
        name: adapter.name,
        ran: true,
        fetched: 0,
        created: 0,
        updated: 0,
        removed: 0,
        skipped: 0,
        error: (err as Error).message,
      });
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    adapters: results,
    totalCreated: results.reduce((n, r) => n + r.created, 0),
    totalUpdated: results.reduce((n, r) => n + r.updated, 0),
    totalRemoved: results.reduce((n, r) => n + r.removed, 0),
    totalSkipped: results.reduce((n, r) => n + r.skipped, 0),
  };
}
