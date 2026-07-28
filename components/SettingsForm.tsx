"use client";

import { useMemo, useState } from "react";
import type { SecretView, Provider, ProviderMeta } from "@/lib/secrets";
import { SlackBookmarklet } from "@/components/SlackBookmarklet";
import { LatticeBookmarklet } from "@/components/LatticeBookmarklet";
import { TagInput } from "@/components/TagInput";
import { HelpTip } from "@/components/HelpTip";

interface TestResult {
  name: string;
  configured: boolean;
  ok: boolean;
  identity?: string;
  detail?: string;
  error?: string;
}

interface Props {
  initial: SecretView[];
  providers: ProviderMeta[];
  appOrigin: string;
  slackWorkspaceMatch: string;
}

export function SettingsForm({ initial, providers, appOrigin, slackWorkspaceMatch }: Props) {
  const [settings, setSettings] = useState<SecretView[]>(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, TestResult> | null>(null);

  const byProvider = useMemo(() => {
    const m = new Map<Provider, SecretView[]>();
    for (const p of providers) m.set(p.id, []);
    for (const s of settings) {
      const list = m.get(s.provider);
      if (list) list.push(s);
    }
    return m;
  }, [settings, providers]);

  function setDraft(key: string, value: string) {
    setDrafts((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const updates: Record<string, string> = { ...drafts };
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { settings: fresh } = (await res.json()) as { settings: SecretView[] };
      setSettings(fresh);
      setDrafts({});
      setStatus("Saved.");
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  function clear(key: string) {
    setDraft(key, "");
  }

  async function test() {
    setTesting(true);
    setTestResults(null);
    try {
      const res = await fetch("/api/settings/test", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { results } = (await res.json()) as { results: TestResult[] };
      const map: Record<string, TestResult> = {};
      for (const r of results) map[r.name] = r;
      setTestResults(map);
    } catch (err) {
      setTestResults({
        error: { name: "error", configured: false, ok: false, error: (err as Error).message },
      });
    } finally {
      setTesting(false);
    }
  }

  const dirty = Object.keys(drafts).length > 0;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {/* Sticky action bar at the top so users don't have to scroll past every provider to save/test. */}
      <div className="sticky top-0 z-10 -mx-6 flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-neutral-50/95 px-6 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
        <button
          type="submit"
          disabled={!dirty || saving}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
        <button
          type="button"
          onClick={() => void test()}
          disabled={testing || dirty}
          title={dirty ? "Save changes before testing" : "Verify saved credentials against every provider"}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          {testing ? "Testing…" : "Test all connections"}
        </button>
        {status ? <span className="text-xs text-neutral-500">{status}</span> : null}
      </div>

      {/* Responsive provider grid:
            - <768px  → single column (stack)
            - 768–1279 → two columns
            - ≥1280   → three columns
          Sections `break-inside-avoid` isn't needed here since we're using CSS Grid
          (not columns), which already keeps each card as one unit. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {providers.map((p) => {
        const fields = byProvider.get(p.id) ?? [];
        const result = testResults?.[p.id];
        return (
          <section
            key={p.id}
            className="flex flex-col rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
          >
            <header className="mb-3 flex items-baseline justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">
                  <span aria-hidden className="mr-1.5">
                    {p.emoji}
                  </span>
                  {p.label}
                </h2>
                <p className="mt-0.5 text-xs text-neutral-500">{p.description}</p>
              </div>
              {result ? (
                <span
                  className={`shrink-0 text-xs ${
                    result.ok
                      ? "text-green-700 dark:text-green-400"
                      : result.configured
                        ? "text-red-600 dark:text-red-400"
                        : "text-neutral-500"
                  }`}
                >
                  {result.ok ? "✅ " : result.configured ? "❌ " : "➖ "}
                  {result.ok
                    ? `${result.identity}${result.detail ? ` (${result.detail})` : ""}`
                    : (result.error ?? "not configured")}
                </span>
              ) : null}
            </header>

            <div className="space-y-4">
              {fields.map((field) => {
                const draft = drafts[field.key];
                const touched = draft !== undefined;
                // Non-secret fields (URLs, filter lists, usernames) should
                // show their saved value in the input so the user can edit
                // in place. Secret fields keep the paste-to-replace UX
                // since we don't have the plaintext value in the browser.
                const showAsValue = field.isSet && !field.secret;
                const displayValue = touched
                  ? draft
                  : showAsValue
                    ? field.preview
                    : "";
                return (
                  <div key={field.key} className="flex flex-col gap-1">
                    <label
                      htmlFor={field.key}
                      className="flex items-center gap-1.5 text-sm font-medium"
                    >
                      {field.label}
                      {field.help ? <HelpTip text={field.help} /> : null}
                    </label>
                    {field.kind === "tags" ? (
                      <TagInput
                        inputId={field.key}
                        value={displayValue}
                        onChange={(v) => setDraft(field.key, v)}
                        placeholder={field.placeholder}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          id={field.key}
                          type={field.secret ? "password" : "text"}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={
                            field.isSet && field.secret
                              ? `saved (${field.preview}) — paste to replace`
                              : (field.placeholder ?? "")
                          }
                          value={displayValue}
                          onChange={(e) => setDraft(field.key, e.target.value)}
                          className="flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-neutral-700 dark:bg-neutral-950"
                        />
                        {field.isSet ? (
                          <button
                            type="button"
                            onClick={() => clear(field.key)}
                            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
                            title="Clear this value on save"
                          >
                            clear
                          </button>
                        ) : null}
                      </div>
                    )}
                    {touched && draft === "" && field.isSet ? (
                      <p className="text-xs text-red-500">Will be removed on save.</p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Provider-specific extra actions. Long-form explainer text
                lives inside HelpTip tooltips to keep the card compact. */}
            {p.id === "gcal" ? (
              <div className="mt-4 flex items-center gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                <a
                  href="/api/settings/gcal/connect"
                  className="inline-block rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  Connect Google Calendar
                </a>
                <HelpTip text="After saving your Client ID and Client Secret above, click here to grant read-only calendar access. You'll be redirected to Google, then back here." />
              </div>
            ) : null}
            {p.id === "slack" ? (
              <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                <SlackBookmarklet
                  appOrigin={appOrigin}
                  workspaceMatch={slackWorkspaceMatch}
                />
              </div>
            ) : null}
            {p.id === "lattice" ? (
              <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                <LatticeBookmarklet appOrigin={appOrigin} />
              </div>
            ) : null}
            {p.id === "fellow" ? (
              <div className="mt-4 flex items-center gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                <a
                  href="/api/settings/fellow/connect"
                  className="inline-block rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  Connect Fellow
                </a>
                <HelpTip text="Fellow uses OAuth 2.0 with PKCE and dynamic client registration — no API key needed. Click to authorize read-only access to your 1:1 action items." />
              </div>
            ) : null}
          </section>
        );
      })}
      </div>

      {testResults?.error ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {testResults.error.error}
        </div>
      ) : null}
    </form>
  );
}
