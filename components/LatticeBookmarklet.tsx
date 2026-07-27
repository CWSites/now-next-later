"use client";

/**
 * Same pattern as SlackBookmarklet: user drags this to their bookmarks
 * bar, then clicks it while on an app.latticehq.com tab. The bookmarklet
 * grabs `document.cookie` (only the cookies visible to JS — HttpOnly
 * ones aren't exposed but Lattice's session cookies typically are) and
 * POSTs the raw string to our /api/settings/lattice/import endpoint.
 */

const BOOKMARKLET_SRC = `(async()=>{try{
  if(!location.host.endsWith('latticehq.com')){alert('Run this from a latticehq.com tab (e.g. your workspace subdomain).');return;}
  const graphqlOrigin=location.origin;
  // Step 1: prove that the browser itself can auth to /graphql. If this
  // works but our server-side call doesn't, cookies are HttpOnly.
  const probe=await fetch(graphqlOrigin+'/graphql',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({query:'query WhoAmI { me { id name email } }'})});
  const probeBody=await probe.json().catch(()=>({}));
  const probeOk=probe.ok && probeBody.data && probeBody.data.me && probeBody.data.me.id;
  if(!probeOk){alert('\u274C Even from inside Lattice this failed: '+probe.status+' '+(probeBody.errors?probeBody.errors[0].message:'no me')+'. You may not be signed in.');return;}
  // Step 2: collect what we could possibly ship server-side. If HttpOnly is on,
  // document.cookie will be missing the important cookies — we detect that below.
  const cookie=document.cookie;
  const storageDump={};
  try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&/token|auth|session|jwt|bearer/i.test(k))storageDump['ls:'+k]=localStorage.getItem(k);}}catch(e){}
  try{for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i);if(k&&/token|auth|session|jwt|bearer/i.test(k))storageDump['ss:'+k]=sessionStorage.getItem(k);}}catch(e){}
  const res=await fetch('%%APP_ORIGIN%%/api/settings/lattice/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cookie,graphqlOrigin,storage:storageDump,probeUser:probeBody.data.me})});
  const data=await res.json();
  if(res.ok){alert('\u2705 Lattice session saved. Authenticated as '+data.user+' at '+graphqlOrigin+'.');}
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
