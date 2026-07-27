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

export interface Adapter {
  /** Short stable name, also used as the tasks' `source` field. */
  name: string;
  /** Return true when config/env is present for this adapter to run. */
  enabled(): boolean;
  /** Reason string when enabled() is false — surfaced in ingest results. */
  disabledReason?(): string;
  /** Fetch items. Called once per ingest run. */
  ingest(): Promise<IngestItem[]>;
}

export interface AdapterResult {
  name: string;
  ran: boolean;
  reason?: string;
  fetched: number;
  created: number;
  updated: number;
  error?: string;
}
