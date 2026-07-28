import type { Adapter, AdapterIngestResult, AdapterResult } from "./adapters/base";
import { jiraAdapter } from "./adapters/jira";
import { slackAdapter } from "./adapters/slack";
import { gcalAdapter } from "./adapters/gcal";
import { granolaAdapter } from "./adapters/granola";
import { fellowAdapter } from "./adapters/fellow";
import { latticeAdapter } from "./adapters/lattice";
import { deleteByExternalId, upsertByExternalId } from "@/lib/storage";
import { ensurePulled } from "@/lib/git-sync";
import { REPO_ROOT } from "@/lib/storage";
import { applySecretsToEnv } from "@/lib/secrets";

// Register adapters here. New adapters just need to be added to this list.
const ADAPTERS: Adapter[] = [
  jiraAdapter,
  slackAdapter,
  gcalAdapter,
  granolaAdapter,
  fellowAdapter,
  latticeAdapter,
];

export interface IngestSummary {
  startedAt: string;
  finishedAt: string;
  adapters: AdapterResult[];
  totalCreated: number;
  totalUpdated: number;
  totalRemoved: number;
}

export async function runIngest(): Promise<IngestSummary> {
  await applySecretsToEnv();
  await ensurePulled(REPO_ROOT);
  const startedAt = new Date().toISOString();
  const results: AdapterResult[] = [];

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
      for (const item of items) {
        const { created: wasCreated } = await upsertByExternalId({
          externalId: item.externalId,
          title: item.title,
          bucket: item.bucket,
          notes: item.notes,
          source: adapter.name,
          sourceRef: item.sourceRef,
          url: item.url,
        });
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
      });
    } catch (err) {
      results.push({
        name: adapter.name,
        ran: true,
        fetched: 0,
        created: 0,
        updated: 0,
        removed: 0,
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
  };
}
