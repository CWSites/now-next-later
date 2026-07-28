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
//
// This bookmarklet does the whole sync from inside the Lattice tab because
// Lattice's session cookies are HttpOnly — server-side replay isn't
// possible. Click fetches your open action items from Lattice's own
// GraphQL, then POSTs the extracted item list (not credentials) to the
// app's sync endpoint.
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

export function LatticeBookmarklet({ appOrigin }: Props) {
  const src = BOOKMARKLET_SRC.replace(/\s+/g, " ").replace(/%%APP_ORIGIN%%/g, appOrigin);
  // React 19 blocks href="javascript:..." on any component it renders (XSS
  // hardening). Bookmarklets legitimately need that scheme, so we sidestep
  // React's URL validation by inserting the anchor as raw HTML. We hand-
  // escape everything that goes into the attribute.
  const escapedHref = `javascript:${encodeURI(src)}`
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
  const bookmarkAnchor = `<a href="${escapedHref}" class="mt-2 inline-block cursor-grab select-none rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 shadow-sm active:cursor-grabbing dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100">📎 Sync Lattice now</a>`;

  return (
    <div>
      <p className="text-xs text-neutral-600 dark:text-neutral-400">
        Lattice&apos;s session cookies are HttpOnly, so the app can&apos;t sync them for you in
        the background. Instead: drag the button below to your bookmarks bar, then click it from a
        signed-in Lattice tab whenever you want to pull open 1:1 action items into <strong>Next</strong>.
        Runs entirely in your browser — no credentials leave the tab.
      </p>
      <span dangerouslySetInnerHTML={{ __html: bookmarkAnchor }} />
    </div>
  );
}
