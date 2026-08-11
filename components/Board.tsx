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
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  type SortingStrategy,
} from "@dnd-kit/sortable";

/**
 * When Shift is held (merge mode), we don't want the other cards to shift
 * around to make room for the dragged item — the user is trying to aim at
 * a specific target, not reorder. Returning null from the strategy means
 * "don't apply any transform" so the list stays still.
 */
const noShiftStrategy: SortingStrategy = () => null;
import type { MergeSnapshot } from "@/lib/storage";
import { BUCKETS, Bucket, Task } from "@/lib/types";
import { Column } from "./Column";
import { TaskCard } from "./TaskCard";
import { RecentlyDone } from "./RecentlyDone";
import { IcalDate } from "./IcalDate";
import { Logo } from "./Logo";
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
      className={`-mb-px border-b-2 px-3.5 py-2 text-sm font-medium transition-all ${
        active
          ? "border-blue-500 text-neutral-900 dark:border-blue-400 dark:text-neutral-100"
          : "border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-800 dark:hover:border-neutral-700 dark:hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

const BUTTON_STYLE =
  "inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm backdrop-blur transition-all hover:border-neutral-300 hover:bg-white hover:shadow disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900/80 dark:text-neutral-200 dark:hover:bg-neutral-900";

function Icon({ path, className }: { path: React.ReactNode; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {path}
    </svg>
  );
}

const RefreshIcon = (
  <Icon
    path={
      <>
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
        <path d="M16 16h5v5" />
      </>
    }
  />
);

const GearIcon = (
  <Icon
    path={
      <>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </>
    }
  />
);

const CheckIcon = (
  <Icon path={<path d="M20 6 9 17l-5-5" />} />
);

interface Props {
  initialTasks: Task[];
}

export function Board({ initialTasks }: Props) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [lastErrors, setLastErrors] = useState<Array<{ name: string; error: string }>>([]);

  const [view, setView] = useState<"board" | "done">("board");
  // Tracks whether Shift is held during an active drag. When true, dropping
  // onto another task card merges the two instead of reordering.
  const [mergeMode, setMergeMode] = useState(false);
  // Post-merge feedback: id of the target card that just absorbed a merge
  // (flashes for ~1.5s) plus a short toast describing the merge.
  const [flashMergedId, setFlashMergedId] = useState<string | null>(null);
  const [mergeToast, setMergeToast] = useState<string | null>(null);
  const [lastMergeSnapshot, setLastMergeSnapshot] = useState<MergeSnapshot | null>(null);
  // Task ids that showed up in the most recent refresh and haven't been on
  // screen long enough to have blended in. Rendered with an amber ring on
  // the card so newly-ingested items are easy to spot. Cleared per-id when
  // it's been on screen >= NEW_TASK_HIGHLIGHT_MS.
  const NEW_TASK_HIGHLIGHT_MS = 5 * 60 * 1000;
  const [justArrivedIds, setJustArrivedIds] = useState<Map<string, number>>(
    () => new Map(),
  );

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

  async function createTask(
    title: string,
    bucket: Bucket,
    url?: string,
    category?: string,
  ) {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, bucket, url, category }),
    });
    if (!res.ok) return;
    const { task } = await res.json();
    setTasks((prev) => [...prev, task]);
  }

  // `category` accepts `null` to explicitly clear the field on the server;
  // Task's own type only permits string | undefined, so we widen the patch
  // shape here rather than casting at every callsite.
  type TaskPatch = Partial<Omit<Task, "category">> & { category?: string | null };

  async function updateTask(id: string, patch: TaskPatch) {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const next: Task = { ...t, ...patch, category: patch.category ?? undefined };
        // Mirror server: un-completing clears the archive flag so the task
        // returns to its column instead of staying hidden.
        if (patch.completed === false) next.archived = undefined;
        // Clearing category (null) also clears it in local state.
        if (patch.category === null) next.category = undefined;
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
      setMergeToast(`⚠️ Merge failed — reverted`);
      setLastMergeSnapshot(null);
      await refetchTasks();
    } else {
      const data = await res.json();
      if (data.snapshot) setLastMergeSnapshot(data.snapshot);
    }
  }

  // Clear the flash + toast after a short window so they don't linger.
  // Longer timeout when undo is available so the user has time to click.
  useEffect(() => {
    if (!flashMergedId && !mergeToast) return;
    const delay = lastMergeSnapshot ? 5000 : 2200;
    const t = window.setTimeout(() => {
      setFlashMergedId(null);
      setMergeToast(null);
      setLastMergeSnapshot(null);
    }, delay);
    return () => window.clearTimeout(t);
  }, [flashMergedId, mergeToast, lastMergeSnapshot]);

  // Expire just-arrived highlights. Instead of scheduling a timer per id,
  // sweep every 30s and drop entries older than NEW_TASK_HIGHLIGHT_MS.
  // Cheap because the map is tiny (only ids from the last refresh) and
  // the interval runs regardless — no per-refresh timer bookkeeping.
  useEffect(() => {
    if (justArrivedIds.size === 0) return;
    const tick = () => {
      const cutoff = Date.now() - NEW_TASK_HIGHLIGHT_MS;
      setJustArrivedIds((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [id, ts] of next) {
          if (ts < cutoff) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };
    const interval = window.setInterval(tick, 30_000);
    return () => window.clearInterval(interval);
  }, [justArrivedIds, NEW_TASK_HIGHLIGHT_MS]);

  // Derived plain Set for cheap per-card lookup in Column / TaskCard.
  const justArrivedIdSet = useMemo(
    () => new Set(justArrivedIds.keys()),
    [justArrivedIds],
  );

  async function undoMerge() {
    if (!lastMergeSnapshot) return;
    const snapshot = lastMergeSnapshot;
    setLastMergeSnapshot(null);
    setMergeToast(null);
    const res = await fetch("/api/tasks/unmerge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshot }),
    });
    if (res.ok) {
      await refetchTasks();
    }
  }

  async function refetchTasks(): Promise<Task[] | null> {
    const res = await fetch("/api/tasks");
    if (!res.ok) return null;
    const { tasks: fresh } = (await res.json()) as { tasks: Task[] };
    setTasks(fresh);
    return fresh;
  }

  async function refresh() {
    setRefreshing(true);
    setLastResult(null);
    setLastErrors([]);
    setLastErrors([]);
    // Snapshot the pre-refresh id set so we can highlight the diff after
    // refetchTasks() completes. `updateTask` etc. would clobber this if we
    // read from state later, so capture up front.
    const preIds = new Set(tasks.map((t) => t.id));
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
      // Errors are shown as a separate red chip, not in the main status text.
      // (see errorChip in the render)
      if (disabled.length) parts.push(`${disabled.length} disabled`);
      setLastResult(parts.length ? parts.join(" · ") : "no changes");
      setLastErrors(errored);
      const freshTasks = await refetchTasks();
      // Mark ids that appeared for the first time in this refresh. We union
      // with any still-active highlights from a previous refresh, so quick
      // successive refreshes don't blow away highlights that haven't
      // expired yet.
      if (freshTasks) {
        const now = Date.now();
        setJustArrivedIds((prev) => {
          const next = new Map(prev);
          for (const t of freshTasks) {
            if (!preIds.has(t.id)) next.set(t.id, now);
          }
          return next;
        });
      }
    } catch (err) {
      setLastResult(`error: ${(err as Error).message}`);
      setLastErrors([{ name: "client", error: (err as Error).message }]);
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

  /**
   * A drop target is identified by (bucket, sub). This lets a bucket split
   * into multiple visual sections while still using one underlying bucket.
   * `sub` values:
   *   undefined  → the main list for the bucket
   *   "book"     → Reading list at the bottom of Later (user-mutable via
   *              the `category` field)
   *   "jira"     → Jira tickets at the bottom of Now (source-derived; the
   *              user can't toggle a task into this section, it's populated
   *              by the ingest adapter)
   *
   * Recognized container ids:
   *   "later-books"  → { bucket: "later", sub: "book" }
   *   "now-jira"     → { bucket: "now",   sub: "jira" }
   *   "now" | "next" | "later" → { bucket, sub: undefined }
   * Task ids resolve to whichever section their fields imply.
   */
  type Sub = "book" | "jira" | undefined;
  type Section = { bucket: Bucket; sub: Sub };
  const BOOKS_ID = "later-books";
  const JIRA_ID = "now-jira";

  function taskSub(t: Task): Sub {
    if (t.category === "book") return "book";
    if (t.bucket === "now" && t.source === "jira") return "jira";
    return undefined;
  }

  function findSection(id: string): Section | null {
    if (id === BOOKS_ID) return { bucket: "later", sub: "book" };
    if (id === JIRA_ID) return { bucket: "now", sub: "jira" };
    if ((BUCKETS as string[]).includes(id)) return { bucket: id as Bucket, sub: undefined };
    const t = tasks.find((x) => x.id === id);
    if (!t) return null;
    return { bucket: t.bucket, sub: taskSub(t) };
  }

  function sameSection(a: Section, b: Section): boolean {
    return a.bucket === b.bucket && a.sub === b.sub;
  }

  /** Tasks that visually belong to a given section, in position order. */
  function tasksInSection(list: Task[], section: Section): Task[] {
    return list
      .filter((t) => t.bucket === section.bucket && taskSub(t) === section.sub)
      .sort((a, b) => a.position - b.position);
  }

  /** Canonical top-to-bottom visual order of sections within a bucket.
   *  Main list first, then any bottom subsections. Used both for
   *  rebuilding the per-bucket position order on reorder and for
   *  cross-section drops. */
  function orderedSectionsForBucket(bucket: Bucket): Section[] {
    if (bucket === "now") {
      return [
        { bucket: "now", sub: undefined },
        { bucket: "now", sub: "jira" },
      ];
    }
    if (bucket === "later") {
      return [
        { bucket: "later", sub: undefined },
        { bucket: "later", sub: "book" },
      ];
    }
    return [{ bucket, sub: undefined }];
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

    const fromSection = findSection(activeIdStr);
    const toSection = findSection(overIdStr);
    if (!fromSection || !toSection) return;

    // Ids used as bare drop containers (as opposed to a task card).
    const containerIds = [...(BUCKETS as string[]), BOOKS_ID];
    const overIsContainer = containerIds.includes(overIdStr);

    setTasks((prev) => {
      const activeTask = prev.find((t) => t.id === activeIdStr);
      if (!activeTask) return prev;

      const inSameSection = sameSection(fromSection, toSection);

      if (inSameSection) {
        // Reorder within one section (Later main, Later books, Now main,
        // Now jira, or Next). Positions are per-bucket integers, so we
        // rebuild the whole bucket's ordering in visual-section order and
        // pass it to persistOrder — other sections' relative order is
        // preserved because their contents weren't moved.
        const sectionTasks = tasksInSection(prev, fromSection);
        const oldIndex = sectionTasks.findIndex((t) => t.id === activeIdStr);
        const newIndex = sectionTasks.findIndex((t) => t.id === overIdStr);
        if (oldIndex === -1 || newIndex === -1) return prev;
        const reordered = arrayMove(sectionTasks, oldIndex, newIndex);
        const reorderedIds = reordered.map((t) => t.id);

        const bucketOrderedSections: Section[] = orderedSectionsForBucket(fromSection.bucket);
        const fullOrder: string[] = [];
        for (const s of bucketOrderedSections) {
          if (sameSection(s, fromSection)) {
            fullOrder.push(...reorderedIds);
          } else {
            fullOrder.push(...tasksInSection(prev, s).map((t) => t.id));
          }
        }
        void persistOrder(fromSection.bucket, fullOrder);

        return prev.map((t) => {
          if (t.bucket !== fromSection.bucket) return t;
          const idx = fullOrder.indexOf(t.id);
          return idx === -1 ? t : { ...t, position: idx };
        });
      }

      // Cross-section move (across buckets, across categories, or both).
      // 1. Build the new task with the correct bucket + category. Book
      //    membership is user-controlled via `category`; Jira membership is
      //    source-derived and immutable here — so dropping into the Jira
      //    subsection is treated the same as dropping into the Now bucket,
      //    and the task's actual final section on re-render is decided by
      //    its unchanged source field.
      const nextCategory =
        toSection.sub === "book" ? "book" : toSection.sub === undefined ? undefined : activeTask.category;
      const movedTask: Task = {
        ...activeTask,
        bucket: toSection.bucket,
        category: nextCategory,
      };

      // 2. Insert into the target section at the drop index.
      const targetSectionTasks = tasksInSection(prev, toSection);
      const insertIndex = overIsContainer
        ? targetSectionTasks.length
        : Math.max(0, targetSectionTasks.findIndex((t) => t.id === overIdStr));
      const newTargetIds = [
        ...targetSectionTasks.slice(0, insertIndex).map((t) => t.id),
        activeIdStr,
        ...targetSectionTasks.slice(insertIndex).map((t) => t.id),
      ];

      // 3. Rebuild the target bucket's ordering in visual-section order
      //    (main first, then bottom subsections) and splice the moved
      //    task into its target slot. Other sections keep their relative
      //    order.
      const targetOrderedSections: Section[] = orderedSectionsForBucket(toSection.bucket);
      const fullTargetOrder: string[] = [];
      for (const s of targetOrderedSections) {
        if (sameSection(s, toSection)) {
          fullTargetOrder.push(...newTargetIds);
        } else {
          fullTargetOrder.push(
            ...tasksInSection(prev, s)
              .map((t) => t.id)
              .filter((id) => id !== activeIdStr),
          );
        }
      }

      void persistOrder(toSection.bucket, fullTargetOrder);

      // If the source bucket differs from the target, the source bucket's
      // positions also need to compact — dropping a task out of it leaves
      // a hole. Rebuild + persist source bucket order too.
      if (fromSection.bucket !== toSection.bucket) {
        const sourceRemaining = prev
          .filter((t) => t.bucket === fromSection.bucket && t.id !== activeIdStr)
          .sort((a, b) => a.position - b.position)
          .map((t) => t.id);
        void persistOrder(fromSection.bucket, sourceRemaining);
      }

      // Also PATCH the moved task's category (persistOrder only touches
      // position + bucket; category is a separate field). We do this in
      // fire-and-forget style like the rest of Board's mutations.
      if (activeTask.category !== nextCategory) {
        void fetch(`/api/tasks/${activeIdStr}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ category: nextCategory ?? null }),
        });
      }

      return prev.map((t) => {
        if (t.id === activeIdStr) {
          return {
            ...movedTask,
            position: fullTargetOrder.indexOf(activeIdStr),
          };
        }
        if (t.bucket === toSection.bucket) {
          const idx = fullTargetOrder.indexOf(t.id);
          return idx === -1 ? t : { ...t, position: idx };
        }
        if (t.bucket === fromSection.bucket) {
          // Source-bucket compaction (only matters when buckets differ).
          return t;
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
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
            Now <span className="text-neutral-300 dark:text-neutral-700">/</span> Next{" "}
            <span className="text-neutral-300 dark:text-neutral-700">/</span> Later
          </h1>
        </div>
        <IcalDate />
      </header>
      {/* Error details removed — errors now show inline in the status bar */}
      {/* Tab strip with inline actions on the right — keeps chrome compact
          and puts view-switching + tools in the same visual row. */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center gap-1">
          <TabButton active={view === "board"} onClick={() => setView("board")}>
            Board
          </TabButton>
          <TabButton active={view === "done"} onClick={() => setView("done")}>
            Completed
            {recentlyDone.today.length + recentlyDone.earlierThisWeek.length > 0 ? (
              <span className="ml-1.5 rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                {recentlyDone.today.length + recentlyDone.earlierThisWeek.length}
              </span>
            ) : null}
          </TabButton>
        </div>
        <div className="flex items-center gap-2 pb-2">
          {lastResult || lastErrors.length > 0 ? (
            <span className="flex items-center gap-1.5 text-xs text-neutral-500">
              {lastResult}
              {lastErrors.length > 0 ? (
                <button
                  type="button"
                  onClick={() => { setLastErrors([]); setLastErrors([]); }}
                  title={lastErrors.map((e) => `${e.name}: ${e.error}`).join("\n")}
                  className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
                >
                  {lastErrors.map((e) => e.name).join(", ")} errored
                  <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3l6 6M9 3l-6 6" /></svg>
                </button>
              ) : null}
            </span>
          ) : null}
          {(() => {
            const archivable = tasks.filter((t) => t.completed && !t.archived).length;
            if (archivable === 0) return null;
            return (
              <button
                onClick={archiveAllCompleted}
                title="Hide completed tasks from the board now (they stay in Completed and un-check to bring them back)"
                className={BUTTON_STYLE}
              >
                {CheckIcon} Archive {archivable}
              </button>
            );
          })()}
          <button onClick={refresh} disabled={refreshing} className={BUTTON_STYLE}>
            <span className={refreshing ? "animate-spin" : ""}>{RefreshIcon}</span>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <a href="/settings" className={BUTTON_STYLE}>
            {GearIcon} Settings
          </a>
        </div>
      </div>

      {/* Board view is hidden (not unmounted) when on the done tab so the
          drag state, column refs, and any in-flight edits survive tab
          switches without a re-render blip. */}
      <div className={view === "board" ? "grid grid-cols-1 gap-4 md:grid-cols-3" : "hidden"}>
        {BUCKETS.map((bucket) => {
          // Partition columns into main + optional bottom subsections.
          // Later has a user-controlled Reading list; Now auto-groups Jira
          // tickets (source === 'jira') into a read-only section. Other
          // buckets ignore both.
          const bucketTasks = grouped[bucket];
          const isLater = bucket === "later";
          const isNow = bucket === "now";
          const bookTasks = isLater
            ? bucketTasks.filter((t) => t.category === "book")
            : [];
          const jiraTasks = isNow
            ? bucketTasks.filter((t) => t.category !== "book" && t.source === "jira")
            : [];
          const mainTasks = bucketTasks.filter((t) => {
            if (isLater && t.category === "book") return false;
            if (isNow && t.source === "jira") return false;
            return true;
          });

          return (
            <SortableContext
              key={bucket}
              id={bucket}
              items={mainTasks.map((t) => t.id)}
              strategy={mergeMode ? noShiftStrategy : verticalListSortingStrategy}
            >
              <Column
                bucket={bucket}
                tasks={mainTasks}
                onCreate={(title, url) => createTask(title, bucket, url)}
                onUpdate={updateTask}
                onDelete={deleteTask}
                flashMergedId={flashMergedId}
                justArrivedIds={justArrivedIdSet}
                onToggleBook={
                  isLater
                    ? (task) =>
                        updateTask(task.id, {
                          category: task.category === "book" ? null : "book",
                        })
                    : undefined
                }
                subsection={
                  isLater
                    ? {
                        id: "later-books",
                        label: "Reading list",
                        emoji: "📚",
                        inputPlaceholder: "Add a book…",
                        tasks: bookTasks,
                        onCreate: (title) =>
                          createTask(title, bucket, undefined, "book"),
                      }
                    : isNow && jiraTasks.length > 0
                      ? {
                          id: "now-jira",
                          label: "Jira tickets",
                          iconSrc: "/logos/jira.svg",
                          tasks: jiraTasks,
                          showInput: false,
                          highlight: "sky",
                        }
                      : undefined
                }
              />
            </SortableContext>
          );
        })}
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
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border px-3 py-1 text-xs shadow-lg backdrop-blur flex items-center gap-2 ${
            mergeToast.startsWith("⚠")
              ? "border-red-400 bg-red-100/95 text-red-900 dark:border-red-500 dark:bg-red-950/85 dark:text-red-100"
              : "border-green-400 bg-green-100/95 text-green-900 dark:border-green-500 dark:bg-green-950/85 dark:text-green-100"
          }`}
        >
          <span className="pointer-events-none">{mergeToast}</span>
          {lastMergeSnapshot ? (
            <button
              type="button"
              onClick={undoMerge}
              className="rounded-full border border-green-500 bg-green-200/80 px-2 py-0.5 text-[10px] font-semibold text-green-800 hover:bg-green-300 dark:border-green-400 dark:bg-green-900/60 dark:text-green-200 dark:hover:bg-green-800/60"
            >
              Undo
            </button>
          ) : null}
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
