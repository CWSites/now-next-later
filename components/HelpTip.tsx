"use client";

/**
 * Small `?` badge that reveals a tooltip on hover or keyboard focus.
 * Used to hide long explainer text on the Settings page until wanted.
 */
interface Props {
  text: string;
  /** Tooltip position relative to the trigger. Defaults to above-right. */
  align?: "top" | "bottom";
  className?: string;
}

export function HelpTip({ text, align = "top", className }: Props) {
  const position =
    align === "bottom"
      ? "top-full mt-1.5"
      : "bottom-full mb-1.5";
  return (
    <span className={`relative inline-flex group/help ${className ?? ""}`}>
      <button
        type="button"
        aria-label="More info"
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-neutral-300 text-[10px] font-semibold text-neutral-400 transition-colors hover:border-neutral-500 hover:text-neutral-700 dark:border-neutral-700 dark:hover:border-neutral-500 dark:hover:text-neutral-200"
      >
        ?
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-0 z-20 w-64 rounded-md bg-neutral-900 px-2.5 py-1.5 text-[11px] leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/help:opacity-100 group-focus-within/help:opacity-100 dark:bg-neutral-100 dark:text-neutral-900 ${position}`}
      >
        {text}
      </span>
    </span>
  );
}
