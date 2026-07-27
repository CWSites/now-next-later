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
}

export interface TasksFile {
  version: 1;
  tasks: Task[];
}
