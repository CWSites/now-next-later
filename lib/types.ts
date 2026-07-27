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
  /** Optional provenance, e.g. "morning-brief". Used to dedupe on re-import. */
  source?: string;
  /** Optional short source blurb, e.g. "In Jira PEPPERMINT-2826." */
  sourceRef?: string;
}

export interface TasksFile {
  version: 1;
  tasks: Task[];
}
