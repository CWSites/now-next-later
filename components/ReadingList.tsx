"use client";

import { useMemo, useState } from "react";
import type { Priority, Task } from "@/lib/types";
import { TaskCard } from "./TaskCard";

interface Props {
  tasks: Task[];
  priorities: Priority[];
  /** Create a new book-category task (no bucket preference — books are
   *  bucket-agnostic in this view). */
  onCreate: (title: string) => void;
  onUpdate: (
    id: string,
    patch: Omit<Partial<Task>, "priorityId" | "category"> & {
      priorityId?: string | null;
      category?: string | null;
    },
  ) => void;
  onDelete: (id: string) => void;
  onToggleBook: (task: Task) => void;
}

/**
 * Reading-list tab. Flat list of every task with category === "book",
 * sorted by (completed ascending, then title) so unread sits above
 * finished. Not a drop target — moving things in/out of the reading
 * list happens via the 📚 button on each card.
 */
export function ReadingList({
  tasks,
  priorities,
  onCreate,
  onUpdate,
  onDelete,
  onToggleBook,
}: Props) {
  const [draft, setDraft] = useState("");

  const books = useMemo(() => {
    return tasks
      .filter((t) => t.category === "book")
      .sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return a.title.localeCompare(b.title);
      });
  }, [tasks]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    onCreate(title);
    setDraft("");
  }

  const remaining = books.filter((b) => !b.completed).length;

  return (
    <section className="mx-auto max-w-2xl">
      <header className="mb-4 flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-xl">
            📚
          </span>
          <h2 className="text-lg font-semibold tracking-tight text-violet-700 dark:text-violet-300">
            Reading list
          </h2>
        </div>
        <span className="text-xs text-neutral-500">
          {remaining} unread · {books.length} total
        </span>
      </header>

      <form onSubmit={submit} className="mb-4">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a book…"
          className="w-full rounded-md border border-neutral-200 bg-white/70 px-3 py-2 text-sm outline-none transition-colors placeholder:text-neutral-400 focus:border-violet-400 focus:bg-white dark:border-neutral-700 dark:bg-neutral-950/70 dark:focus:bg-neutral-950"
        />
      </form>

      {books.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 py-8 text-center text-xs italic text-neutral-400 dark:border-neutral-800">
          Nothing on the reading list yet. Click 📚 on any task to move it here.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {books.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              priorities={priorities}
              onToggle={() => onUpdate(task.id, { completed: !task.completed })}
              onEdit={(title) => onUpdate(task.id, { title })}
              onDelete={() => onDelete(task.id)}
              onToggleBook={() => onToggleBook(task)}
              onSetPriority={(pid) => onUpdate(task.id, { priorityId: pid })}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
