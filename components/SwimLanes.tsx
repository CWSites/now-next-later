"use client";

import { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Bucket, Priority, Task } from "@/lib/types";
import { BUCKETS } from "@/lib/types";
import { TaskCard } from "./TaskCard";

/**
 * Sentinel id used in the dnd-kit droppable id for cards without a
 * priorityId. Chosen to be unambiguous — no real priority id can be
 * "__unassigned" because the API lowercases + slugs user input.
 */
export const UNASSIGNED_LANE_ID = "__unassigned";

/**
 * dnd-kit droppable id for a swim-lane cell. Encodes both the row
 * (priority) and column (bucket) so Board.onDragEnd can decode a drop
 * target with no extra lookup.
 */
export function swimCellId(priorityId: string, bucket: Bucket): string {
  return `swim:${priorityId}:${bucket}`;
}

/**
 * Reverse of swimCellId. Returns null when the id is not a swim-lane
 * cell id so callers can early-out cleanly.
 */
export function parseSwimCellId(
  id: string,
): { priorityId: string; bucket: Bucket } | null {
  if (!id.startsWith("swim:")) return null;
  const parts = id.split(":");
  if (parts.length !== 3) return null;
  const [, priorityId, bucket] = parts;
  if (!(BUCKETS as string[]).includes(bucket)) return null;
  return { priorityId, bucket: bucket as Bucket };
}

/**
 * Short bucket column labels for the swim-lane header row. The main
 * board uses longer titles ("Now / today"), but space is tight here
 * and the labels are repeated across every row.
 */
const BUCKET_LABELS: Record<Bucket, { title: string; accent: string }> = {
  now: { title: "Now", accent: "text-rose-600 dark:text-rose-400" },
  next: { title: "Next", accent: "text-sky-600 dark:text-sky-400" },
  later: { title: "Later", accent: "text-violet-600 dark:text-violet-400" },
};

interface Props {
  tasks: Task[];
  priorities: Priority[];
  flashMergedId?: string | null;
  justArrivedIds?: Set<string>;
  onUpdate: (
    id: string,
    patch: Omit<Partial<Task>, "priorityId" | "category"> & {
      priorityId?: string | null;
      category?: string | null;
    },
  ) => void;
  onDelete: (id: string) => void;
}

interface Row {
  key: string;
  priorityId: string | null;
  label: string;
  /** Human-readable rank badge, e.g. "#1". Null for the Unassigned row. */
  rank: string | null;
  colorClasses: string;
}

const COLOR_CLASSES: Record<string, string> = {
  rose: "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-200 dark:ring-rose-900",
  amber: "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:ring-amber-900",
  emerald: "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:ring-emerald-900",
  sky: "bg-sky-100 text-sky-800 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-200 dark:ring-sky-900",
  violet: "bg-violet-100 text-violet-800 ring-violet-200 dark:bg-violet-950/60 dark:text-violet-200 dark:ring-violet-900",
  neutral: "bg-neutral-100 text-neutral-700 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:ring-neutral-700",
};

export function SwimLanes({
  tasks,
  priorities,
  flashMergedId,
  justArrivedIds,
  onUpdate,
  onDelete,
}: Props) {
  // Build the row list once per render: ranked, non-retired priorities
  // in order, then the Unassigned catch-all at the bottom. Reading-list
  // items ("book") are hidden here — they're an orthogonal sub-grouping
  // and the main board still shows them in Later.
  const rows = useMemo<Row[]>(() => {
    const visible = priorities
      .filter((p) => !p.retired)
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .map<Row>((p) => ({
        key: p.id,
        priorityId: p.id,
        label: p.label,
        rank: `#${p.rank}`,
        colorClasses: COLOR_CLASSES[p.color ?? "neutral"] ?? COLOR_CLASSES.neutral,
      }));
    visible.push({
      key: UNASSIGNED_LANE_ID,
      priorityId: null,
      label: "Unassigned",
      rank: null,
      colorClasses: COLOR_CLASSES.neutral,
    });
    return visible;
  }, [priorities]);

  // Pre-partition tasks by (priorityId, bucket) once. For a card with a
  // priorityId that doesn't correspond to any current priority (e.g.
  // the priority was deleted), fall through to Unassigned so the task
  // doesn't vanish from view.
  const cells = useMemo(() => {
    const map = new Map<string, Task[]>();
    const knownIds = new Set(priorities.filter((p) => !p.retired).map((p) => p.id));
    for (const t of tasks) {
      if (t.category === "book") continue; // books don't belong in the priority grid
      const effectivePid =
        t.priorityId && knownIds.has(t.priorityId) ? t.priorityId : UNASSIGNED_LANE_ID;
      const key = `${effectivePid}:${t.bucket}`;
      const list = map.get(key);
      if (list) list.push(t);
      else map.set(key, [t]);
    }
    // Within a cell, keep the user's manual ordering and sink completed
    // tasks to the bottom (same convention as the regular column view).
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return a.position - b.position;
      });
    }
    return map;
  }, [tasks, priorities]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        {/* Header row: priority column + three bucket columns. */}
        <div className="sticky top-0 z-10 grid grid-cols-[160px_1fr_1fr_1fr] gap-2 border-b border-neutral-200 bg-white/80 py-2 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
          <div className="px-1 text-[11px] uppercase tracking-wider text-neutral-400">
            Priority
          </div>
          {BUCKETS.map((b) => (
            <div
              key={b}
              className={`px-1 text-[11px] font-semibold uppercase tracking-wider ${BUCKET_LABELS[b].accent}`}
            >
              {BUCKET_LABELS[b].title}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 py-2">
          {rows.map((row) => (
            <div
              key={row.key}
              className="grid grid-cols-[160px_1fr_1fr_1fr] gap-2"
            >
              {/* Left column: priority label + rank badge. */}
              <div className="flex items-start pt-2">
                <div
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold ring-1 ${row.colorClasses}`}
                >
                  {row.rank ? (
                    <span className="tabular-nums opacity-70">{row.rank}</span>
                  ) : null}
                  <span className="max-w-[8rem] truncate">{row.label}</span>
                </div>
              </div>

              {BUCKETS.map((bucket) => {
                const key = `${row.priorityId ?? UNASSIGNED_LANE_ID}:${bucket}`;
                const cellTasks = cells.get(key) ?? [];
                return (
                  <SwimCell
                    key={bucket}
                    priorityId={row.priorityId ?? UNASSIGNED_LANE_ID}
                    bucket={bucket}
                    tasks={cellTasks}
                    flashMergedId={flashMergedId}
                    justArrivedIds={justArrivedIds}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    priorities={priorities}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface SwimCellProps {
  priorityId: string;
  bucket: Bucket;
  tasks: Task[];
  priorities: Priority[];
  flashMergedId?: string | null;
  justArrivedIds?: Set<string>;
  onUpdate: (
    id: string,
    patch: Omit<Partial<Task>, "priorityId" | "category"> & {
      priorityId?: string | null;
      category?: string | null;
    },
  ) => void;
  onDelete: (id: string) => void;
}

function SwimCell({
  priorityId,
  bucket,
  tasks,
  priorities,
  flashMergedId,
  justArrivedIds,
  onUpdate,
  onDelete,
}: SwimCellProps) {
  const id = swimCellId(priorityId, bucket);
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={`min-h-[56px] rounded-md border p-1.5 transition-colors ${
          isOver
            ? "border-blue-400 bg-blue-50/60 ring-1 ring-blue-300 dark:border-blue-500 dark:bg-blue-950/40"
            : "border-neutral-200/70 bg-white/40 dark:border-neutral-800 dark:bg-neutral-900/40"
        }`}
      >
        <ul className="flex flex-col gap-1.5">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              priorities={priorities}
              justMerged={flashMergedId === task.id}
              justArrived={justArrivedIds?.has(task.id) ?? false}
              onToggle={() => onUpdate(task.id, { completed: !task.completed })}
              onEdit={(title) => onUpdate(task.id, { title })}
              onDelete={() => onDelete(task.id)}
              onSetPriority={(pid) => onUpdate(task.id, { priorityId: pid })}
            />
          ))}
          {tasks.length === 0 ? (
            <li
              className={`rounded border border-dashed py-3 text-center text-[11px] italic transition-colors ${
                isOver
                  ? "border-blue-400 text-blue-600 dark:border-blue-500 dark:text-blue-300"
                  : "border-neutral-200 text-neutral-400 dark:border-neutral-800"
              }`}
            >
              {isOver ? "drop here" : "—"}
            </li>
          ) : null}
        </ul>
      </div>
    </SortableContext>
  );
}
