"use client";

/**
 * Same pattern as SlackBookmarklet: user drags this to their bookmarks
 * bar, then clicks it while on an app.latticehq.com tab. The bookmarklet
 * grabs `document.cookie` (only the cookies visible to JS — HttpOnly
 * ones aren't exposed but Lattice's session cookies typically are) and
 * POSTs the raw string to our /api/settings/lattice/import endpoint.
 */

const BOOKMARKLET_SRC = `(async()=>{try{
  if(!location.host.endsWith('latticehq.com')){alert('Run this from an app.latticehq.com tab.');return;}
  const cookie=document.cookie;
  if(!cookie){alert('No cookies visible on this page. Are you signed in?');return;}
  const res=await fetch('%%APP_ORIGIN%%/api/settings/lattice/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cookie})});
  const data=await res.json();
  if(res.ok){alert('\u2705 Lattice session saved. Authenticated as '+data.user+'.');}
  else{alert('\u274C '+(data.error||('HTTP '+res.status)));}
}catch(e){alert('Error: '+e.message);}})();`;

interface Props {
  appOrigin: string;
}

export function LatticeBookmarklet({ appOrigin }: Props) {
  const src = BOOKMARKLET_SRC.replace(/\s+/g, " ").replace(/%%APP_ORIGIN%%/g, appOrigin);
  // React 19 blocks href="javascript:..." on any component it renders (XSS
  // hardening). Bookmarklets legitimately need that scheme, so we sidestep
  // React's URL validation by inserting the anchor as raw HTML. We hand-
  // escape everything that goes into the attribute.
  const escapedHref = `javascript:${encodeURI(src)}`
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
  const bookmarkAnchor = `<a href="${escapedHref}" class="mt-2 inline-block cursor-grab select-none rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 shadow-sm active:cursor-grabbing dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100">📎 Refresh Lattice session</a>`;

  return (
    <div>
      <p className="text-xs text-neutral-600 dark:text-neutral-400">
        Lattice doesn&apos;t offer non-admin API keys, so we borrow your active browser session.
        Drag the button below to your bookmarks bar, then click it from any signed-in{" "}
        <code>app.latticehq.com</code> tab. Sessions rotate every few weeks — re-click to refresh.
      </p>
      <span dangerouslySetInnerHTML={{ __html: bookmarkAnchor }} />
    </div>
  );
}
