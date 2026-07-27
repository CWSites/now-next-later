"use client";

import { useState } from "react";
import type { SecretView } from "@/lib/secrets";

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
}

export function SettingsForm({ initial }: Props) {
  const [settings, setSettings] = useState<SecretView[]>(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);

  function setDraft(key: string, value: string) {
    setDrafts((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      // Only send fields the user actually touched.
      const updates: Record<string, string> = {};
      for (const [k, v] of Object.entries(drafts)) updates[k] = v;
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
      setTestResults(results);
    } catch (err) {
      setTestResults([
        { name: "error", configured: false, ok: false, error: (err as Error).message },
      ]);
    } finally {
      setTesting(false);
    }
  }

  const dirty = Object.keys(drafts).length > 0;

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {settings.map((field) => {
        const draft = drafts[field.key];
        const touched = draft !== undefined;
        return (
          <div key={field.key} className="flex flex-col gap-1">
            <label htmlFor={field.key} className="text-sm font-medium">
              {field.label}
            </label>
            {field.help ? (
              <p className="text-xs text-neutral-500">{field.help}</p>
            ) : null}
            <div className="flex items-center gap-2">
              <input
                id={field.key}
                type={field.secret ? "password" : "text"}
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  field.isSet
                    ? field.secret
                      ? `saved (${field.preview}) — paste to replace`
                      : field.preview
                    : field.placeholder ?? ""
                }
                value={touched ? draft : ""}
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
            {touched && draft === "" && field.isSet ? (
              <p className="text-xs text-red-500">Will be removed on save.</p>
            ) : null}
          </div>
        );
      })}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!dirty || saving}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => void test()}
          disabled={testing || dirty}
          title={dirty ? "Save changes before testing" : "Verify saved credentials against Jira and Slack"}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          {testing ? "Testing…" : "Test connections"}
        </button>
        {status ? <span className="text-xs text-neutral-500">{status}</span> : null}
      </div>
      <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="font-medium">Google Calendar</div>
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          After saving your Client ID and Client Secret above, click below to grant this app
          read-only access to your calendar. You&apos;ll be redirected to Google, then back here.
        </p>
        <a
          href="/api/settings/gcal/connect"
          className="mt-2 inline-block rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          Connect Google Calendar
        </a>
      </div>
      {testResults ? (
        <ul className="mt-4 space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          {testResults.map((r) => (
            <li key={r.name} className="flex items-baseline gap-2">
              <span aria-hidden className="text-base leading-none">
                {r.ok ? "✅" : r.configured ? "❌" : "➖"}
              </span>
              <span className="font-medium capitalize">{r.name}</span>
              {r.ok ? (
                <span className="text-neutral-600 dark:text-neutral-400">
                  — authenticated as <span className="font-mono">{r.identity}</span>
                  {r.detail ? <span className="text-neutral-500"> ({r.detail})</span> : null}
                </span>
              ) : (
                <span className="text-neutral-500">— {r.error ?? "not configured"}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
