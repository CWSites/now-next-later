"use client";

import { describeUrl } from "@/lib/describe-url";
import { iconForTask } from "@/lib/task-icon";
import { decodeHtmlEntities } from "@/lib/decode-html";
import { ProviderIcon } from "@/components/ProviderIcon";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Priority, Task } from "@/lib/types";

/**
 * Tailwind class fragments keyed by the short color token stored on a
 * Priority. Lookup table keeps user input from leaking into class names
 * and lets the color palette evolve without touching every call site.
 * Falls back to neutral when a token isn't recognized.
 */
const PRIORITY_COLOR_CLASSES: Record<string, string> = {
  rose: "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-200 dark:ring-rose-900",
  amber: "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:ring-amber-900",
  emerald: "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:ring-emerald-900",
  sky: "bg-sky-100 text-sky-800 ring-sky-200 dark:bg-sky-950/60 dark:text-sky-200 dark:ring-sky-900",
  violet: "bg-violet-100 text-violet-800 ring-violet-200 dark:bg-violet-950/60 dark:text-violet-200 dark:ring-violet-900",
  neutral: "bg-neutral-100 text-neutral-700 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:ring-neutral-700",
};
function priorityClasses(color?: string): string {
  return PRIORITY_COLOR_CLASSES[color ?? "neutral"] ?? PRIORITY_COLOR_CLASSES.neutral;
}

interface Props {
  task: Task;
  /** All known priorities, ordered by rank. Used to render the `#N` badge
   *  and the picker. Defaults to [] so the DragOverlay ghost can render
   *  without the parent threading priorities through to the overlay. */
  priorities?: Priority[];
  dragging?: boolean;
  justMerged?: boolean;
  /** True when the task first arrived in the most recent Refresh and is
   *  still within the ~5min "look what's new" highlight window. Rendered
   *  with an amber ring/tint so newly-ingested items pop visually. */
  justArrived?: boolean;
  onToggle?: () => void;
  onEdit?: (title: string) => void;
  onDelete?: () => void;
  /** When provided, renders a small book-toggle button that flips the
   *  task's `category` between "book" and undefined. Only wired for the
   *  Later column where the Reading-list subsection lives. */
  onToggleBook?: () => void;
  /** Called with the chosen priority id, or null to clear. Opens a tiny
   *  popover of the available priorities on the card. */
  onSetPriority?: (priorityId: string | null) => void;
}

export function TaskCard({
  task,
  priorities = [],
  dragging,
  justMerged,
  justArrived,
  onToggle,
  onEdit,
  onDelete,
  onToggleBook,
  onSetPriority,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const priority = task.priorityId
    ? priorities.find((p) => p.id === task.priorityId)
    : undefined;
  // Dismiss the picker on outside click / Escape so it feels like a native
  // menu rather than a persistent panel.
  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e: MouseEvent) {
      if (!pickerRef.current) return;
      if (!pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPickerOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  // Display uses the decoded title so raw entities from upstream (Lattice,
  // Confluence excerpts, etc.) render as real characters. Storage keeps
  // whatever came in; when the user opens the editor we pre-populate the
  // draft with the decoded version so what they see is what they can edit.
  const displayTitle = decodeHtmlEntities(task.title);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayTitle);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow the textarea to fit its content so long titles are fully visible
  // while editing. Runs on every draft change plus on open.
  useLayoutEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, editing]);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  function beginEdit() {
    setDraft(displayTitle);
    setEditing(true);
  }

  function commitEdit() {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== task.title) onEdit?.(next);
    else setDraft(displayTitle);
  }

  function cancelEdit() {
    setDraft(displayTitle);
    setEditing(false);
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group relative flex items-start gap-2.5 rounded-lg border px-2.5 py-2 text-sm cursor-grab touch-none select-none transition-all duration-300 ease-out active:cursor-grabbing hover:-translate-y-px hover:shadow-md ${
        dragging
          ? "ring-2 ring-blue-400 border-blue-200 bg-white shadow-xl scale-[1.02] dark:border-blue-800 dark:bg-neutral-900"
          : justMerged
            ? "ring-2 ring-green-400 border-green-300 bg-green-50 shadow-md dark:ring-green-500 dark:border-green-700 dark:bg-green-950/60"
            : justArrived
              ? "ring-2 ring-amber-400 border-amber-300 bg-amber-50 shadow-md dark:ring-amber-500 dark:border-amber-700 dark:bg-amber-950/40"
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
        <textarea
          ref={textareaRef}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            // Enter commits, Shift+Enter inserts a newline, Escape cancels.
            // Cmd/Ctrl+Enter also commits so muscle-memory from other apps
            // that use it as "submit" works.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitEdit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelEdit();
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          rows={1}
          className="flex-1 min-w-0 resize-none overflow-hidden bg-transparent leading-snug outline-none"
        />
      ) : (
        <div className="flex-1 min-w-0">
          <div
            onDoubleClick={beginEdit}
            className={task.completed ? "text-neutral-400 line-through" : ""}
          >
            {displayTitle}
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
                    {task.sourceRef
                      ? decodeHtmlEntities(task.sourceRef)
                      : describeUrl(task.url)}
                  </a>
                ) : task.sourceRef ? (
                  decodeHtmlEntities(task.sourceRef)
                ) : null}
              </span>
            </div>
          ) : null}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-1.5">
        {priority ? (
          <button
            type="button"
            onClick={() => onSetPriority && setPickerOpen((v) => !v)}
            onPointerDown={(e) => e.stopPropagation()}
            title={`#${priority.rank} ${priority.label} \u2014 click to change`}
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 transition-opacity ${priorityClasses(priority.color)} ${onSetPriority ? "cursor-pointer hover:opacity-90" : "cursor-default"}`}
          >
            <span className="tabular-nums opacity-70">#{priority.rank}</span>
            <span className="max-w-[7rem] truncate">{priority.label}</span>
          </button>
        ) : onSetPriority && priorities.length > 0 ? (
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Set priority"
            title="Set priority"
            className="opacity-0 transition-opacity group-hover:opacity-100 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            #
          </button>
        ) : null}
        {pickerOpen && onSetPriority ? (
          <div
            ref={pickerRef}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute right-2 top-8 z-10 w-52 rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          >
            {priorities
              .filter((p) => !p.retired || p.id === task.priorityId)
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onSetPriority(p.id);
                    setPickerOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                    task.priorityId === p.id ? "font-semibold" : ""
                  }`}
                >
                  <span
                    className={`inline-flex h-4 w-6 items-center justify-center rounded text-[10px] font-semibold ring-1 ${priorityClasses(p.color)}`}
                  >
                    #{p.rank}
                  </span>
                  <span className="truncate">{p.label}</span>
                </button>
              ))}
            {task.priorityId ? (
              <button
                type="button"
                onClick={() => {
                  onSetPriority(null);
                  setPickerOpen(false);
                }}
                className="mt-1 w-full rounded border-t border-neutral-200 px-2 py-1 text-left text-[11px] text-neutral-500 hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800"
              >
                Clear priority
              </button>
            ) : null}
          </div>
        ) : null}
        {onToggleBook ? (
          <button
            type="button"
            onClick={onToggleBook}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={
              task.category === "book"
                ? "Remove from reading list"
                : "Add to reading list"
            }
            title={
              task.category === "book"
                ? "Remove from reading list"
                : "Move to reading list"
            }
            className={`transition-opacity ${
              task.category === "book"
                ? "opacity-80 hover:opacity-100 text-violet-500"
                : "opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-violet-500"
            }`}
          >
            📚
          </button>
        ) : null}
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
      </div>
    </li>
  );
}
