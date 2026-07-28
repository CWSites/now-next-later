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
  const introspection=await gql('{__schema{queryType{fields{name type{name kind ofType{name kind}}}}}}');
  if(!introspection.body.data){alert('\u274C Even from inside Lattice this failed: '+introspection.status+' '+(introspection.body.errors?introspection.body.errors[0].message:'introspection blocked')+'. You may not be signed in.');return;}
  const fields=introspection.body.data.__schema.queryType.fields;
  const meCandidates=['me','viewer','currentUser','self','user','whoami','currentViewer'];
  const meField=meCandidates.map(n=>fields.find(f=>f.name.toLowerCase()===n.toLowerCase())).find(Boolean);
  if(!meField){alert('\u274C No identity field found. Top-level Query fields: '+fields.slice(0,20).map(f=>f.name).join(', ')+'...');return;}
  const probe=await gql('{'+meField.name+'{id name email}}');
  if(!probe.body.data||!probe.body.data[meField.name]||!probe.body.data[meField.name].id){
    const narrow=await gql('{'+meField.name+'{id}}');
    if(!narrow.body.data||!narrow.body.data[meField.name]){alert('\u274C Query '+meField.name+' returned nothing: '+JSON.stringify(probe.body.errors||probe.body).slice(0,200));return;}
    probe.body=narrow.body;
  }
  const probeUser=probe.body.data[meField.name];
  const cookie=document.cookie;
  const res=await fetch('%%APP_ORIGIN%%/api/settings/lattice/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cookie,graphqlOrigin,meField:meField.name,probeUser})});
  const data=await res.json();
  if(res.ok){alert('\u2705 Lattice session saved. Authenticated as '+data.user+' via '+meField.name+' at '+graphqlOrigin+'.');}
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
