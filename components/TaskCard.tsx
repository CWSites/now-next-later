"use client";

import { describeUrl } from "@/lib/describe-url";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "@/lib/types";

interface Props {
  task: Task;
  dragging?: boolean;
  onToggle?: () => void;
  onEdit?: (title: string) => void;
  onDelete?: () => void;
}

export function TaskCard({ task, dragging, onToggle, onEdit, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  function commitEdit() {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== task.title) onEdit?.(next);
    else setDraft(task.title);
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`group flex items-start gap-2 rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm shadow-sm dark:border-neutral-800 dark:bg-neutral-900 ${
        dragging ? "ring-2 ring-blue-400" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={task.completed}
        onChange={onToggle}
        className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
      />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") {
              setDraft(task.title);
              setEditing(false);
            }
          }}
          className="flex-1 bg-transparent outline-none"
        />
      ) : (
        <div className="flex-1 min-w-0">
          <div
            {...attributes}
            {...listeners}
            onDoubleClick={() => setEditing(true)}
            className={`cursor-grab select-none active:cursor-grabbing ${
              task.completed ? "text-neutral-400 line-through" : ""
            }`}
          >
            {task.title}
          </div>
          {task.sourceRef || task.url ? (
            <div className="mt-0.5 truncate text-[11px] text-neutral-500">
              {task.url ? (
                <a
                  href={task.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500 dark:decoration-neutral-700"
                >
                  {/* Fall back to a compact host+path when there's no
                      human-friendly sourceRef (manually-added tasks). */}
                  {task.sourceRef ?? describeUrl(task.url)}
                </a>
              ) : (
                task.sourceRef
              )}
            </div>
          ) : null}
        </div>
      )}
      {onDelete ? (
        <button
          onClick={onDelete}
          aria-label="Delete task"
          className="opacity-0 transition-opacity group-hover:opacity-100 text-neutral-400 hover:text-red-500"
        >
          ✕
        </button>
      ) : null}
    </li>
  );
}
