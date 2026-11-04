import Link from "next/link";

/**
 * Shared tab strip for the Settings pages. Lives at the top of both
 * /settings and /settings/priorities so users can jump between them
 * without round-tripping through the board.
 *
 * Kept as a plain server component with hard string comparison — no
 * usePathname, no client bundle, no highlight flicker on first paint.
 */
export function SettingsTabs({ active }: { active: "integrations" | "priorities" }) {
  const base =
    "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors";
  const activeCls =
    "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900";
  const idleCls =
    "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900";
  return (
    <nav className="mb-6 flex items-center gap-2">
      <Link
        href="/settings"
        className={`${base} ${active === "integrations" ? activeCls : idleCls}`}
      >
        Integrations
      </Link>
      <Link
        href="/settings/priorities"
        className={`${base} ${active === "priorities" ? activeCls : idleCls}`}
      >
        Priorities
      </Link>
    </nav>
  );
}
