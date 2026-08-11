"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Bucket, Task } from "@/lib/types";
import { TaskCard } from "./TaskCard";

interface BucketMeta {
  title: string;
  subtitle: string;
  /** Subtle accent color used for the header underline + icon color. */
  accent: {
    text: string;
    bar: string;
  };
  /** Inline SVG icon rendered before the bucket title. */
  icon: React.ReactNode;
}

function BucketIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const LABELS: Record<Bucket, BucketMeta> = {
  now: {
    title: "Now",
    subtitle: "today",
    accent: {
      text: "text-rose-600 dark:text-rose-400",
      bar: "bg-gradient-to-r from-rose-400/70 via-rose-400/20 to-transparent",
    },
    // Bolt — kinetic, immediate.
    icon: (
      <BucketIcon>
        <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
      </BucketIcon>
    ),
  },
  next: {
    title: "Next",
    subtitle: "this week",
    accent: {
      text: "text-sky-600 dark:text-sky-400",
      bar: "bg-gradient-to-r from-sky-400/70 via-sky-400/20 to-transparent",
    },
    // Arrow-right — heading forward.
    icon: (
      <BucketIcon>
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </BucketIcon>
    ),
  },
  later: {
    title: "Later",
    subtitle: "this month",
    accent: {
      text: "text-violet-600 dark:text-violet-400",
      bar: "bg-gradient-to-r from-violet-400/70 via-violet-400/20 to-transparent",
    },
    // Moon — distant / not right now.
    icon: (
      <BucketIcon>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
      </BucketIcon>
    ),
  },
};

interface SubsectionProps {
  /** Unique droppable / SortableContext id, e.g. 'later-books'. */
  id: string;
  /** Header shown above the subsection tasks. */
  label: string;
  /** Optional emoji rendered before the label. */
  emoji?: string;
  /** Optional icon rendered before the label (takes precedence over emoji
   *  when provided). Handy for Google/Jira/etc. brand marks. */
  iconSrc?: string;
  /** Compact placeholder for the subsection's task input. Ignored when
   *  `showInput` is false. */
  inputPlaceholder?: string;
  tasks: Task[];
  /** Called when the section's input is submitted. Required when
   *  `showInput` is true (the default). */
  onCreate?: (title: string) => void;
  /** Whether to render an adder input. Defaults to true. Set to false for
   *  auto-populated sub-sections like 'Jira tickets' whose contents come
   *  from ingest adapters. */
  showInput?: boolean;
  /** Optional Tailwind class fragment used for the hover-highlight ring
   *  when a drag hovers this subsection (e.g. 'violet' for reading list,
   *  'sky' for Jira). Falls back to a neutral highlight. */
  highlight?: string;
}

interface Props {
  bucket: Bucket;
  tasks: Task[];
  onCreate: (title: string, url?: string) => void;
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onDelete: (id: string) => void;
  /** When set to a task id, that card briefly flashes to confirm a merge. */
  flashMergedId?: string | null;
  /** Ids of tasks that arrived in the most recent refresh and should render
   *  with a "just arrived" highlight until the ~5min window expires. */
  justArrivedIds?: Set<string>;
  /** Optional pinned sub-section rendered at the bottom of the column
   *  (currently used for the reading list under Later). Cards inside the
   *  subsection reuse the same TaskCard so they behave identically apart
   *  from where they render. */
  subsection?: SubsectionProps;
  /** When provided, main-list task cards render a book-toggle button that
   *  flips the task's category between "book" and cleared. */
  onToggleBook?: (task: Task) => void;
}

export function Column({
  bucket,
  tasks,
  onCreate,
  onUpdate,
  onDelete,
  flashMergedId,
  justArrivedIds,
  subsection,
  onToggleBook,
}: Props) {
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
        <div className="flex items-center justify-between px-0.5">
          <div className="flex items-center gap-2">
            <span className={label.accent.text}>{label.icon}</span>
            <h2 className={`text-base font-semibold tracking-tight ${label.accent.text}`}>
              {label.title}
            </h2>
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

      <ul className="flex flex-col gap-1.5">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            justMerged={flashMergedId === task.id}
            justArrived={justArrivedIds?.has(task.id) ?? false}
            onToggle={() => onUpdate(task.id, { completed: !task.completed })}
            onEdit={(title) => onUpdate(task.id, { title })}
            onDelete={() => onDelete(task.id)}
            onToggleBook={onToggleBook ? () => onToggleBook(task) : undefined}
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

      {subsection ? (
        <Subsection
          {...subsection}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onToggleBook={onToggleBook}
          flashMergedId={flashMergedId}
          justArrivedIds={justArrivedIds}
        />
      ) : null}
      {/* Bottom spacer keeps the column visually anchored to its
          min-height without forcing the main list to stretch — that
          stretching is what previously pushed sub-sections to the
          bottom of the column. */}
      <div className="flex-1" aria-hidden />
    </section>
  );
}

function Subsection({
  id,
  label,
  emoji,
  iconSrc,
  inputPlaceholder,
  tasks,
  onCreate,
  showInput = true,
  highlight,
  onUpdate,
  onDelete,
  onToggleBook,
  flashMergedId,
  justArrivedIds,
}: SubsectionProps & {
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onDelete: (id: string) => void;
  onToggleBook?: (task: Task) => void;
  flashMergedId?: string | null;
  justArrivedIds?: Set<string>;
}) {
  const [draft, setDraft] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title || !onCreate) return;
    onCreate(title);
    setDraft("");
  }

  // Highlight classes: default violet (matches original Reading list use);
  // callers can override via the `highlight` prop.
  const hoverBg =
    highlight === "sky"
      ? "bg-sky-50/70 ring-1 ring-sky-300 dark:bg-sky-950/40 dark:ring-sky-800"
      : "bg-violet-50/70 ring-1 ring-violet-300 dark:bg-violet-950/40 dark:ring-violet-800";
  const emptyBorder =
    highlight === "sky"
      ? "border-sky-400 text-sky-600 dark:border-sky-500 dark:text-sky-300"
      : "border-violet-400 text-violet-600 dark:border-violet-500 dark:text-violet-300";

  // Making the subsection its own droppable + SortableContext lets DnD
  // treat it as a separate zone from the parent column's main list. Board's
  // drag-end handler recognizes the id and updates the task's category
  // accordingly.
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="mt-4 border-t border-dashed border-neutral-200 pt-3 dark:border-neutral-800">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {iconSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={iconSrc} alt="" width={14} height={14} className="opacity-80" />
          ) : emoji ? (
            <span aria-hidden>{emoji}</span>
          ) : null}
          <span>{label}</span>
        </div>
        <span className="tabular-nums text-[11px] text-neutral-400">
          {tasks.filter((t) => !t.completed).length}
        </span>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          className={`flex flex-col gap-1.5 rounded-md p-0.5 transition-colors ${
            isOver ? hoverBg : ""
          }`}
        >
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              justMerged={flashMergedId === task.id}
              justArrived={justArrivedIds?.has(task.id) ?? false}
              onToggle={() => onUpdate(task.id, { completed: !task.completed })}
              onEdit={(title) => onUpdate(task.id, { title })}
              onDelete={() => onDelete(task.id)}
              onToggleBook={onToggleBook ? () => onToggleBook(task) : undefined}
            />
          ))}
          {tasks.length === 0 ? (
            <li
              className={`rounded-md border border-dashed py-4 text-center text-[11px] italic transition-colors ${
                isOver ? emptyBorder : "border-neutral-200 text-neutral-400 dark:border-neutral-800"
              }`}
            >
              {isOver ? `drop to add to ${label.toLowerCase()}` : "nothing here yet"}
            </li>
          ) : null}
        </ul>
      </SortableContext>
      {showInput && inputPlaceholder ? (
        <form onSubmit={submit} className="mt-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={inputPlaceholder}
            className="w-full rounded-md border border-neutral-200 bg-white/70 px-2.5 py-1.5 text-xs outline-none transition-colors placeholder:text-neutral-400 focus:border-blue-400 focus:bg-white dark:border-neutral-700 dark:bg-neutral-950/70 dark:focus:bg-neutral-950"
          />
        </form>
      ) : null}
    </div>
  );
}
