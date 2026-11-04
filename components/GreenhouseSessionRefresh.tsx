"use client";

import { useEffect, useState } from "react";

/**
 * Greenhouse session refresh button.
 *
 * Calls /api/settings/greenhouse/auto-refresh, which runs
 * scripts/refresh-greenhouse-session.sh server-side:
 *  - AppleScript reads the recruiter subdomain + CSRF meta tag from the
 *    open *.greenhouse.io Chrome tab,
 *  - cookie DB + Keychain decrypt every greenhouse.io cookie,
 *  - verifies the session is live,
 *  - writes host/cookie/csrf into secrets.local.json.
 *
 * No bookmarklet fallback: Greenhouse's session cookie is HttpOnly, so JS
 * running in the Greenhouse tab can't read it. This path (server-side
 * cookie DB decrypt) is the only way without an API key.
 */

type RefreshState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; host?: string; cookieCount?: number; csrfLast6?: string }
  | { kind: "error"; message: string; hint?: string | null };

export function GreenhouseSessionRefresh() {
  const [state, setState] = useState<RefreshState>({ kind: "idle" });
  const [available, setAvailable] = useState<null | {
    ok: boolean;
    reason: string | null;
  }>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/greenhouse/auto-refresh", { method: "GET" })
      .then((r) => r.json())
      .then((data: { available: boolean; reason: string | null }) => {
        if (!cancelled) setAvailable({ ok: data.available, reason: data.reason });
      })
      .catch(() => {
        if (!cancelled) {
          setAvailable({ ok: false, reason: "Could not reach refresh endpoint." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runRefresh() {
    setState({ kind: "running" });
    try {
      const res = await fetch("/api/settings/greenhouse/auto-refresh", {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        host?: string;
        cookieCount?: number;
        csrfLast6?: string;
        error?: string;
        hint?: string | null;
      };
      if (res.ok && data.ok) {
        setState({
          kind: "ok",
          host: data.host,
          cookieCount: data.cookieCount,
          csrfLast6: data.csrfLast6,
        });
      } else {
        setState({
          kind: "error",
          message: data.error ?? `HTTP ${res.status}`,
          hint: data.hint ?? null,
        });
      }
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={runRefresh}
          disabled={state.kind === "running" || available?.ok === false}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          {state.kind === "running" ? "Refreshing…" : "Refresh session"}
        </button>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          Sign into Greenhouse in Chrome first, then click.
        </span>
      </div>
      {available && !available.ok ? (
        <div className="text-xs text-amber-700 dark:text-amber-300">
          {available.reason}
        </div>
      ) : null}
      {state.kind === "ok" ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          ✅ Session captured from <code>{state.host}</code> ({state.cookieCount}{" "}
          cookies, csrf …{state.csrfLast6}).
        </div>
      ) : null}
      {state.kind === "error" ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <div>❌ {state.message}</div>
          {state.hint ? (
            <div className="mt-1 text-red-800 dark:text-red-300">{state.hint}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
