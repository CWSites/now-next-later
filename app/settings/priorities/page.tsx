import Link from "next/link";
import { PrioritiesForm } from "@/components/PrioritiesForm";
import { SettingsTabs } from "@/components/SettingsTabs";
import { HelpTip } from "@/components/HelpTip";
import { getPriorities } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function PrioritiesSettingsPage() {
  const priorities = await getPriorities();
  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <HelpTip
            align="bottom"
            text="Priorities rank-order what matters right now. Each task gets one; the colored badge on cards matches the color you pick here. Auto-assign scans unassigned tasks against the labels + their keyword matches."
          />
        </div>
        <Link
          href="/"
          className="text-sm text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          ← back to board
        </Link>
      </header>
      <SettingsTabs active="priorities" />
      <PrioritiesForm initial={priorities} />
    </main>
  );
}
