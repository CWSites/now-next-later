export type Bucket = "now" | "next" | "later";

export const BUCKETS: Bucket[] = ["now", "next", "later"];

export interface Task {
  id: string;
  title: string;
  notes?: string;
  bucket: Bucket;
  /** Sort order within the bucket. Lower = higher in list. */
  position: number;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  /** When true, hide from the main board even if completedAt is still today.
   * Set by the manual "Archive completed" button; auto-cleared when the
   * task is un-completed. Auto-archive at midnight is separately derived
   * from completedAt, so this field is only for early-archival intent. */
  archived?: boolean;
  /** Optional provenance, e.g. "morning-brief". Used to dedupe on re-import. */
  source?: string;
  /** Optional short source blurb, e.g. "In Jira PEPPERMINT-2826." */
  sourceRef?: string;
  /** Stable id from the source system, e.g. "jira:PEPPERMINT-2826". Used for upsert. */
  externalId?: string;
  /** Deep-link back to the origin (Jira issue, Slack message, calendar event, ...). */
  url?: string;
  /** Optional sub-grouping within a bucket. Currently only 'book' is
   *  meaningful (renders in a Reading-list subsection at the bottom of
   *  the Later column), but the field is a freeform string so future
   *  categories don't require a schema migration. Empty / undefined =
   *  no sub-grouping. */
  category?: string;
  /** Optional link to a user-defined Priority (see TasksFile.priorities).
   *  undefined = unassigned. Priorities are an orthogonal axis to
   *  bucket (now/next/later) — a task has at most one priority. */
  priorityId?: string;
}

/**
 * A user-defined focus area for ranking work (e.g. "Hiring", "Squad
 * Support", "Internationalization"). Lives in TasksFile.priorities so it
 * syncs with tasks via the same git sync. Ranks are 1-based and define
 * the display order; the `#N` badge on a task card shows the rank.
 */
export interface Priority {
  id: string;
  label: string;
  /** 1-based rank. Determines sort order and the `#N` badge. */
  rank: number;
  /** Optional accent color token (tailwind-friendly short name, e.g.
   *  "rose" | "amber" | "emerald"). Rendered via a lookup in TaskCard
   *  so arbitrary user input can't inject class names. */
  color?: string;
  /** When true, hide from pickers but keep historical tasks' priorityId
   *  valid so their badges still render. */
  retired?: boolean;
}

/**
 * Persistent record of an externalId whose task the user explicitly deleted
 * (as opposed to completed). We keep these so that when an adapter re-fetches
 * the same source item on the next refresh, we don't silently re-create the
 * task the user already told us they don't want on the board.
 *
 * Completed tasks are NOT tombstoned — they stay in the tasks list as history
 * and auto-archive off the columns at end of day.
 */
export interface Tombstone {
  externalId: string;
  deletedAt: string;
  /** Snapshot of the title at deletion time — handy for debugging. */
  title?: string;
  /** Where it came from (jira, slack, gcal, ...). */
  source?: string;
}

export interface TasksFile {
  version: 1;
  tasks: Task[];
  tombstones?: Tombstone[];
  priorities?: Priority[];
}
