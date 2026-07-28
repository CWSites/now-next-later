"use client";

/**
 * Generates a draggable bookmarklet the user can drop onto their bookmarks
 * bar. When clicked from any your workspace's Slack tab, it extracts the fresh
 * xoxc/xoxd pair and POSTs them to /api/settings/slack/import on this app.
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
  const dc=(document.cookie.split('; ').find(c=>c.startsWith('d='))||'').slice(2);
  if(!dc){alert('No d cookie found on this page. Are you signed in?');return;}
  const res=await fetch('%%APP_ORIGIN%%/api/settings/slack/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({xoxc:team.token,xoxd:decodeURIComponent(dc),workspace:team.domain||team.name})});
  const data=await res.json();
  if(res.ok){alert('\u2705 Slack tokens saved. Authenticated as '+data.user+' (team: '+data.team+').');}
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
        Slack rotates <code>xoxc</code>/<code>xoxd</code> tokens frequently. Drag the button below to
        your bookmarks bar. Whenever you&apos;re signed into your workspace's Slack and connection tests fail,
        just click the bookmarklet from any Slack tab &mdash; it grabs the fresh tokens and saves them
        here in one click.
      </p>
      <span dangerouslySetInnerHTML={{ __html: bookmarkAnchor }} />
      <p className="mt-2 text-xs text-neutral-500">
        Matches workspaces whose domain or name contains{" "}
        <code>{workspaceMatch || "(first team)"}</code>.
      </p>
    </div>
  );
}
