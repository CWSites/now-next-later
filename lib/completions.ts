import type { Task } from "./types";

/**
 * Helpers for classifying and grouping completed tasks by when they were
 * finished. All comparisons use the local timezone of whoever is looking
 * at the board — completions "today" means today for the viewer.
 */

export function startOfLocalDay(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfLocalWeek(now: Date = new Date()): Date {
  // Monday-based: Monday 00:00 in the viewer's local timezone.
  const d = startOfLocalDay(now);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return d;
}

export interface CompletedGroups {
  today: Task[];
  earlierThisWeek: Task[];
}

/**
 * Split completed tasks into "finished today" and "finished earlier in
 * the same week" (Mon–Sun). Anything completed before the current week
 * is not returned — that keeps the panel focused on recent wins.
 * Each group is sorted most-recent-first.
 */
export function groupRecentlyCompleted(tasks: Task[], now: Date = new Date()): CompletedGroups {
  const dayStart = startOfLocalDay(now).getTime();
  const weekStart = startOfLocalWeek(now).getTime();

  const today: Task[] = [];
  const earlier: Task[] = [];

  for (const t of tasks) {
    if (!t.completed || !t.completedAt) continue;
    const at = new Date(t.completedAt).getTime();
    if (Number.isNaN(at)) continue;
    if (at >= dayStart) today.push(t);
    else if (at >= weekStart) earlier.push(t);
  }

  const byRecency = (a: Task, b: Task) =>
    new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime();
  today.sort(byRecency);
  earlier.sort(byRecency);

  return { today, earlierThisWeek: earlier };
}

/**
 * A task should be hidden from its main column once it was completed on
 * a previous day — that's how end-of-day auto-archive works. The task
 * is not deleted or mutated; the Board just filters it out of the
 * three-column view. It still shows up in "Recently completed" and,
 * because completedAt is a real timestamp, everything remains fully
 * reversible: unchecking the box clears completedAt, and the task
 * rejoins its column.
 */
export function isArchivedForToday(task: Task, now: Date = new Date()): boolean {
  if (!task.completed || !task.completedAt) return false;
  const at = new Date(task.completedAt).getTime();
  if (Number.isNaN(at)) return false;
  return at < startOfLocalDay(now).getTime();
}
