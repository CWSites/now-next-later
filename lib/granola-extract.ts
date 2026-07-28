/**
 * Pull action items out of a Granola note's summary_markdown.
 *
 * Granola's convention (confirmed by inspection):
 *   ### Next Steps                (also: "Action Items", "Follow-ups", "TODO(s)", "Todos")
 *   - **Do the thing** (Owner)    optional owner in trailing parens
 *
 *     Optional description on the next indented line.
 *
 *   - **Do another thing**
 *
 * We look for any heading whose text matches the action-y set, then walk
 * top-level bullets until the next heading. Each bullet's first bold run is
 * treated as the task title; anything after it on the same line becomes the
 * detail. The trailing `(Someone)` — if present — is parsed out as the owner.
 */

export interface ExtractedAction {
  title: string;
  detail?: string;
  owner?: string;
  /** Hash-stable-ish key for the item within its note. Used to build externalId. */
  slug: string;
}

const ACTION_HEADINGS = /^(#{1,4})\s*(action\s*items?|next\s*steps?|follow[\s-]?ups?|to[\s-]?dos?|todo)\b/i;
const ANY_HEADING = /^#{1,6}\s+/;
const TOP_BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const BOLD_LEAD = /^\*\*(.+?)\*\*\s*(.*)$/;
const TRAILING_OWNER = /\s*\(([^()]{1,60})\)\s*$/;

export function extractActionItems(markdown: string): ExtractedAction[] {
  const lines = markdown.split(/\r?\n/);
  const out: ExtractedAction[] = [];
  let inActionSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ACTION_HEADINGS.test(line)) {
      inActionSection = true;
      continue;
    }
    // Any other heading closes the current action section.
    if (inActionSection && ANY_HEADING.test(line) && !ACTION_HEADINGS.test(line)) {
      inActionSection = false;
      continue;
    }
    if (!inActionSection) continue;

    const bullet = line.match(TOP_BULLET);
    if (!bullet) continue;
    const rest = bullet[1];

    // Prefer bulleted items whose first content is bold (Granola's format).
    // Fall back to plain-text bullets so we don't miss free-form action lines.
    const bold = rest.match(BOLD_LEAD);
    let rawTitle = bold ? bold[1] : rest;
    let inlineDetail = bold ? bold[2].trim() : "";

    // Some notes put the owner inline as `- **Text** (Owner)`; strip it.
    let owner: string | undefined;
    const ownerMatch = (inlineDetail || rawTitle).match(TRAILING_OWNER);
    if (ownerMatch) {
      owner = ownerMatch[1].trim();
      if (inlineDetail) inlineDetail = inlineDetail.replace(TRAILING_OWNER, "").trim();
      else rawTitle = rawTitle.replace(TRAILING_OWNER, "").trim();
    }

    // Optional indented description on the following non-blank line.
    let bodyDetail = "";
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (!next.trim()) continue;
      if (/^\s{2,}\S/.test(next) && !TOP_BULLET.test(next)) {
        bodyDetail = next.trim();
      }
      break;
    }

    const title = rawTitle.trim().replace(/[.\s]+$/, "");
    if (!title) continue;

    const detail = [inlineDetail, bodyDetail].filter(Boolean).join(" — ") || undefined;

    // Slug: normalize whitespace/case so re-runs on the same note produce
    // the same externalId even if Granola tweaks formatting slightly.
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    if (!slug) continue;

    out.push({ title, detail, owner, slug });
  }

  return out;
}

/**
 * Decide whether an extracted item should be surfaced as a task for a given
 * user. Rule of thumb: keep items assigned to me *or* unassigned; drop items
 * that name someone else. Match is case-insensitive substring on first name.
 */
export function isMine(
  item: ExtractedAction,
  myNames: string[],
): boolean {
  if (!item.owner) return true;
  const lower = item.owner.toLowerCase();
  return myNames.some((n) => n && lower.includes(n.toLowerCase()));
}
