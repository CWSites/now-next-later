"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { BUCKETS, Bucket, Task } from "@/lib/types";
import { Column } from "./Column";
import { TaskCard } from "./TaskCard";
import { RecentlyDone } from "./RecentlyDone";
import { groupRecentlyCompleted, isArchivedForToday } from "@/lib/completions";

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "border-neutral-800 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100"
          : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

interface Props {
  initialTasks: Task[];
  dateLabel: string;
}

export function Board({ initialTasks, dateLabel }: Props) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [lastErrors, setLastErrors] = useState<Array<{ name: string; error: string }>>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [view, setView] = useState<"board" | "done">("board");
  // Tracks whether Shift is held during an active drag. When true, dropping
  // onto another task card merges the two instead of reordering.
  const [mergeMode, setMergeMode] = useState(false);
  // Post-merge feedback: id of the target card that just absorbed a merge
  // (flashes for ~1.5s) plus a short toast describing the merge.
  const [flashMergedId, setFlashMergedId] = useState<string | null>(null);
  const [mergeToast, setMergeToast] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const grouped = useMemo(() => {
    const now = new Date();
    const g: Record<Bucket, Task[]> = { now: [], next: [], later: [] };
    for (const t of tasks) {
      // Auto-archive: completed tasks from a previous day disappear from
      // the columns but stay in the JSON (and show up in RecentlyDone).
      // Un-ticking the box clears completedAt and brings them back.
      if (isArchivedForToday(t, now)) continue;
      g[t.bucket].push(t);
    }
    for (const b of BUCKETS) {
      // Completed-today tasks sink to the bottom of their column; within
      // each group, keep the user's manual ordering via `position`.
      g[b].sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return a.position - b.position;
      });
    }
    return g;
  }, [tasks]);

  const recentlyDone = useMemo(() => groupRecentlyCompleted(tasks), [tasks]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.key === "n") {
        e.preventDefault();
        const el = document.getElementById("new-task-now") as HTMLInputElement | null;
        el?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Track Shift held during an active drag so the user can start a normal
  // drag and then press Shift mid-flight (or vice versa) to switch modes.
  useEffect(() => {
    if (!activeId) return;
    function onShift(e: KeyboardEvent) {
      if (e.key === "Shift") setMergeMode(e.type === "keydown");
    }
    window.addEventListener("keydown", onShift);
    window.addEventListener("keyup", onShift);
    return () => {
      window.removeEventListener("keydown", onShift);
      window.removeEventListener("keyup", onShift);
    };
  }, [activeId]);

  async function createTask(title: string, bucket: Bucket, url?: string) {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, bucket, url }),
    });
    if (!res.ok) return;
    const { task } = await res.json();
    setTasks((prev) => [...prev, task]);
  }

  async function updateTask(id: string, patch: Partial<Task>) {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const next: Task = { ...t, ...patch };
        // Mirror server: un-completing clears the archive flag so the task
        // returns to its column instead of staying hidden.
        if (patch.completed === false) next.archived = undefined;
        return next;
      }),
    );
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function archiveAllCompleted() {
    const toArchive = tasks.filter((t) => t.completed && !t.archived);
    if (toArchive.length === 0) return;
    setTasks((prev) =>
      prev.map((t) => (t.completed && !t.archived ? { ...t, archived: true } : t)),
    );
    await Promise.all(
      toArchive.map((t) =>
        fetch(`/api/tasks/${t.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ archived: true }),
        }),
      ),
    );
  }

  async function deleteTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  }

  async function mergeTasks(sourceId: string, targetId: string) {
    const sourceBefore = tasks.find((t) => t.id === sourceId);
    const targetBefore = tasks.find((t) => t.id === targetId);
    // Optimistic: fold source into target locally, then reconcile.
    setTasks((prev) => {
      const source = prev.find((t) => t.id === sourceId);
      const target = prev.find((t) => t.id === targetId);
      if (!source || !target) return prev;
      const nextTarget: Task = {
        ...target,
        notes: target.notes ?? source.notes,
        url: target.url ?? source.url,
        sourceRef:
          !source.sourceRef
            ? target.sourceRef
            : !target.sourceRef
              ? source.sourceRef
              : target.sourceRef.toLowerCase().includes(source.sourceRef.toLowerCase()) ||
                  source.sourceRef.toLowerCase().includes(target.sourceRef.toLowerCase())
                ? target.sourceRef
                : `${target.sourceRef} • ${source.sourceRef}`,
        externalId: target.externalId ?? source.externalId,
      };
      return prev.filter((t) => t.id !== sourceId).map((t) => (t.id === targetId ? nextTarget : t));
    });

    // Fire the flash + toast right after the optimistic update so the user
    // gets immediate feedback even if the network round-trip is slow.
    setFlashMergedId(targetId);
    if (sourceBefore && targetBefore) {
      const src = sourceBefore.title.slice(0, 50);
      const tgt = targetBefore.title.slice(0, 50);
      setMergeToast(`➕ Merged “${src}” into “${tgt}”`);
    }

    const res = await fetch("/api/tasks/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId, targetId }),
    });
    if (!res.ok) {
      // Roll back by refetching truth. Also swap the toast to an error.
      setMergeToast(`⚠️ Merge failed — reverted`);
      await refetchTasks();
    }
  }

  // Clear the flash + toast after a short window so they don't linger.
  useEffect(() => {
    if (!flashMergedId && !mergeToast) return;
    const t = window.setTimeout(() => {
      setFlashMergedId(null);
      setMergeToast(null);
    }, 2200);
    return () => window.clearTimeout(t);
  }, [flashMergedId, mergeToast]);

  async function refetchTasks() {
    const res = await fetch("/api/tasks");
    if (!res.ok) return;
    const { tasks: fresh } = (await res.json()) as { tasks: Task[] };
    setTasks(fresh);
  }

  async function refresh() {
    setRefreshing(true);
    setLastResult(null);
    setLastErrors([]);
    setShowErrors(false);
    try {
      const res = await fetch("/api/ingest", { method: "POST" });
      const summary = await res.json();
      const created = summary.totalCreated ?? 0;
      const updated = summary.totalUpdated ?? 0;
      const removed = summary.totalRemoved ?? 0;
      const dedup = summary.totalSkipped ?? 0;
      const errored: Array<{ name: string; error: string }> = (summary.adapters ?? [])
        .filter((a: { error?: string }) => a.error)
        .map((a: { name: string; error: string }) => ({ name: a.name, error: a.error }));
      const disabled = summary.adapters?.filter((a: { ran: boolean }) => !a.ran) ?? [];
      const parts: string[] = [];
      if (created) parts.push(`${created} new`);
      if (updated) parts.push(`${updated} synced`);
      if (dedup) parts.push(`${dedup} dedup'd`);
      if (removed) parts.push(`${removed} removed`);
      if (errored.length) parts.push(`${errored.map((e) => e.name).join(", ")} errored`);
      if (disabled.length) parts.push(`${disabled.length} disabled`);
      setLastResult(parts.length ? parts.join(" · ") : "no changes");
      setLastErrors(errored);
      // Auto-open the error panel if anything failed — don't make the user
      // hunt for it.
      if (errored.length > 0) setShowErrors(true);
      await refetchTasks();
    } catch (err) {
      setLastResult(`error: ${(err as Error).message}`);
      setLastErrors([{ name: "client", error: (err as Error).message }]);
      setShowErrors(true);
    } finally {
      setRefreshing(false);
    }
  }

  async function persistOrder(bucket: Bucket, orderedIds: string[]) {
    await fetch("/api/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bucket, orderedIds }),
    });
  }

  function findBucket(id: string): Bucket | null {
    if ((BUCKETS as string[]).includes(id)) return id as Bucket;
    const t = tasks.find((x) => x.id === id);
    return t?.bucket ?? null;
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    // Read Shift from the activator event (pointerdown that started the drag).
    const activator = (e as unknown as { activatorEvent?: PointerEvent | KeyboardEvent })
      .activatorEvent;
    if (activator && "shiftKey" in activator) {
      setMergeMode(Boolean(activator.shiftKey));
    }
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const wasMergeMode = mergeMode;
    setMergeMode(false);
    const { active, over } = e;
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    if (activeIdStr === overIdStr) return;

    // Merge intent: shift held during drag AND dropped over a task card
    // (not a bare column). Works across columns — the target's column
    // wins so the user sees the merged card wherever they dropped it.
    if (wasMergeMode && !(BUCKETS as string[]).includes(overIdStr)) {
      const target = tasks.find((t) => t.id === overIdStr);
      const source = tasks.find((t) => t.id === activeIdStr);
      if (target && source) {
        void mergeTasks(activeIdStr, overIdStr);
        return;
      }
    }

    const fromBucket = findBucket(activeIdStr);
    const toBucket = findBucket(overIdStr);
    if (!fromBucket || !toBucket) return;

    setTasks((prev) => {
      const activeTask = prev.find((t) => t.id === activeIdStr);
      if (!activeTask) return prev;

      // Move within same bucket
      if (fromBucket === toBucket) {
        const bucketTasks = prev
          .filter((t) => t.bucket === fromBucket)
          .sort((a, b) => a.position - b.position);
        const oldIndex = bucketTasks.findIndex((t) => t.id === activeIdStr);
        const newIndex = bucketTasks.findIndex((t) => t.id === overIdStr);
        if (oldIndex === -1 || newIndex === -1) return prev;
        const reordered = arrayMove(bucketTasks, oldIndex, newIndex);
        const orderedIds = reordered.map((t) => t.id);
        void persistOrder(fromBucket, orderedIds);
        return prev.map((t) => {
          if (t.bucket !== fromBucket) return t;
          const idx = orderedIds.indexOf(t.id);
          return idx === -1 ? t : { ...t, position: idx };
        });
      }

      // Cross-bucket move
      const targetBucketTasks = prev
        .filter((t) => t.bucket === toBucket)
        .sort((a, b) => a.position - b.position);
      const overIsBucket = (BUCKETS as string[]).includes(overIdStr);
      const insertIndex = overIsBucket
        ? targetBucketTasks.length
        : Math.max(0, targetBucketTasks.findIndex((t) => t.id === overIdStr));
      const newTargetOrder = [
        ...targetBucketTasks.slice(0, insertIndex).map((t) => t.id),
        activeIdStr,
        ...targetBucketTasks.slice(insertIndex).map((t) => t.id),
      ];
      void persistOrder(toBucket, newTargetOrder);

      return prev.map((t) => {
        if (t.id === activeIdStr) {
          return { ...t, bucket: toBucket, position: newTargetOrder.indexOf(activeIdStr) };
        }
        if (t.bucket === toBucket) {
          const idx = newTargetOrder.indexOf(t.id);
          return idx === -1 ? t : { ...t, position: idx };
        }
        return t;
      });
    });
  }

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null;

  return (
    <DndContext
      id="nnl-board"
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Now / Next / Later</h1>
        <div className="flex items-baseline gap-3">
          {lastResult ? (
            <span className="flex items-center gap-1.5 text-xs text-neutral-500">
              {lastResult}
              {lastErrors.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowErrors((v) => !v)}
                  className="rounded-sm border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900/60"
                  aria-expanded={showErrors}
                >
                  {showErrors ? "hide" : "details"}
                </button>
              ) : null}
            </span>
          ) : null}
          <button
            onClick={refresh}
            disabled={refreshing}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          {(() => {
            const archivable = tasks.filter((t) => t.completed && !t.archived).length;
            if (archivable === 0) return null;
            return (
              <button
                onClick={archiveAllCompleted}
                title="Hide completed tasks from the board now (they stay in Recently Completed and un-check to bring them back)"
                className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                Archive {archivable} completed
              </button>
            );
          })()}
          <a
            href="/settings"
            className="text-xs text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200"
          >
            settings
          </a>
          <p className="text-sm text-neutral-500">{dateLabel}</p>
        </div>
      </header>
      {lastErrors.length > 0 && showErrors ? (
        <ul className="mb-4 space-y-1 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {lastErrors.map((e, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-semibold capitalize shrink-0">{e.name}:</span>
              <span className="font-mono whitespace-pre-wrap break-all">{e.error}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {/* Tab strip: keep this outside the conditional so the header of the
          page doesn't jump when switching views. */}
      <div className="mb-4 flex items-center gap-1 border-b border-neutral-200 dark:border-neutral-800">
        <TabButton active={view === "board"} onClick={() => setView("board")}>
          Board
        </TabButton>
        <TabButton active={view === "done"} onClick={() => setView("done")}>
          Recently completed
          {recentlyDone.today.length + recentlyDone.earlierThisWeek.length > 0 ? (
            <span className="ml-1.5 rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              {recentlyDone.today.length + recentlyDone.earlierThisWeek.length}
            </span>
          ) : null}
        </TabButton>
      </div>

      {/* Board view is hidden (not unmounted) when on the done tab so the
          drag state, column refs, and any in-flight edits survive tab
          switches without a re-render blip. */}
      <div className={view === "board" ? "grid grid-cols-1 gap-4 md:grid-cols-3" : "hidden"}>
        {BUCKETS.map((bucket) => (
          <SortableContext
            key={bucket}
            id={bucket}
            items={grouped[bucket].map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <Column
              bucket={bucket}
              tasks={grouped[bucket]}
              onCreate={(title, url) => createTask(title, bucket, url)}
              onUpdate={updateTask}
              onDelete={deleteTask}
              flashMergedId={flashMergedId}
            />
          </SortableContext>
        ))}
      </div>
      <DragOverlay>
        {activeTask ? <TaskCard task={activeTask} dragging /> : null}
      </DragOverlay>
      {activeId ? (
        <div
          className={`pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border px-3 py-1 text-xs shadow-lg backdrop-blur transition-colors ${
            mergeMode
              ? "border-purple-400 bg-purple-100/90 text-purple-900 dark:border-purple-500 dark:bg-purple-950/80 dark:text-purple-100"
              : "border-neutral-300 bg-white/90 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-300"
          }`}
        >
          {mergeMode
            ? "✒️ Merge mode — drop on another task to combine them"
            : "Hold ⇧ Shift to merge into another task instead of reordering"}
        </div>
      ) : null}
      {mergeToast ? (
        <div
          role="status"
          aria-live="polite"
          className={`pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border px-3 py-1 text-xs shadow-lg backdrop-blur ${
            mergeToast.startsWith("⚠")
              ? "border-red-400 bg-red-100/95 text-red-900 dark:border-red-500 dark:bg-red-950/85 dark:text-red-100"
              : "border-green-400 bg-green-100/95 text-green-900 dark:border-green-500 dark:bg-green-950/85 dark:text-green-100"
          }`}
        >
          {mergeToast}
        </div>
      ) : null}
      {view === "done" ? (
        <RecentlyDone
          today={recentlyDone.today}
          earlierThisWeek={recentlyDone.earlierThisWeek}
          onUncomplete={(id) => updateTask(id, { completed: false })}
        />
      ) : null}
    </DndContext>
  );
}
