"use client";

/**
 * Same pattern as SlackBookmarklet: user drags this to their bookmarks
 * bar, then clicks it while on an app.latticehq.com tab. The bookmarklet
 * grabs `document.cookie` (only the cookies visible to JS — HttpOnly
 * ones aren't exposed but Lattice's session cookies typically are) and
 * POSTs the raw string to our /api/settings/lattice/import endpoint.
 */

// NOTE: no `//` line comments inside the template. After whitespace is
// collapsed at render time, the bookmarklet becomes a single line and any
// `//` comment inside the source would swallow every remaining statement.
// Use string-template variables and this outer comment block instead.
const BOOKMARKLET_SRC = `(async()=>{try{
  if(!location.host.endsWith('latticehq.com')){alert('Run this from a latticehq.com tab (e.g. your workspace subdomain).');return;}
  const graphqlOrigin=location.origin;
  const gql=async(query)=>{const r=await fetch(graphqlOrigin+'/graphql',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({query})});return{status:r.status,body:await r.json().catch(()=>({}))};};
  const meCandidates=['viewer','me','currentUser','self','user','whoami','currentViewer','currentMember','member'];
  let meField=null,probeUser=null,lastErr='';
  for(const cand of meCandidates){
    const r=await gql('{'+cand+'{id name email}}');
    if(r.body.data&&r.body.data[cand]&&r.body.data[cand].id){meField=cand;probeUser=r.body.data[cand];break;}
    if(r.body.errors&&r.body.errors[0]){
      const msg=r.body.errors[0].message;
      if(!/Cannot query field|Unknown field|Unknown argument|did you mean/i.test(msg)){lastErr=cand+': '+msg;}
      const narrow=await gql('{'+cand+'{id}}');
      if(narrow.body.data&&narrow.body.data[cand]&&narrow.body.data[cand].id){meField=cand;probeUser=narrow.body.data[cand];break;}
    }
  }
  if(!meField){alert('\u274C None of these identity fields exist: '+meCandidates.join(', ')+'.'+(lastErr?'\\n\\nLast error: '+lastErr:'')+'\\n\\nOpen Lattice DevTools \u2192 Network \u2192 pick any request to /graphql \u2192 look at the "operationName" or query \u2192 tell me the real field name.');return;}
  const cookie=document.cookie;
  const res=await fetch('%%APP_ORIGIN%%/api/settings/lattice/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cookie,graphqlOrigin,meField,probeUser})});
  const data=await res.json();
  if(res.ok){alert('\u2705 Lattice session saved. Authenticated as '+data.user+' via '+meField+' at '+graphqlOrigin+'.');}
  else{alert('\u274C '+(data.error||('HTTP '+res.status))+'\\n\\nHint: '+(data.hint||'?'));}
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
