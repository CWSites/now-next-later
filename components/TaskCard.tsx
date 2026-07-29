"use client";

import { describeUrl } from "@/lib/describe-url";
import { iconForTask } from "@/lib/task-icon";
import { ProviderIcon } from "@/components/ProviderIcon";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "@/lib/types";

interface Props {
  task: Task;
  dragging?: boolean;
  justMerged?: boolean;
  onToggle?: () => void;
  onEdit?: (title: string) => void;
  onDelete?: () => void;
}

export function TaskCard({ task, dragging, justMerged, onToggle, onEdit, onDelete }: Props) {
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
      {...attributes}
      {...listeners}
      className={`group flex items-start gap-2.5 rounded-lg border px-2.5 py-2 text-sm cursor-grab touch-none select-none transition-all duration-300 ease-out active:cursor-grabbing hover:-translate-y-px hover:shadow-md ${
        dragging
          ? "ring-2 ring-blue-400 border-blue-200 bg-white shadow-xl scale-[1.02] dark:border-blue-800 dark:bg-neutral-900"
          : justMerged
            ? "ring-2 ring-green-400 border-green-300 bg-green-50 shadow-md dark:ring-green-500 dark:border-green-700 dark:bg-green-950/60"
            : "border-neutral-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-neutral-800 dark:bg-neutral-900/80 dark:shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
      }`}
    >
      <input
        type="checkbox"
        checked={task.completed}
        onChange={onToggle}
        // When onToggle isn't provided (e.g. the DragOverlay ghost card),
        // React would warn about a controlled checkbox with no onChange.
        // Mark it read-only in that case to keep it a controlled element.
        readOnly={!onToggle}
        onPointerDown={(e) => e.stopPropagation()}
        className="mt-[3px] h-4 w-4 shrink-0 cursor-pointer rounded accent-blue-500"
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
            onDoubleClick={() => setEditing(true)}
            className={task.completed ? "text-neutral-400 line-through" : ""}
          >
            {task.title}
          </div>
          {task.sourceRef || task.url ? (
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-neutral-500">
              {(() => {
                const icon = iconForTask(task);
                return icon ? (
                  <ProviderIcon
                    id={icon.id}
                    emoji={icon.emoji}
                    label={icon.label}
                    size={12}
                    className="shrink-0 opacity-80"
                  />
                ) : null;
              })()}
              <span className="truncate">
                {task.url ? (
                  <a
                    href={task.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500 dark:decoration-neutral-700"
                  >
                    {/* Fall back to a compact host+path when there's no
                        human-friendly sourceRef (manually-added tasks). */}
                    {task.sourceRef ?? describeUrl(task.url)}
                  </a>
                ) : (
                  task.sourceRef
                )}
              </span>
            </div>
          ) : null}
        </div>
      )}
      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Delete task"
          className="opacity-0 transition-opacity group-hover:opacity-100 text-neutral-400 hover:text-red-500"
        >
          ✕
        </button>
      ) : null}
    </li>
  );
}
