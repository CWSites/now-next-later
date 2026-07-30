import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Bucket, Task, TasksFile, Tombstone } from "./types";
import { queueSync } from "./git-sync";

const REPO_ROOT = process.env.DATA_REPO_PATH
  ? path.resolve(process.env.DATA_REPO_PATH)
  : process.cwd();

const DATA_FILE = path.join(REPO_ROOT, "data", "tasks.json");

// Serialize all reads/writes so concurrent API calls can't clobber each other.
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

async function readFile(): Promise<TasksFile> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as TasksFile;
    if (!parsed.tasks) return { version: 1, tasks: [], tombstones: [] };
    if (!parsed.tombstones) parsed.tombstones = [];
    return parsed;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      const empty: TasksFile = { version: 1, tasks: [], tombstones: [] };
      await fs.writeFile(DATA_FILE, JSON.stringify(empty, null, 2) + "\n");
      return empty;
    }
    throw err;
  }
}

async function writeFile(file: TasksFile, message: string): Promise<void> {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(file, null, 2) + "\n");
  queueSync(REPO_ROOT, DATA_FILE, message);
}

export async function getAllTasks(): Promise<Task[]> {
  return serialize(async () => (await readFile()).tasks);
}

function nextPosition(tasks: Task[], bucket: Bucket): number {
  const max = tasks
    .filter((t) => t.bucket === bucket)
    .reduce((m, t) => Math.max(m, t.position), -1);
  return max + 1;
}

export interface CreateTaskInput {
  title: string;
  bucket?: Bucket;
  notes?: string;
  source?: string;
  sourceRef?: string;
  externalId?: string;
  url?: string;
  category?: string;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  return serialize(async () => {
    const file = await readFile();
    const bucket: Bucket = input.bucket ?? "now";
    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      title: input.title.trim(),
      notes: input.notes?.trim() || undefined,
      bucket,
      position: nextPosition(file.tasks, bucket),
      completed: false,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      source: input.source,
      sourceRef: input.sourceRef,
      externalId: input.externalId,
      url: input.url,
      category: input.category?.trim() || undefined,
    };
    file.tasks.push(task);
    await writeFile(file, `add: ${task.title.slice(0, 60)}`);
    return task;
  });
}

export interface UpdateTaskInput {
  title?: string;
  notes?: string | null;
  bucket?: Bucket;
  completed?: boolean;
  archived?: boolean;
  position?: number;
  /** Pass `null` to clear the category. */
  category?: string | null;
}

export async function updateTask(id: string, input: UpdateTaskInput): Promise<Task | null> {
  return serialize(async () => {
    const file = await readFile();
    const task = file.tasks.find((t) => t.id === id);
    if (!task) return null;

    const now = new Date().toISOString();
    const bucketChanged = input.bucket && input.bucket !== task.bucket;

    if (input.title !== undefined) task.title = input.title.trim();
    if (input.notes !== undefined) task.notes = input.notes?.trim() || undefined;
    if (input.completed !== undefined) {
      task.completed = input.completed;
      task.completedAt = input.completed ? now : null;
      // Un-completing always clears the archive flag — the task is going
      // back to its column, so it can't stay hidden.
      if (!input.completed) task.archived = undefined;
    }
    if (input.archived !== undefined) {
      task.archived = input.archived || undefined;
    }
    if (bucketChanged) {
      task.bucket = input.bucket!;
      task.position = nextPosition(file.tasks.filter((t) => t.id !== id), input.bucket!);
    }
    if (input.position !== undefined) task.position = input.position;
    if (input.category !== undefined) {
      const c = input.category?.trim();
      task.category = c ? c : undefined;
    }
    task.updatedAt = now;

    await writeFile(file, `update: ${task.title.slice(0, 60)}`);
    return task;
  });
}

export async function deleteTask(id: string): Promise<boolean> {
  return serialize(async () => {
    const file = await readFile();
    const idx = file.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    const [removed] = file.tasks.splice(idx, 1);
    // If this task came from an ingest source, drop a tombstone so the next
    // adapter run doesn't silently re-create it. Manually-added tasks (no
    // externalId) don't need tombstones — nothing will try to resurrect them.
    if (removed.externalId) {
      addTombstone(file, {
        externalId: removed.externalId,
        deletedAt: new Date().toISOString(),
        title: removed.title,
        source: removed.source,
      });
    }
    await writeFile(file, `delete: ${removed.title.slice(0, 60)}`);
    return true;
  });
}

/**
 * Push a tombstone onto the file, de-duping by externalId (the newer entry
 * wins) and capping list size so it doesn't grow without bound.
 */
function addTombstone(file: TasksFile, tomb: Tombstone): void {
  if (!file.tombstones) file.tombstones = [];
  file.tombstones = file.tombstones.filter((t) => t.externalId !== tomb.externalId);
  file.tombstones.push(tomb);
  // Cap at 500 most-recent to avoid runaway file growth. Adapters keying
  // by natural IDs means this is only reached with heavy churn.
  if (file.tombstones.length > 500) {
    file.tombstones.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
    file.tombstones = file.tombstones.slice(0, 500);
  }
}

/**
 * Remove a task's tombstone. Called when the user explicitly re-adopts an
 * item (e.g. via a future 'un-delete' UI) or when they manually create a
 * task whose external id matches. Not currently invoked automatically.
 */
export async function clearTombstone(externalId: string): Promise<boolean> {
  return serialize(async () => {
    const file = await readFile();
    const before = file.tombstones?.length ?? 0;
    file.tombstones = (file.tombstones ?? []).filter((t) => t.externalId !== externalId);
    if ((file.tombstones.length ?? 0) === before) return false;
    await writeFile(file, `untombstone: ${externalId}`);
    return true;
  });
}

/**
 * Return the current tombstone list. Read-only view.
 */
export async function getTombstones(): Promise<Tombstone[]> {
  return serialize(async () => (await readFile()).tombstones ?? []);
}

/**
 * Merge one task into another. The `target` task keeps its id, bucket,
 * position, and completion state — the user chose it by dropping onto it,
 * so that's the row they want to survive. The `source` task's metadata
 * (sourceRef, url, notes, externalId) is folded in when target's slot is
 * empty, and the source task is then deleted.
 *
 * If both tasks have externalIds, target's wins as the live tracker and
 * source's externalId is tombstoned so its adapter doesn't resurrect it
 * on the next refresh.
 */
export async function mergeTasks(
  sourceId: string,
  targetId: string,
): Promise<{ merged: boolean; reason?: string; task?: Task }> {
  if (sourceId === targetId) return { merged: false, reason: "same-task" };
  return serialize(async () => {
    const file = await readFile();
    const source = file.tasks.find((t) => t.id === sourceId);
    const target = file.tasks.find((t) => t.id === targetId);
    if (!source || !target) return { merged: false, reason: "not-found" };

    const now = new Date().toISOString();

    // Fold source into target. Prefer target's existing values; fill in
    // gaps from source. sourceRef combines both when they differ so the
    // provenance of both original tasks is preserved on the merged card.
    if (!target.notes && source.notes) target.notes = source.notes;
    if (!target.url && source.url) target.url = source.url;
    if (source.sourceRef) {
      if (!target.sourceRef) {
        target.sourceRef = source.sourceRef;
      } else if (
        !target.sourceRef.toLowerCase().includes(source.sourceRef.toLowerCase()) &&
        !source.sourceRef.toLowerCase().includes(target.sourceRef.toLowerCase())
      ) {
        target.sourceRef = `${target.sourceRef} • ${source.sourceRef}`;
      }
    }
    if (!target.source && source.source) target.source = source.source;

    // externalId handling: if target has none, adopt source's. If both do,
    // target's stays; source's gets tombstoned so ingest won't recreate it.
    if (!target.externalId && source.externalId) {
      target.externalId = source.externalId;
    } else if (
      source.externalId &&
      target.externalId &&
      source.externalId !== target.externalId
    ) {
      addTombstone(file, {
        externalId: source.externalId,
        deletedAt: now,
        title: source.title,
        source: source.source,
      });
    } else if (source.externalId && !target.externalId) {
      // Already handled above; kept for clarity.
    }
    target.updatedAt = now;

    // Remove source.
    file.tasks = file.tasks.filter((t) => t.id !== sourceId);

    await writeFile(
      file,
      `merge: ${source.title.slice(0, 40)} → ${target.title.slice(0, 40)}`,
    );
    return { merged: true, task: target };
  });
}

/**
 * Replace the ordered id list for a bucket. Ids not in the list keep their
 * current bucket assignment; ids present are re-bucketed and re-positioned.
 */
export async function reorderBucket(bucket: Bucket, orderedIds: string[]): Promise<Task[]> {
  return serialize(async () => {
    const file = await readFile();
    const now = new Date().toISOString();
    const idSet = new Set(orderedIds);

    orderedIds.forEach((id, index) => {
      const task = file.tasks.find((t) => t.id === id);
      if (!task) return;
      task.bucket = bucket;
      task.position = index;
      task.updatedAt = now;
    });

    // Compact positions for other tasks in this bucket that weren't in the list.
    const remaining = file.tasks
      .filter((t) => t.bucket === bucket && !idSet.has(t.id))
      .sort((a, b) => a.position - b.position);
    remaining.forEach((t, i) => {
      t.position = orderedIds.length + i;
    });

    await writeFile(file, `reorder: ${bucket}`);
    return file.tasks;
  });
}

/**
 * Upsert a task by externalId. If a task with the same externalId exists,
 * mutable fields (title, notes, sourceRef, url) are updated but position,
 * bucket, and completion state are preserved so the user's manual arrangement
 * survives ingest re-runs.
 */
export async function upsertByExternalId(input: CreateTaskInput & { externalId: string }): Promise<{
  task: Task | null;
  created: boolean;
  adopted: boolean;
  tombstoned: boolean;
}> {
  return serialize(async () => {
    const file = await readFile();
    let existing = file.tasks.find((t) => t.externalId === input.externalId);
    let adopted = false;

    // Tombstone check: if the user explicitly deleted a task with this
    // externalId, don't resurrect it on the next ingest. They said no.
    // Only applies when there's no live task with the same externalId —
    // if an existing task somehow exists (e.g. tombstone leaked in), the
    // real task wins and we keep updating it.
    if (!existing) {
      const tombstoned = (file.tombstones ?? []).some(
        (t) => t.externalId === input.externalId,
      );
      if (tombstoned) {
        return { task: null, created: false, adopted: false, tombstoned: true };
      }
    }

    // Title-fallback adoption: if no externalId match, look for an unclaimed
    // task with the same title (case-insensitive) — typically one imported
    // earlier from the morning-brief. Attach the externalId + url so future
    // ingest runs find it cleanly. Never overwrites completion or position.
    if (!existing) {
      const norm = input.title.trim().toLowerCase();
      // Strip common prefixes like "[PEPPERMINT-2826] " for matching.
      const stripped = norm.replace(/^\[[a-z]+-\d+\]\s*/i, "");
      existing = file.tasks.find(
        (t) =>
          !t.externalId &&
          (t.title.trim().toLowerCase() === norm ||
            t.title.trim().toLowerCase() === stripped),
      );
      if (existing) adopted = true;
    }

    const now = new Date().toISOString();

    if (existing) {
      // Preservation invariant: once a task exists, the user owns its
      // title, bucket, position, completed state, and notes. Adapters may
      // only refresh the metadata pointing back at the source: sourceRef
      // and url. This keeps re-ingest safe and non-destructive.
      let changed = false;
      if (input.sourceRef !== undefined && input.sourceRef !== existing.sourceRef) {
        existing.sourceRef = input.sourceRef;
        changed = true;
      }
      if (input.url && input.url !== existing.url) {
        existing.url = input.url;
        changed = true;
      }
      if (input.source && !existing.source) existing.source = input.source;
      if (adopted) {
        existing.externalId = input.externalId;
        changed = true;
      }
      if (changed) {
        existing.updatedAt = now;
        await writeFile(file, `${adopted ? "adopt" : "sync"}: ${existing.title.slice(0, 60)}`);
      }
      return { task: existing, created: false, adopted, tombstoned: false };
    }

    const bucket: Bucket = input.bucket ?? "now";
    const task: Task = {
      id: randomUUID(),
      title: input.title.trim(),
      notes: input.notes?.trim() || undefined,
      bucket,
      position: nextPosition(file.tasks, bucket),
      completed: false,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      source: input.source,
      sourceRef: input.sourceRef,
      externalId: input.externalId,
      url: input.url,
    };
    file.tasks.push(task);
    await writeFile(file, `add: ${task.title.slice(0, 60)}`);
    return { task, created: true, adopted: false, tombstoned: false };
  });
}

/**
 * Delete a task by externalId. Used by ingest adapters to purge previously-
 * synced items the source no longer considers relevant (e.g. calendar
 * events matching the user's skip list, closed Jira tickets in future). We
 * refuse to delete tasks that have been checked off so we never lose a
 * completed-task history entry, and we skip tasks the user manually edited
 * out of the ingested source (source doesn't match) to be conservative.
 */
export async function deleteByExternalId(
  externalId: string,
  opts: { source?: string; tombstone?: boolean } = {},
): Promise<{ deleted: boolean; reason?: string }> {
  return serialize(async () => {
    const file = await readFile();
    const idx = file.tasks.findIndex((t) => t.externalId === externalId);
    if (idx === -1) return { deleted: false, reason: "not-found" };
    const t = file.tasks[idx];
    if (t.completed) return { deleted: false, reason: "completed" };
    if (opts.source && t.source && t.source !== opts.source) {
      return { deleted: false, reason: "source-mismatch" };
    }
    file.tasks.splice(idx, 1);
    // Adapter-driven removals (default) do NOT tombstone — those items
    // were pulled because the source stopped considering them relevant
    // and may legitimately return later. Only user-initiated deletes
    // (opts.tombstone=true) leave a permanent "do not resurrect" marker.
    if (opts.tombstone) {
      addTombstone(file, {
        externalId,
        deletedAt: new Date().toISOString(),
        title: t.title,
        source: t.source,
      });
    }
    await writeFile(file, `remove: ${t.title.slice(0, 60)}`);
    return { deleted: true };
  });
}

export { DATA_FILE, REPO_ROOT };
