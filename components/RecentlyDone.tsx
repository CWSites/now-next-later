"use client";

import { useMemo } from "react";
import type { Task } from "@/lib/types";
import { describeUrl } from "@/lib/describe-url";
import { iconForTask } from "@/lib/task-icon";
import { ProviderIcon } from "@/components/ProviderIcon";

interface Props {
  today: Task[];
  earlierThisWeek: Task[];
  onUncomplete?: (id: string) => void;
}

export function RecentlyDone({ today, earlierThisWeek, onUncomplete }: Props) {
  const total = today.length + earlierThisWeek.length;
  const earlierByDay = useMemo(() => groupByDay(earlierThisWeek), [earlierThisWeek]);

  if (total === 0) {
    return (
      <section className="rounded-xl border border-neutral-200/80 bg-white/60 p-6 text-center text-sm text-neutral-500 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/40">
        <h2 className="text-base font-semibold text-neutral-700 dark:text-neutral-300">
          Nothing done today
        </h2>
        <p className="mt-1 text-xs italic">Go crush something.</p>
      </section>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <DoneSection
        title="Today"
        subtitle={countLabel(today.length)}
        emptyMessage="Nothing done today yet."
        onUncomplete={onUncomplete}
      >
        {today.map((t) => (
          <DoneItem key={t.id} task={t} onUncomplete={onUncomplete} />
        ))}
      </DoneSection>

      <DoneSection
        title="This week"
        subtitle={countLabel(earlierThisWeek.length)}
        emptyMessage="Nothing else finished this week."
        onUncomplete={onUncomplete}
      >
        {Object.entries(earlierByDay).map(([day, items]) => (
          <div key={day} className="space-y-1">
            <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              {day}
            </div>
            <ul className="space-y-1">
              {items.map((t) => (
                <DoneItem key={t.id} task={t} onUncomplete={onUncomplete} />
              ))}
            </ul>
          </div>
        ))}
      </DoneSection>
    </div>
  );
}

interface SectionProps {
  title: string;
  subtitle: string;
  emptyMessage: string;
  onUncomplete?: (id: string) => void;
  children: React.ReactNode;
}

function DoneSection({ title, subtitle, emptyMessage, children }: SectionProps) {
  const isEmpty = !children || (Array.isArray(children) && children.filter(Boolean).length === 0);
  return (
    <section className="flex flex-col rounded-xl border border-neutral-200/80 bg-white/80 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)] backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/60">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <span className="text-xs text-neutral-500">{subtitle}</span>
      </header>
      {isEmpty ? (
        <p className="rounded-md border border-dashed border-neutral-200 py-6 text-center text-xs italic text-neutral-400 dark:border-neutral-800">
          {emptyMessage}
        </p>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </section>
  );
}

interface ItemProps {
  task: Task;
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
      <span className="flex-1 truncate text-neutral-500 line-through">{task.title}</span>
      <span className="shrink-0 text-[11px] text-neutral-400">
        {bucket} · {time}
      </span>
      {task.url ? (
        <span className="flex shrink-0 items-center gap-1">
          {(() => {
            const icon = iconForTask(task);
            return icon ? (
              <ProviderIcon
                id={icon.id}
                emoji={icon.emoji}
                label={icon.label}
                size={12}
                className="opacity-70"
              />
            ) : null;
          })()}
          <a
            href={task.url}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500"
          >
            {task.sourceRef ?? describeUrl(task.url)}
          </a>
        </span>
      ) : null}
    </li>
  );
}

function countLabel(n: number): string {
  return `${n} ${n === 1 ? "task" : "tasks"}`;
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
