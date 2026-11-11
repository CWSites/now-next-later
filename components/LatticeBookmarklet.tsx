"use client";

import { useEffect, useState } from "react";

/**
 * Lattice sync UI.
 *
 * Primary path: a "Refresh now" button that calls
 * /api/settings/lattice/auto-refresh. That endpoint runs
 * `scripts/refresh-lattice-session.sh`, which pulls Lattice's HttpOnly
 * session cookies straight out of Chrome's cookie DB using the macOS
 * Keychain, then replays the same GraphQL query the bookmarklet runs —
 * no bookmarks-bar click required. Items are merged by the same code
 * path the bookmarklet POST handler uses.
 *
 * Fallback: the original draggable `javascript:` bookmarklet. Needed
 * when the Next server isn't on the same Mac as a signed-in Chrome
 * (SSH / remote dev / Chrome quit / Keychain unavailable / non-macOS).
 */

// NOTE: no `//` line comments inside the template below. After whitespace
// is collapsed at render time, the bookmarklet becomes a single line and
// any `//` comment would swallow every remaining statement.
const BOOKMARKLET_SRC = `(async()=>{try{
  if(!location.host.endsWith('latticehq.com')){alert('Run this from a latticehq.com tab.');return;}
  const origin=location.origin;
  const query='query OneOnOnesActionItemsSidebarQuery { viewer { user { entityId name preferredName userActiveOneOnOneRelationshipUsers { entityId name preferredName viewerUserRelationship { oneOnOneMeetings(first: 1) { edges { node { entityId actionItems { entityId completedAt dueDate body createdAt assigneeUser { entityId viewerIsUser name id } id } id } } } id } id } id } id } }';
  const gqlRes=await fetch(origin+'/graphql',{method:'POST',credentials:'include',headers:{'content-type':'application/json; charset=utf-8','x-lattice-deployment':'us-prod-1','x-lattice-is-real-company':'true','x-lattice-market-segment':'smb_high','x-lattice-products':'{"OneOnOnesActionItemsSidebarQuery":"oneOnOnes"}','x-timezone':Intl.DateTimeFormat().resolvedOptions().timeZone||'America/New_York'},body:JSON.stringify({id:'OneOnOnesActionItemsSidebarQuery',query})});
  const gqlBody=await gqlRes.json().catch(()=>({}));
  if(!gqlRes.ok||gqlBody.errors){alert('\u274C Lattice GraphQL failed: '+gqlRes.status+' '+(gqlBody.errors?gqlBody.errors[0].message:'').slice(0,200)+'. Sign in to Lattice again then retry.');return;}
  const who=gqlBody.data&&gqlBody.data.viewer&&gqlBody.data.viewer.user;
  const myEntityId=who&&who.entityId;
  if(!myEntityId){alert('\u274C Could not determine your Lattice user id. Sign in and retry.');return;}
  const rels=(who&&who.userActiveOneOnOneRelationshipUsers)||[];
  const items=[];
  const stripMarkup=s=>String(s||'').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/\\s+/g,' ').trim();
  let totalActs=0,mineActs=0;
  for(const rel of rels){
    const other=rel.preferredName||rel.name||'someone';
    const edges=(rel.viewerUserRelationship&&rel.viewerUserRelationship.oneOnOneMeetings&&rel.viewerUserRelationship.oneOnOneMeetings.edges)||[];
    for(const edge of edges){
      const acts=(edge&&edge.node&&edge.node.actionItems)||[];
      for(const a of acts){
        totalActs++;
        if(a.completedAt) continue;
        if(!a.assigneeUser||a.assigneeUser.entityId!==myEntityId) continue;
        mineActs++;
        const body=stripMarkup(a.body);
        if(!body) continue;
        const dueStr=a.dueDate?' (due '+new Date(a.dueDate).toLocaleDateString([],{month:'short',day:'numeric'})+')':'';
        items.push({externalId:'lattice:action:'+(a.entityId||a.id),title:body,bucket:'next',sourceRef:'From Lattice 1:1 with '+other+dueStr+'.',url:rel.entityId?origin+'/users/'+rel.entityId+'/1-1s':undefined});
      }
    }
  }
  const res=await fetch('%%APP_ORIGIN%%/api/settings/lattice/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items,who:who&&(who.name||who.preferredName)})});
  const data=await res.json();
  if(res.ok){const parts=[];if(data.created)parts.push(data.created+' new');if(data.updated)parts.push(data.updated+' synced');if(data.skipped)parts.push(data.skipped+' merged into existing');if(data.removed)parts.push(data.removed+' removed');alert('\u2705 Lattice sync: '+(parts.length?parts.join(', '):'no changes')+'.\\n\\n'+mineActs+' of '+totalActs+' open items across your 1:1s are assigned to you.');}
  else{alert('\u274C '+(data.error||('HTTP '+res.status)));}
}catch(e){alert('Error: '+e.message);}})();`;

interface Props {
  appOrigin: string;
}

type RefreshState =
  | { kind: "idle" }
  | { kind: "running" }
  | {
      kind: "ok";
      who?: string;
      subdomain?: string;
      created: number;
      updated: number;
      removed: number;
      skipped: number;
      mineActs?: number;
      totalActs?: number;
    }
  | { kind: "error"; message: string; hint?: string | null };

export function LatticeBookmarklet({ appOrigin }: Props) {
  const [state, setState] = useState<RefreshState>({ kind: "idle" });
  const [available, setAvailable] = useState<null | { ok: boolean; reason: string | null }>(null);
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/lattice/auto-refresh", { method: "GET" })
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
      const res = await fetch("/api/settings/lattice/auto-refresh", { method: "POST" });
      const data = (await res.json()) as {
        ok?: boolean;
        who?: string | null;
        subdomain?: string;
        created?: number;
        updated?: number;
        removed?: number;
        skipped?: number;
        stats?: { totalActs: number; mineActs: number };
        error?: string;
        hint?: string | null;
      };
      if (res.ok && data.ok) {
        setState({
          kind: "ok",
          who: data.who ?? undefined,
          subdomain: data.subdomain,
          created: data.created ?? 0,
          updated: data.updated ?? 0,
          removed: data.removed ?? 0,
          skipped: data.skipped ?? 0,
          mineActs: data.stats?.mineActs,
          totalActs: data.stats?.totalActs,
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

  const src = BOOKMARKLET_SRC.replace(/\s+/g, " ").replace(/%%APP_ORIGIN%%/g, appOrigin);
  // React 19 blocks href="javascript:..." on any component it renders (XSS
  // hardening). Bookmarklets legitimately need that scheme, so we sidestep
  // React's URL validation by inserting the anchor as raw HTML.
  const escapedHref = `javascript:${encodeURI(src)}`
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
  const bookmarkAnchor = `<a href="${escapedHref}" class="mt-2 inline-block cursor-grab select-none rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 shadow-sm active:cursor-grabbing dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100">Sync Lattice now (drag me)</a>`;

  const primaryDisabled = state.kind === "running" || available?.ok === false;

  return (
    <div>
      <p className="text-xs text-neutral-600 dark:text-neutral-400">
        Pulls open 1:1 action items from Lattice into <strong>Next</strong>. Primary path reads
        Lattice&apos;s session cookies from your signed-in Chrome tab and replays the same GraphQL
        query the browser uses — no DevTools, no bookmarks bar.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runRefresh}
          disabled={primaryDisabled}
          className="inline-block rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-800"
        >
          {state.kind === "running" ? "Syncing…" : "Sync now (auto-detect browser)"}
        </button>
        {available?.ok === false ? (
          <span className="text-xs text-amber-700 dark:text-amber-300">
            Not available: {available.reason}
          </span>
        ) : null}
      </div>

      {state.kind === "ok" ? (
        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
          ✅ Lattice sync ({state.subdomain}
          {state.who ? `, ${state.who}` : ""}):{" "}
          {[
            state.created ? `${state.created} new` : null,
            state.updated ? `${state.updated} synced` : null,
            state.skipped ? `${state.skipped} merged into existing` : null,
            state.removed ? `${state.removed} removed` : null,
          ]
            .filter(Boolean)
            .join(", ") || "no changes"}
          .
          {typeof state.mineActs === "number" && typeof state.totalActs === "number" ? (
            <>
              {" "}
              {state.mineActs} of {state.totalActs} open items across your 1:1s are assigned to
              you.
            </>
          ) : null}
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
              Drag this to your bookmarks bar, then click it from a signed-in Lattice tab. Runs
              entirely in your browser — no credentials leave the tab.
            </p>
            <span dangerouslySetInnerHTML={{ __html: bookmarkAnchor }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
