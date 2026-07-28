"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Bucket, Task } from "@/lib/types";
import { TaskCard } from "./TaskCard";

const LABELS: Record<Bucket, { title: string; subtitle: string }> = {
  now: { title: "Now", subtitle: "today" },
  next: { title: "Next", subtitle: "this week" },
  later: { title: "Later", subtitle: "this month" },
};

interface Props {
  bucket: Bucket;
  tasks: Task[];
  onCreate: (title: string, url?: string) => void;
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onDelete: (id: string) => void;
  /** When set to a task id, that card briefly flashes to confirm a merge. */
  flashMergedId?: string | null;
}

export function Column({ bucket, tasks, onCreate, onUpdate, onDelete, flashMergedId }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: bucket });
  const [draft, setDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const label = LABELS[bucket];
  const remaining = tasks.filter((t) => !t.completed).length;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    const url = urlDraft.trim();
    if (url) {
      // Validate URL client-side so we can show inline feedback instead
      // of a silent 400 from the API.
      try {
        // eslint-disable-next-line no-new
        new URL(url);
      } catch {
        setUrlError("Not a valid URL (needs https:// or similar).");
        return;
      }
    }
    setUrlError(null);
    onCreate(title, url || undefined);
    setDraft("");
    setUrlDraft("");
  }

  return (
    <section
      ref={setNodeRef}
      className={`flex min-h-[300px] flex-col rounded-lg border p-3 shadow-sm transition-colors dark:border-neutral-800 ${
        isOver
          ? "border-blue-400 bg-blue-50/70 ring-2 ring-blue-300/50 dark:border-blue-500 dark:bg-blue-950/40 dark:ring-blue-500/30"
          : "border-neutral-200 bg-white/60 dark:bg-neutral-900/60"
      }`}
    >
      <header className="mb-3 flex items-baseline justify-between px-1">
        <div>
          <h2 className="text-lg font-semibold">{label.title}</h2>
          <p className="text-xs text-neutral-500">{label.subtitle}</p>
        </div>
        <span className="text-xs text-neutral-500">{remaining}</span>
      </header>

      <form onSubmit={submit} className="mb-3 space-y-1.5">
        <input
          id={`new-task-${bucket}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Add to ${label.title}…`}
          className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-neutral-700 dark:bg-neutral-950"
        />
        {/* URL input only appears once the user starts a title — keeps the
            columns compact when they're not creating a task. */}
        {draft.trim() ? (
          <>
            <input
              type="url"
              value={urlDraft}
              onChange={(e) => {
                setUrlDraft(e.target.value);
                if (urlError) setUrlError(null);
              }}
              placeholder="Optional link (https://…)"
              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400 dark:border-neutral-700 dark:bg-neutral-950"
            />
            {urlError ? (
              <p className="text-[11px] text-red-500">{urlError}</p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraft("");
                  setUrlDraft("");
                  setUrlError(null);
                }}
                className="text-[11px] text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              >
                cancel
              </button>
              <button
                type="submit"
                className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-800"
              >
                Add
              </button>
            </div>
          </>
        ) : null}
      </form>

      <ul className="flex flex-1 flex-col gap-1.5">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            justMerged={flashMergedId === task.id}
            onToggle={() => onUpdate(task.id, { completed: !task.completed })}
            onEdit={(title) => onUpdate(task.id, { title })}
            onDelete={() => onDelete(task.id)}
          />
        ))}
        {tasks.length === 0 ? (
          <li
            className={`rounded-md border border-dashed py-6 text-center text-xs transition-colors ${
              isOver
                ? "border-blue-400 text-blue-600 dark:border-blue-500 dark:text-blue-300"
                : "border-neutral-200 text-neutral-400 dark:border-neutral-800"
            }`}
          >
            {isOver ? "drop to move here" : "nothing here — drag tasks in or add above"}
          </li>
        ) : null}
      </ul>
    </section>
  );
}
