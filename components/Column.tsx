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
  onCreate: (title: string) => void;
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onDelete: (id: string) => void;
}

export function Column({ bucket, tasks, onCreate, onUpdate, onDelete }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: bucket });
  const [draft, setDraft] = useState("");
  const label = LABELS[bucket];
  const remaining = tasks.filter((t) => !t.completed).length;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    onCreate(title);
    setDraft("");
  }

  return (
    <section
      ref={setNodeRef}
      className={`flex min-h-[300px] flex-col rounded-lg border bg-white/60 p-3 shadow-sm transition-colors dark:border-neutral-800 dark:bg-neutral-900/60 ${
        isOver ? "border-blue-400 dark:border-blue-500" : "border-neutral-200"
      }`}
    >
      <header className="mb-3 flex items-baseline justify-between px-1">
        <div>
          <h2 className="text-lg font-semibold">{label.title}</h2>
          <p className="text-xs text-neutral-500">{label.subtitle}</p>
        </div>
        <span className="text-xs text-neutral-500">{remaining}</span>
      </header>

      <form onSubmit={submit} className="mb-3">
        <input
          id={`new-task-${bucket}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Add to ${label.title}…`}
          className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-neutral-700 dark:bg-neutral-950"
        />
      </form>

      <ul className="flex flex-1 flex-col gap-1.5">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onToggle={() => onUpdate(task.id, { completed: !task.completed })}
            onEdit={(title) => onUpdate(task.id, { title })}
            onDelete={() => onDelete(task.id)}
          />
        ))}
        {tasks.length === 0 ? (
          <li className="rounded-md border border-dashed border-neutral-200 py-6 text-center text-xs text-neutral-400 dark:border-neutral-800">
            nothing here
          </li>
        ) : null}
      </ul>
    </section>
  );
}
