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

interface Props {
  initialTasks: Task[];
}

export function Board({ initialTasks }: Props) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const grouped = useMemo(() => {
    const g: Record<Bucket, Task[]> = { now: [], next: [], later: [] };
    for (const t of tasks) g[t.bucket].push(t);
    for (const b of BUCKETS) g[b].sort((a, b) => a.position - b.position);
    return g;
  }, [tasks]);

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

  async function createTask(title: string, bucket: Bucket) {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, bucket }),
    });
    if (!res.ok) return;
    const { task } = await res.json();
    setTasks((prev) => [...prev, task]);
  }

  async function updateTask(id: string, patch: Partial<Task>) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function deleteTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
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
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    if (activeIdStr === overIdStr) return;

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
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
              onCreate={(title) => createTask(title, bucket)}
              onUpdate={updateTask}
              onDelete={deleteTask}
            />
          </SortableContext>
        ))}
      </div>
      <DragOverlay>
        {activeTask ? <TaskCard task={activeTask} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}
