import Link from "next/link";
import { getSecretsView } from "@/lib/secrets";
import { SettingsForm } from "@/components/SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSecretsView();
  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <Link
          href="/"
          className="text-sm text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          ← back to board
        </Link>
      </header>
      <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-400">
        Credentials for the ingest adapters. Stored locally in{" "}
        <code className="rounded bg-neutral-200 px-1 py-0.5 text-xs dark:bg-neutral-800">
          secrets.local.json
        </code>{" "}
        (git-ignored, chmod 600). Existing values are shown masked — paste a new one to replace, or clear
        the field and save to remove.
      </p>
      <SettingsForm initial={settings} />
    </main>
  );
}
