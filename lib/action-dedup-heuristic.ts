import type { IngestItem } from "@/ingest/adapters/base";

/**
 * Heuristic deduplication — free, deterministic, no network calls.
 *
 * Catches the common cases where two action items refer to the same thing
 * with minor rewording:
 *   - Alias expansion: i18n <-> internationalization, PR <-> pull request, etc.
 *   - Action-verb equivalence: "talk to" / "reach out" / "ping" all collapse
 *     to a single marker so verb choice doesn't matter.
 *   - Shared proper nouns: both items mentioning "Ron" get a similarity boost.
 *   - Jaccard on the residual normalized tokens above a threshold.
 *
 * Won't catch fully-synonymous rephrasings with zero token overlap — for
 * those, layer the LLM dedup on top (see action-dedup.ts). This pass runs
 * cheaply on every ingest.
 */

const ALIASES: Record<string, string> = {
  // Internationalization / localization
  i18n: "internationalization",
  intl: "internationalization",
  international: "internationalization",
  l10n: "localization",
  local: "localization",
  // Infra / dev jargon
  k8s: "kubernetes",
  ci: "continuous-integration",
  cd: "continuous-deployment",
  pr: "pull-request",
  cr: "code-review",
  qa: "quality-assurance",
  auth: "authentication",
  authn: "authentication",
  authz: "authorization",
  sso: "single-sign-on",
  db: "database",
  ux: "user-experience",
  ui: "user-interface",
  api: "api",
  sdk: "sdk",
  // Business shorthand
  am: "account-manager",
  cs: "customer-success",
  se: "sales-engineer",
  ae: "account-executive",
  pm: "product-manager",
  eng: "engineering",
  ops: "operations",
  eod: "end-of-day",
  eow: "end-of-week",
  eoq: "end-of-quarter",
};

const STOPWORDS = new Set([
  "a","an","the","and","or","but","of","for","to","in","on","at","from","with","by","as",
  "about","regarding","re","around","concerning","via","into","upon","toward","towards",
  "my","me","i","you","your","we","us","our","they","them","their","he","she","him","her","his","hers",
  "is","am","are","was","were","be","been","being","do","does","did","done","have","has","had",
  "can","could","should","would","will","may","might","must","this","that","these","those","some","any",
  "if","then","than","so","just","also","only","not","no","yes","s",
  // Time / date noise — filtered so calendar-flavored titles don't accumulate
  // meaningless overlap or drift apart from the Granola / morning-brief
  // versions of the same commitment.
  "today","tomorrow","yesterday","tonight","morning","afternoon","evening","night",
  "am","pm","noon","midnight",
  "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
  "mon","tue","tues","wed","thu","thur","thurs","fri","sat","sun",
  "january","february","march","april","may","june","july","august",
  "september","october","november","december",
  "jan","feb","mar","apr","jun","jul","aug","sep","sept","oct","nov","dec",
  "week","weekly","day","daily","month","monthly","hour","minute","min","hr",
  // "prep for X" / "prepare for X" / "warmup for X" collapse to X in the
  // comparison view — preparing to attend a meeting is the same commitment
  // as attending it.
  "prep","prepping","prepare","preparing","prepared","warmup","warm","up",
  // meta-verbs handled below via ACTION_VERBS
]);

const ACTION_VERBS = new Set([
  "talk","talks","talked","talking",
  "reach","reaches","reached","reaching","reachout",
  "ping","pings","pinged","pinging",
  "call","calls","called","calling",
  "sync","syncs","synced","syncing",
  "follow","follows","followed","following","followup","followups",
  "email","emails","emailed","emailing",
  "dm","dms","dmed","dming","message","messages","messaged","messaging",
  "chat","chats","chatted","chatting",
  "ask","asks","asked","asking",
  "meet","meets","met","meeting",
  "discuss","discusses","discussed","discussing",
  "check","checks","checked","checking","checkin","checkins",
  "touch","touched","touching","touchbase",
  "connect","connects","connected","connecting",
  "coordinate","coordinated","coordinating",
  "align","aligns","aligned","aligning",
  "confirm","confirms","confirmed","confirming",
  "verify","verifies","verified","verifying",
  "raise","raised","raising","flag","flagged","flagging",
  "share","shared","sharing",
  "review","reviews","reviewed","reviewing",
]);

const ACTION_MARKER = "__contact__";

/**
 * Strip time/date suffixes commonly appended to calendar titles before we
 * even try to tokenize. Handles patterns like:
 *   "Foo — today 3:00 PM"
 *   "Foo - Fri, Jul 31 3:00 PM"
 *   "Foo (Jul 27)"
 */
function stripDateSuffix(text: string): string {
  return text
    .replace(/\s+[—–-]\s+today\s+\d{1,2}:\d{2}\s*(am|pm)?\s*$/i, "")
    .replace(/\s+[—–-]\s+(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*,?\s+.+?\d{1,2}(:\d{2})?\s*(am|pm)?\s*$/i, "")
    .replace(/\s*\((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(,?\s*\d{4})?\)\s*$/i, "")
    .replace(/\s+\d{1,2}:\d{2}\s*(am|pm)?\s*$/i, "");
}

/** Split into words, expand aliases, drop stopwords, collapse action verbs. */
function normalize(text: string): { tokens: string[]; properNouns: Set<string> } {
  text = stripDateSuffix(text);
  const properNouns = new Set<string>();
  // Grab capitalized single words as candidate proper nouns before lowercasing.
  // We skip words that start a sentence — the second-plus capitalized word in
  // a run, or a lone capitalized word not at position 0.
  const parts = text.split(/([.!?]\s+|\n+)/);
  let atSentenceStart = true;
  for (const part of parts) {
    if (/^[.!?]/.test(part) || /^\n/.test(part)) {
      atSentenceStart = true;
      continue;
    }
    const words = part.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const cleaned = w.replace(/[^A-Za-z0-9]/g, "");
      if (!cleaned) continue;
      const isCap = /^[A-Z][a-z]+$/.test(cleaned);
      if (isCap && !(atSentenceStart && i === 0)) {
        properNouns.add(cleaned.toLowerCase());
      }
      atSentenceStart = false;
    }
  }

  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .flatMap((w) => {
      if (STOPWORDS.has(w)) return [];
      if (ACTION_VERBS.has(w)) return [ACTION_MARKER];
      const alias = ALIASES[w];
      return alias ? [alias] : [w];
    });

  return { tokens, properNouns };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Compute a similarity score in [0, 1] between two titles. Higher is more
 * similar. Combines token Jaccard with a proper-noun boost so items about
 * the same person cluster more aggressively than a bag-of-words comparison
 * alone would suggest.
 */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  const tokenSim = jaccard(new Set(na.tokens), new Set(nb.tokens));
  const nounOverlap = [...na.properNouns].filter((n) => nb.properNouns.has(n));
  const nounBoost = nounOverlap.length > 0 ? 0.15 * nounOverlap.length : 0;
  return Math.min(1, tokenSim + nounBoost);
}

/**
 * Union-find clustering: any pair with similarity >= threshold ends up in
 * the same group. Threshold defaults to 0.5, which is empirically about
 * right — high enough to avoid merging unrelated items on the same topic,
 * low enough to catch aliased rewrites.
 */
export function clusterHeuristically(
  items: IngestItem[],
  threshold = 0.5,
): number[][] {
  const parent = items.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (similarity(items[i].title, items[j].title) >= threshold) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }
  return Array.from(groups.values());
}

/**
 * Dedup pass: cluster items and pick a canonical title for each cluster.
 * "Canonical" = the longest title in the cluster (usually most descriptive).
 */
export function dedupHeuristically(items: IngestItem[]): IngestItem[] {
  if (items.length < 2) return items;
  const clusters = clusterHeuristically(items);
  if (clusters.length === items.length) return items; // no merges

  const out: IngestItem[] = [];
  for (const cluster of clusters) {
    const members = cluster.map((i) => items[i]);
    if (members.length === 1) {
      out.push(members[0]);
      continue;
    }
    const canonical = pickCanonical(members);
    const sources = Array.from(
      new Set(members.map((m) => m.sourceRef).filter((s): s is string => Boolean(s))),
    );
    const externalIds = members
      .map((m) => m.externalId)
      .filter((id): id is string => Boolean(id))
      .sort();
    const mergedExternalId = `merged:${hash(externalIds.join("|"))}`;
    const notes = Array.from(new Set(members.map((m) => m.notes).filter(Boolean))).join("\n\n") || undefined;
    out.push({
      externalId: mergedExternalId,
      title: canonical.title,
      bucket: canonical.bucket,
      sourceRef: sources.length > 1 ? `Merged from ${members.length} notes: ${sources.join(" • ")}` : sources[0],
      notes,
      url: members.find((m) => m.url)?.url,
    });
  }
  return out;
}

/**
 * Choose the best title from a cluster of duplicates. Rules, in order:
 *   1. Prefer items whose title starts with "Prep for" / "Prepare for" /
 *      "Warmup for". Those framings are more actionable than the raw
 *      meeting name, so if the user wrote one, use it.
 *   2. Prefer items that did NOT come from calendar (externalId `gcal:*`).
 *      Calendar titles carry meeting metadata that's noisy on the board.
 *   3. Within the preferred subset, take the longest title (most descriptive).
 */
function pickCanonical(members: IngestItem[]): IngestItem {
  const isPrep = (m: IngestItem) => /^(prep|prepare|prepping|warmup|warm\s*up)\s+for\b/i.test(m.title);
  const isGcal = (m: IngestItem) => (m.externalId ?? "").startsWith("gcal:");

  const prep = members.filter(isPrep);
  if (prep.length > 0) return longest(prep);

  const nonCal = members.filter((m) => !isGcal(m));
  if (nonCal.length > 0) return longest(nonCal);

  return longest(members);
}

function longest(items: IngestItem[]): IngestItem {
  return items.reduce((best, m) => (m.title.length > best.title.length ? m : best));
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
