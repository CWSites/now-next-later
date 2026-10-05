"use client";

import { useEffect, useState } from "react";

/**
 * Slack token refresh UI.
 *
 * Primary path: a "Refresh now" button that calls
 * /api/settings/slack/auto-refresh. That endpoint runs the same
 * `scripts/refresh-slack-tokens.sh` the dev server runs on predev, which
 * reads xoxc from the live Chrome tab via AppleScript and decrypts xoxd
 * from Chrome's cookie DB using the macOS Keychain. One click, no DevTools,
 * no bookmarks bar, both tokens refreshed.
 *
 * Fallback: a draggable `javascript:` bookmarklet. Needed when the Next
 * server isn't on the same Mac as a signed-in Chrome (SSH / remote dev /
 * Chrome quit / Keychain unavailable). The bookmarklet can only refresh
 * xoxc — xoxd is HttpOnly on app.slack.com, so JS can't read it and the
 * server will reuse whatever xoxd is already stored. If both halves are
 * stale the fallback can't recover; use the primary button.
 */

// NOTE: no `//` line comments inside the template below. After whitespace
// is collapsed at render time, the bookmarklet becomes a single line and
// any `//` comment would swallow every remaining statement.
const BOOKMARKLET_SRC = `(async()=>{try{
  const cfg=JSON.parse(localStorage.localConfig_v2||'{}');
  const teams=cfg&&cfg.teams?Object.values(cfg.teams):[];
  if(!teams.length){alert('No Slack workspaces found in localStorage. Are you signed in?');return;}
  const match=%%WORKSPACE_MATCH%%;
  const team=match?teams.find(t=>(t.domain||'').toLowerCase().includes(match)||(t.name||'').toLowerCase().includes(match)):teams[0];
  if(!team||!team.token){alert('No matching workspace found. Looking for: '+(match||'(any)')+'. Available: '+teams.map(t=>t.domain||t.name).join(', '));return;}
  const res=await fetch('%%APP_ORIGIN%%/api/settings/slack/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({xoxc:team.token,workspace:team.domain||team.name})});
  const data=await res.json();
  if(res.ok){alert('\u2705 Slack xoxc saved. Authenticated as '+data.user+' (team: '+data.team+').');}
  else{alert('\u274C '+(data.error||('HTTP '+res.status)));}
}catch(e){alert('Error: '+e.message);}})();`;

interface Props {
  appOrigin: string;
  /** Substring to match against workspace domain/name (case-insensitive). Empty = first team. */
  workspaceMatch: string;
}

type RefreshState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; user?: string; team?: string; xoxcLast4?: string; xoxdLast4?: string }
  | { kind: "error"; message: string; hint?: string | null };

export function SlackBookmarklet({ appOrigin, workspaceMatch }: Props) {
  const [state, setState] = useState<RefreshState>({ kind: "idle" });
  const [available, setAvailable] = useState<null | { ok: boolean; reason: string | null }>(null);
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/slack/auto-refresh", { method: "GET" })
      .then((r) => r.json())
      .then((data: { available: boolean; reason: string | null }) => {
        if (!cancelled) setAvailable({ ok: data.available, reason: data.reason });
      })
      .catch(() => {
        if (!cancelled) setAvailable({ ok: false, reason: "Could not reach refresh endpoint." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runRefresh() {
    setState({ kind: "running" });
    try {
      const res = await fetch("/api/settings/slack/auto-refresh", { method: "POST" });
      const data = (await res.json()) as {
        ok?: boolean;
        user?: string;
        team?: string;
        xoxcLast4?: string;
        xoxdLast4?: string;
        error?: string;
        hint?: string | null;
      };
      if (res.ok && data.ok) {
        setState({
          kind: "ok",
          user: data.user,
          team: data.team,
          xoxcLast4: data.xoxcLast4,
          xoxdLast4: data.xoxdLast4,
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

  const src = BOOKMARKLET_SRC.replace(/\s+/g, " ")
    .replace(/%%APP_ORIGIN%%/g, appOrigin)
    .replace(
      /%%WORKSPACE_MATCH%%/g,
      workspaceMatch ? JSON.stringify(workspaceMatch.toLowerCase()) : "''",
    );
  // React 19 blocks href="javascript:..." on any component it renders (XSS
  // hardening). Bookmarklets legitimately need that scheme, so we sidestep
  // React's URL validation by inserting the anchor as raw HTML.
  const escapedHref = `javascript:${encodeURI(src)}`
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
  const bookmarkAnchor = `<a href="${escapedHref}" class="mt-2 inline-block cursor-grab select-none rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 shadow-sm active:cursor-grabbing dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100">Refresh Slack tokens (drag me)</a>`;

  const primaryDisabled = state.kind === "running" || available?.ok === false;

  return (
    <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="font-medium">Slack token refresh</div>
      <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
        Pulls a fresh <code>xoxc</code> from your signed-in Chrome tab and decrypts the
        HttpOnly <code>xoxd</code> cookie from Chrome&apos;s cookie store. One click, both
        tokens, no DevTools.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runRefresh}
          disabled={primaryDisabled}
          className="inline-block rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          {state.kind === "running" ? "Refreshing…" : "Refresh now (local Chrome)"}
        </button>
        {available?.ok === false ? (
          <span className="text-xs text-amber-700 dark:text-amber-300">
            Not available: {available.reason}
          </span>
        ) : null}
      </div>

      {state.kind === "ok" ? (
        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
          ✅ Refreshed. Authenticated as <strong>{state.user}</strong> (team:{" "}
          <strong>{state.team}</strong>). xoxc …{state.xoxcLast4}, xoxd …{state.xoxdLast4}.
        </p>
      ) : null}
      {state.kind === "error" ? (
        <p className="mt-2 text-xs text-red-700 dark:text-red-400">
          ❌ {state.message}
          {state.hint ? (
            <>
              <br />
              <span className="text-neutral-600 dark:text-neutral-400">{state.hint}</span>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="mt-3 border-t border-neutral-200 pt-2 dark:border-neutral-800">
        <button
          type="button"
          onClick={() => setShowFallback((v) => !v)}
          className="text-xs text-neutral-500 underline-offset-2 hover:underline dark:text-neutral-400"
        >
          {showFallback ? "Hide" : "Show"} bookmarklet fallback (remote / different machine)
        </button>
        {showFallback ? (
          <div className="mt-2">
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              Drag this to your bookmarks bar, then click it from any signed-in Slack tab. Only
              refreshes <code>xoxc</code> — <code>xoxd</code> is HttpOnly so the server reuses the
              value already in storage. Paste a fresh <code>xoxd</code> in the field above if that
              one is also stale.
            </p>
            <span dangerouslySetInnerHTML={{ __html: bookmarkAnchor }} />
            <p className="mt-2 text-xs text-neutral-500">
              Matches workspaces whose domain or name contains{" "}
              <code>{workspaceMatch || "(first team)"}</code>.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
