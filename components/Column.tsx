"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Bucket, Task } from "@/lib/types";
import { TaskCard } from "./TaskCard";

interface BucketMeta {
  title: string;
  subtitle: string;
  /** Subtle accent color used for the header underline + focus glow. */
  accent: {
    text: string;
    bar: string;
    dot: string;
  };
}

const LABELS: Record<Bucket, BucketMeta> = {
  now: {
    title: "Now",
    subtitle: "today",
    accent: {
      text: "text-rose-600 dark:text-rose-400",
      bar: "bg-gradient-to-r from-rose-400/70 via-rose-400/20 to-transparent",
      dot: "bg-rose-500",
    },
  },
  next: {
    title: "Next",
    subtitle: "this week",
    accent: {
      text: "text-sky-600 dark:text-sky-400",
      bar: "bg-gradient-to-r from-sky-400/70 via-sky-400/20 to-transparent",
      dot: "bg-sky-500",
    },
  },
  later: {
    title: "Later",
    subtitle: "this month",
    accent: {
      text: "text-violet-600 dark:text-violet-400",
      bar: "bg-gradient-to-r from-violet-400/70 via-violet-400/20 to-transparent",
      dot: "bg-violet-500",
    },
  },
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
      className={`flex min-h-[300px] flex-col rounded-xl border p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)] transition-all duration-200 dark:border-neutral-800 dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_8px_24px_-12px_rgba(0,0,0,0.5)] ${
        isOver
          ? "border-blue-400 bg-blue-50/70 ring-2 ring-blue-300/50 dark:border-blue-500 dark:bg-blue-950/40 dark:ring-blue-500/30"
          : "border-neutral-200/80 bg-white/80 backdrop-blur-sm dark:bg-neutral-900/60"
      }`}
    >
      <header className="mb-3">
        <div className="flex items-baseline justify-between px-0.5">
          <div className="flex items-baseline gap-2">
            <span className={`h-2 w-2 rounded-full ${label.accent.dot} shadow-sm`} aria-hidden />
            <h2 className={`text-base font-semibold tracking-tight ${label.accent.text}`}>{label.title}</h2>
            <p className="text-[11px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              {label.subtitle}
            </p>
          </div>
          <span className="tabular-nums text-xs font-medium text-neutral-500">{remaining}</span>
        </div>
        <div className={`mt-2 h-px w-full rounded-full ${label.accent.bar}`} aria-hidden />
      </header>

      <form onSubmit={submit} className="mb-3 space-y-1.5">
        <input
          id={`new-task-${bucket}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Add to ${label.title}…`}
          className="w-full rounded-md border border-neutral-200 bg-white/70 px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-neutral-400 focus:border-blue-400 focus:bg-white dark:border-neutral-700 dark:bg-neutral-950/70 dark:focus:bg-neutral-950"
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
            className={`rounded-md border border-dashed py-8 text-center text-xs italic transition-colors ${
              isOver
                ? "border-blue-400 text-blue-600 dark:border-blue-500 dark:text-blue-300"
                : "border-neutral-200 text-neutral-400 dark:border-neutral-800"
            }`}
          >
            {isOver ? "drop to move here" : "nothing here yet"}
          </li>
        ) : null}
      </ul>
    </section>
  );
}
