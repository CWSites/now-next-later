"use client";

import { useMemo, useState } from "react";
import type { Task } from "@/lib/types";
import { describeUrl } from "@/lib/describe-url";

interface Props {
  today: Task[];
  earlierThisWeek: Task[];
  onUncomplete?: (id: string) => void;
}

export function RecentlyDone({ today, earlierThisWeek, onUncomplete }: Props) {
  const [showWeek, setShowWeek] = useState(false);
  const total = today.length + earlierThisWeek.length;

  const earlierByDay = useMemo(() => groupByDay(earlierThisWeek), [earlierThisWeek]);

  if (total === 0) {
    return (
      <section className="mt-6 rounded-lg border border-neutral-200 bg-white/40 p-4 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/40">
        <h2 className="text-base font-semibold text-neutral-700 dark:text-neutral-300">
          Recently completed
        </h2>
        <p className="mt-1 text-xs">Nothing done today — go crush something.</p>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-lg border border-neutral-200 bg-white/60 p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/60">
      <header className="mb-3 flex items-baseline justify-between">
        <div>
          <h2 className="text-base font-semibold">Recently completed</h2>
          <p className="text-xs text-neutral-500">
            {today.length} today · {earlierThisWeek.length} earlier this week
          </p>
        </div>
        {earlierThisWeek.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowWeek((v) => !v)}
            className="text-xs text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200"
          >
            {showWeek ? "hide this week" : "show this week"}
          </button>
        ) : null}
      </header>

      {today.length > 0 ? (
        <div>
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Today
          </h3>
          <ul className="space-y-1">
            {today.map((t) => (
              <DoneItem key={t.id} task={t} showDay={false} onUncomplete={onUncomplete} />
            ))}
          </ul>
        </div>
      ) : null}

      {showWeek && earlierThisWeek.length > 0 ? (
        <div className={today.length > 0 ? "mt-4" : ""}>
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Earlier this week
          </h3>
          {Object.entries(earlierByDay).map(([day, items]) => (
            <div key={day} className="mb-2">
              <div className="text-[11px] text-neutral-500">{day}</div>
              <ul className="space-y-1">
                {items.map((t) => (
                  <DoneItem key={t.id} task={t} showDay={false} onUncomplete={onUncomplete} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

interface ItemProps {
  task: Task;
  showDay: boolean;
  onUncomplete?: (id: string) => void;
}

function DoneItem({ task, onUncomplete }: ItemProps) {
  const at = task.completedAt ? new Date(task.completedAt) : null;
  const time = at ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const bucket = task.bucket;
  return (
    <li className="group flex items-baseline gap-2 rounded px-1 py-0.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
      <input
        type="checkbox"
        checked
        onChange={() => onUncomplete?.(task.id)}
        title="Uncheck to move this task back to its column"
        className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-neutral-400"
      />
      <span className="text-neutral-500 line-through">{task.title}</span>
      <span className="ml-auto shrink-0 text-[11px] text-neutral-400">
        {bucket} · {time}
      </span>
      {task.url ? (
        <a
          href={task.url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[11px] text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500"
        >
          {task.sourceRef ?? describeUrl(task.url)}
        </a>
      ) : null}
    </li>
  );
}

function groupByDay(tasks: Task[]): Record<string, Task[]> {
  const out: Record<string, Task[]> = {};
  for (const t of tasks) {
    if (!t.completedAt) continue;
    const d = new Date(t.completedAt);
    const label = d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
    (out[label] ??= []).push(t);
  }
  return out;
}
