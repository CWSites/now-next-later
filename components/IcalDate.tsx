/**
 * A tiny calendar-icon-style date badge, styled after the macOS Calendar
 * app icon: a red header strip with the day-of-week, a big day number
 * below on a paper-white body. Purely decorative.
 */
interface Props {
  /** Defaults to today. Accepts a Date so the caller can override for tests. */
  date?: Date;
}

export function IcalDate({ date = new Date() }: Props) {
  const weekday = date.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
  const day = date.getDate();
  const month = date.toLocaleDateString(undefined, { month: "long" });
  return (
    <div
      aria-label={date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })}
      className="inline-flex w-14 shrink-0 flex-col overflow-hidden rounded-md border border-neutral-300 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_4px_12px_-6px_rgba(15,23,42,0.12)] dark:border-neutral-700 dark:bg-neutral-100"
      title={`${weekday} ${month} ${day}`}
    >
      <div className="bg-gradient-to-b from-red-500 to-red-600 py-0.5 text-center text-[10px] font-bold uppercase tracking-widest text-white">
        {weekday}
      </div>
      <div className="flex items-center justify-center py-1 text-2xl font-semibold leading-none tabular-nums text-neutral-900">
        {day}
      </div>
    </div>
  );
}
