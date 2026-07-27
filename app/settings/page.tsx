import Link from "next/link";
import { headers } from "next/headers";
import { getSecretsView, PROVIDERS } from "@/lib/secrets";
import { SettingsForm } from "@/components/SettingsForm";

export const dynamic = "force-dynamic";

interface Params {
  searchParams: Promise<{ gcal?: string }>;
}

export default async function SettingsPage({ searchParams }: Params) {
  const settings = await getSecretsView();
  const { gcal } = await searchParams;
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const appOrigin = `${proto}://${host}`;
  const workspaceMatch = process.env.SLACK_WORKSPACE_MATCH ?? "your-workspace";
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
      {gcal ? (
        <div
          className={`mb-4 rounded-md border p-3 text-sm ${
            gcal === "connected"
              ? "border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
              : "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          }`}
        >
          {gcal === "connected"
            ? "✅ Google Calendar connected. Hit Refresh on the board to pull events."
            : `❌ Google Calendar connect failed: ${gcal.replace(/^error:/, "")}`}
        </div>
      ) : null}
      <SettingsForm
        initial={settings}
        providers={PROVIDERS}
        appOrigin={appOrigin}
        slackWorkspaceMatch={workspaceMatch}
      />
    </main>
  );
}
