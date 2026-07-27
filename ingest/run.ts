import type { Adapter, AdapterResult } from "./adapters/base";
import { jiraAdapter } from "./adapters/jira";
import { slackAdapter } from "./adapters/slack";
import { upsertByExternalId } from "@/lib/storage";
import { ensurePulled } from "@/lib/git-sync";
import { REPO_ROOT } from "@/lib/storage";
import { applySecretsToEnv } from "@/lib/secrets";

// Register adapters here. New adapters just need to be added to this list.
const ADAPTERS: Adapter[] = [jiraAdapter, slackAdapter];

export interface IngestSummary {
  startedAt: string;
  finishedAt: string;
  adapters: AdapterResult[];
  totalCreated: number;
  totalUpdated: number;
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
      });
      continue;
    }
    try {
      const items = await adapter.ingest();
      let created = 0;
      let updated = 0;
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
      results.push({
        name: adapter.name,
        ran: true,
        fetched: items.length,
        created,
        updated,
      });
    } catch (err) {
      results.push({
        name: adapter.name,
        ran: true,
        fetched: 0,
        created: 0,
        updated: 0,
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
  };
}
