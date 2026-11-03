"use client";

import { useMemo } from "react";
import type { Bucket, Priority, Task } from "@/lib/types";
import { BUCKETS } from "@/lib/types";
import { TaskCard } from "./TaskCard";

interface Props {
  tasks: Task[];
  priorities: Priority[];
  onUpdate: (
    id: string,
    patch: Omit<Partial<Task>, "priorityId" | "category"> & {
      priorityId?: string | null;
      category?: string | null;
    },
  ) => void;
  onDelete: (id: string) => void;
}

const BUCKET_HEADERS: Record<Bucket, { title: string; subtitle: string; accent: string }> = {
  now: {
    title: "Now",
    subtitle: "today",
    accent: "text-rose-600 dark:text-rose-400",
  },
  next: {
    title: "Next",
    subtitle: "this week",
    accent: "text-sky-600 dark:text-sky-400",
  },
  later: {
    title: "Later",
    subtitle: "this month",
    accent: "text-violet-600 dark:text-violet-400",
  },
};

/**
 * Jira tickets tab. Flat list of every task with source === "jira",
 * grouped by bucket (Now / Next / Later) so you can see what's actually
 * on today's plate at a glance. Not a drop target — Jira tickets are
 * source-of-truth-elsewhere; the only mutations here are mark-complete,
 * edit title, delete (which tombstones so the adapter won't resurrect
 * it), and priority assignment via the card's existing picker.
 */
export function JiraTickets({ tasks, priorities, onUpdate, onDelete }: Props) {
  const grouped = useMemo(() => {
    const g: Record<Bucket, Task[]> = { now: [], next: [], later: [] };
    for (const t of tasks) {
      if (t.source !== "jira") continue;
      g[t.bucket].push(t);
    }
    for (const b of BUCKETS) {
      g[b].sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return a.position - b.position;
      });
    }
    return g;
  }, [tasks]);

  const total = grouped.now.length + grouped.next.length + grouped.later.length;
  const open = tasks.filter((t) => t.source === "jira" && !t.completed).length;

  return (
    <section className="mx-auto max-w-3xl">
      <header className="mb-4 flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/jira.svg" alt="" width={18} height={18} aria-hidden />
          <h2 className="text-lg font-semibold tracking-tight text-sky-700 dark:text-sky-300">
            Jira tickets
          </h2>
        </div>
        <span className="text-xs text-neutral-500">
          {open} open · {total} total
        </span>
      </header>

      {total === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 py-8 text-center text-xs italic text-neutral-400 dark:border-neutral-800">
          No Jira tickets. Run Refresh to pull current assignments.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {BUCKETS.map((bucket) => {
            const items = grouped[bucket];
            if (items.length === 0) return null;
            const header = BUCKET_HEADERS[bucket];
            return (
              <div key={bucket}>
                <div className="mb-2 flex items-baseline gap-2 px-0.5">
                  <h3 className={`text-sm font-semibold tracking-tight ${header.accent}`}>
                    {header.title}
                  </h3>
                  <span className="text-[11px] uppercase tracking-wider text-neutral-400">
                    {header.subtitle}
                  </span>
                  <span className="ml-auto tabular-nums text-xs text-neutral-500">
                    {items.filter((t) => !t.completed).length}
                  </span>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {items.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      priorities={priorities}
                      onToggle={() => onUpdate(task.id, { completed: !task.completed })}
                      onEdit={(title) => onUpdate(task.id, { title })}
                      onDelete={() => onDelete(task.id)}
                      onSetPriority={(pid) => onUpdate(task.id, { priorityId: pid })}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
