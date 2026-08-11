"use client";

/**
 * Generates a draggable bookmarklet the user can drop onto their bookmarks
 * bar. When clicked from any of the workspace's Slack tabs, it extracts the
 * fresh xoxc token from localStorage and POSTs it to
 * /api/settings/slack/import on this app. The xoxd cookie is HttpOnly on
 * app.slack.com so JavaScript cannot read it; the user pastes that once via
 * the Slack xoxd cookie field above and the server reuses the stored value.
 */

// The bookmarklet source. Kept as one expression so it survives being
// wrapped in `javascript:` without newlines. The `%%APP_ORIGIN%%` and
// `%%WORKSPACE_MATCH%%` placeholders are substituted at render time so we
// don't hard-code the caller's origin or workspace name.
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

export function SlackBookmarklet({ appOrigin, workspaceMatch }: Props) {
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
  const bookmarkAnchor = `<a href="${escapedHref}" class="mt-2 inline-block cursor-grab select-none rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 shadow-sm active:cursor-grabbing dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100">Refresh Slack tokens</a>`;

  return (
    <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="font-medium">Slack quick-refresh</div>
      <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
        Slack rotates the <code>xoxc</code> token frequently. Drag the button below to your bookmarks
        bar; whenever connection tests start failing, click it from any signed-in Slack tab and it will
        grab the fresh <code>xoxc</code> and save it here.
      </p>
      <span dangerouslySetInnerHTML={{ __html: bookmarkAnchor }} />
      <p className="mt-2 text-xs text-neutral-500">
        Matches workspaces whose domain or name contains{" "}
        <code>{workspaceMatch || "(first team)"}</code>.
      </p>
      <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
        <strong>One-time xoxd setup:</strong> the <code>d</code> cookie is HttpOnly, so the bookmarklet
        cannot read it. In Slack, open DevTools &rarr; Application &rarr; Cookies &rarr;
        <code>https://app.slack.com</code>, copy the value of the <code>d</code> cookie, and paste it
        into the <em>Slack xoxd cookie</em> field above (prefix with <code>xoxd-</code> if it isn&apos;t
        already). <code>xoxd</code> rotates rarely, so you shouldn&apos;t need to redo this often.
      </p>
    </div>
  );
}
