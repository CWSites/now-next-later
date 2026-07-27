#!/usr/bin/env node
/**
 * CLI-triggered ingest run. Used by launchd for the scheduled morning
 * refresh; the UI hits POST /api/ingest for on-demand refresh.
 *
 *   npm run ingest
 *
 * Expects .env.local (or a wrapping `--env-file`) to supply credentials.
 */
import { loadEnvLocal } from "../lib/env";
loadEnvLocal();

import { runIngest } from "../ingest/run";

async function main() {
  const summary = await runIngest();
  console.log(JSON.stringify(summary, null, 2));
  const errored = summary.adapters.filter((a) => a.error);
  if (errored.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
