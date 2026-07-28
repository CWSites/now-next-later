import Link from "next/link";
import { headers } from "next/headers";
import { applySecretsToEnv, getSecretsView, PROVIDERS } from "@/lib/secrets";
import { SettingsForm } from "@/components/SettingsForm";
import { HelpTip } from "@/components/HelpTip";

export const dynamic = "force-dynamic";

interface Params {
  searchParams: Promise<{ gcal?: string; fellow?: string }>;
}

export default async function SettingsPage({ searchParams }: Params) {
  // Populate process.env from secrets.local.json so runtime-configurable
  // values like SLACK_WORKSPACE_MATCH flow to the bookmarklet without a
  // dev-server restart.
  await applySecretsToEnv();
  const settings = await getSecretsView();
  const { gcal, fellow } = await searchParams;
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const appOrigin = `${proto}://${host}`;
  const workspaceMatch = (process.env.SLACK_WORKSPACE_MATCH ?? "").trim();
  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-baseline justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <HelpTip
            align="bottom"
            text="Credentials for the ingest adapters. Stored locally in secrets.local.json (git-ignored, chmod 600). Existing secrets are shown masked — paste a new value to replace one; clear the field and save to remove."
          />
        </div>
        <Link
          href="/"
          className="text-sm text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          ← back to board
        </Link>
      </header>
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
      {fellow ? (
        <div
          className={`mb-4 rounded-md border p-3 text-sm ${
            fellow === "connected"
              ? "border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
              : "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          }`}
        >
          {fellow === "connected"
            ? "✅ Fellow connected. Hit Refresh on the board to pull action items."
            : `❌ Fellow connect failed: ${fellow.replace(/^error:/, "")}`}
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
