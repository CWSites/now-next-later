import type { Bucket } from "@/lib/types";

export interface IngestItem {
  /** Stable id across runs, e.g. "jira:PEPPERMINT-2826". Used for upsert. */
  externalId: string;
  title: string;
  bucket: Bucket;
  /** Short prose describing the source, e.g. "In Jira PEPPERMINT-2826 (In Progress)". */
  sourceRef?: string;
  /** Extended notes, if any. */
  notes?: string;
  /** Deep-link to the source system. */
  url?: string;
}

/**
 * An adapter can return either a bare list of items to upsert, or an object
 * with items plus explicit `removedExternalIds` — tasks the runner should
 * delete because the adapter has decided they no longer belong.
 *
 * We intentionally do NOT infer deletions from "was in previous ingest but
 * not in this one" — that would nuke everything on a transient API failure.
 * Adapters must explicitly opt in per-id.
 */
export interface AdapterIngestResult {
  items: IngestItem[];
  removedExternalIds?: string[];
}

export interface Adapter {
  /** Short stable name, also used as the tasks' `source` field. */
  name: string;
  /** Return true when config/env is present for this adapter to run. */
  enabled(): boolean;
  /** Reason string when enabled() is false — surfaced in ingest results. */
  disabledReason?(): string;
  /** Fetch items. Called once per ingest run. */
  ingest(): Promise<IngestItem[] | AdapterIngestResult>;
}

export interface AdapterResult {
  name: string;
  ran: boolean;
  reason?: string;
  fetched: number;
  created: number;
  updated: number;
  removed: number;
  skipped: number;
  error?: string;
}
