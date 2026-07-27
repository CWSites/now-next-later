import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Bucket, Task, TasksFile } from "./types";
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
    if (!parsed.tasks) return { version: 1, tasks: [] };
    return parsed;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      const empty: TasksFile = { version: 1, tasks: [] };
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
  position?: number;
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
    }
    if (bucketChanged) {
      task.bucket = input.bucket!;
      task.position = nextPosition(file.tasks.filter((t) => t.id !== id), input.bucket!);
    }
    if (input.position !== undefined) task.position = input.position;
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
    await writeFile(file, `delete: ${removed.title.slice(0, 60)}`);
    return true;
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
  task: Task;
  created: boolean;
  adopted: boolean;
}> {
  return serialize(async () => {
    const file = await readFile();
    let existing = file.tasks.find((t) => t.externalId === input.externalId);
    let adopted = false;

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
      let changed = false;
      if (input.title && input.title.trim() !== existing.title) {
        existing.title = input.title.trim();
        changed = true;
      }
      if (input.notes !== undefined && input.notes !== existing.notes) {
        existing.notes = input.notes?.trim() || undefined;
        changed = true;
      }
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
      return { task: existing, created: false, adopted };
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
    return { task, created: true, adopted: false };
  });
}

export { DATA_FILE, REPO_ROOT };
