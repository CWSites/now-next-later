import type { Priority, Task } from "./types";

/**
 * Priority auto-assignment. Deterministic, local, zero network.
 *
 * Uses the same richer task metadata that the existing bucket-grouping
 * logic consumes (source, sourceRef, url) rather than title keywords
 * alone — so a card like "Six Pager - Swarmia/Jellyfish/Coderabbit"
 * (no literal "metrics" / "DORA" in the title) still lands in
 * Engineering Metrics via the Swarmia / Jellyfish vendor hits, and a
 * Jira ticket keyed HIRE-123 lands in Hiring via the project prefix.
 *
 * Signals scanned, in order of weight:
 *   - Jira project key prefix in sourceRef (e.g. "HIRE-123" → hiring)
 *     → 5 pts (strongest; project keys are curated by humans and rarely
 *     collide across priorities)
 *   - URL hostname match (jobs.ashbyhq.com → hiring) → 4 pts
 *   - Title / sourceRef keyword hit → 3 pts
 *   - Notes keyword hit → 1 pt
 *
 * The priority with the highest total wins (threshold = 3, so a single
 * title hit is enough). Retired priorities are skipped.
 *
 * Keyword / signal sources per priority:
 *   1. Built-in keyword table (phrases, product names, vendors) tuned
 *      for low false-positive rate.
 *   2. Built-in Jira project key prefixes.
 *   3. Built-in URL hostname fragments.
 *   4. For any priority, the label's own words (>= 4 chars) are added
 *      as fuzzy keywords, so renaming "Engineering Metrics" to
 *      "Platform Reliability" immediately catches "platform" /
 *      "reliability" with no further configuration.
 *
 * Call sites:
 *   - POST /api/tasks (new task) — only when the caller didn't set
 *     priorityId explicitly
 *   - POST /api/priorities/auto-assign (backfill / re-score sweep)
 */

const MIN_SCORE = 3;

// Keywords tuned for low false-positive rate — prefer multi-word phrases
// and distinctive single terms over generic words. Matched as case-
// insensitive word-boundary regex (\b{term}\b).
const BUILT_IN_KEYWORDS: Record<string, string[]> = {
  hiring: [
    "hire",
    "hiring",
    "interview",
    "candidate",
    "candidates",
    "recruit",
    "recruiter",
    "recruiting",
    "offer letter",
    "onsite",
    "resume",
    "cv",
    "scorecard",
    "headcount",
    "req",
    "panel",
    "debrief",
    "sourcing",
    "takehome",
    "take-home",
    "loop",
    "interviewer",
    "backchannel",
    "pepperhire",
    // ATS / sourcing vendors — common in Jira links, Lattice goals,
    // calendar event titles.
    "greenhouse",
    "lever",
    "ashby",
    "gem",
    "rippling",
    "workable",
    "hackerrank",
    "codesignal",
    "karat",
  ],
  "squad-support": [
    "1:1",
    "1-1",
    "one-on-one",
    "one on one",
    "standup",
    "stand-up",
    "retro",
    "retrospective",
    "squad",
    "unblock",
    "blocker",
    "mentor",
    "mentoring",
    "coaching",
    "coach",
    "feedback",
    "code review",
    "performance review",
    "career",
    "skip-level",
    "skip level",
    "review cycle",
    "peer feedback",
    "pairing",
    "pair session",
    "demo",
    // Direct-report / project-support work. "report" alone is too
    // generic (collides with dashboards, metrics reports, bug reports),
    // so we require the "direct report(s)" phrasing. Project discussion /
    // project sync / project review are distinctive enough on their own.
    "direct report",
    "direct reports",
    "project discussion",
    "project sync",
    "project review",
    "project kickoff",
    "project update",
    "team meeting",
    "team sync",
    "team offsite",
    "team lunch",
    "IC growth",
    "growth plan",
    "development plan",
  ],
  "team-topology": [
    "topology",
    "org chart",
    "org design",
    "reorg",
    "re-org",
    "re org",
    "charter",
    "team charter",
    "team structure",
    "team split",
    "team merge",
    "boundaries",
    "ownership",
    "ownership map",
    "domain boundaries",
    "squad structure",
    "pod structure",
    "staffing plan",
    "allocation",
  ],
  internationalization: [
    "i18n",
    "internationalization",
    "internationalisation",
    "localization",
    "localisation",
    "l10n",
    "translation",
    "translations",
    "locale",
    "locales",
    "language",
    "languages",
    "multi-language",
    "multilingual",
    "currency",
    "currencies",
    "timezone",
    "time zone",
    "right-to-left",
    "rtl",
    "unicode",
    "intl",
    // Geographic signals — any mention of Europe / EU markets or the
    // broader EMEA region implies an internationalization angle for a
    // US-headquartered product. Specific European countries are strong
    // enough on their own to pass the single-hit threshold.
    "europe",
    "european",
    "EU",
    "EMEA",
    "UK",
    "germany",
    "france",
    "spain",
    "italy",
    "netherlands",
    "nordics",
    "dach",
    "benelux",
    "GDPR",
    "data residency",
    "data resident",
  ],
  "engineering-metrics": [
    "metrics",
    "dora",
    "deploy frequency",
    "deployment frequency",
    "lead time",
    "mttr",
    "cfr",
    "change failure rate",
    "dashboard",
    "kpi",
    "throughput",
    "cycle time",
    "velocity",
    "space framework",
    "space metrics",
    "flow metrics",
    "wip",
    "p95",
    "p99",
    "slo",
    "sli",
    // Engineering intelligence / productivity vendors — strong signal:
    // if a card mentions Swarmia or Jellyfish by name it's almost
    // certainly engineering-metrics work.
    "swarmia",
    "jellyfish",
    "linearb",
    "faros",
    "getdx",
    "haystack",
    "coderabbit",
    "code climate",
    "codeclimate",
    "sleuth",
    "waydev",
    "pluralsight flow",
    "gitprime",
    "allstacks",
  ],
};

/**
 * Jira project key prefixes (uppercase, without the trailing dash). A
 * sourceRef that contains "HIRE-123" or "I18N-45" is a very strong
 * signal — project keys are set up intentionally and rarely overlap
 * across priority areas.
 */
const BUILT_IN_JIRA_KEYS: Record<string, string[]> = {
  hiring: ["HIRE", "HIRING", "TA", "RECRUIT"],
  "squad-support": [],
  "team-topology": ["ORG", "TOPO"],
  internationalization: ["I18N", "L10N", "INTL"],
  "engineering-metrics": ["METRICS", "DORA", "EM"],
};

/**
 * URL hostname substrings. Matched case-insensitively against the
 * task's url field. Keep these distinctive enough that a casual mention
 * (e.g. a link to a vendor's blog post) doesn't trigger a false hit on
 * an unrelated card — most entries here are product consoles, not
 * marketing sites.
 */
const BUILT_IN_URL_HOSTS: Record<string, string[]> = {
  hiring: [
    "greenhouse.io",
    "ashbyhq.com",
    "lever.co",
    "gem.com",
    "workable.com",
    "hackerrank.com",
    "codesignal.com",
    "karat.com",
  ],
  "squad-support": [
    // Lattice 1:1 / review surfaces — common for Squad Support work.
    "latticehq.com",
    "lattice.com",
  ],
  "team-topology": [],
  internationalization: [
    "lokalise.com",
    "phrase.com",
    "crowdin.com",
    "transifex.com",
  ],
  "engineering-metrics": [
    "swarmia.com",
    "jellyfish.co",
    "linearb.io",
    "faros.ai",
    "getdx.com",
    "haystack.sh",
    "coderabbit.ai",
    "sleuth.io",
  ],
};

export interface AssignmentResult {
  priorityId: string;
  score: number;
  /** Terms / signals that fired, for debugging / explainability. Each
   *  entry is either a keyword, "host:<fragment>", or "jira:<KEY>". */
  evidence: string[];
}

/**
 * Pure scoring function. Returns null when nothing crosses MIN_SCORE.
 * `priorities` is the live list — retired priorities are skipped so
 * they can't win and newly-added ones participate immediately.
 */
export function suggestPriority(
  task: Pick<Task, "title" | "notes" | "sourceRef" | "url" | "source">,
  priorities: Priority[],
): AssignmentResult | null {
  const title = (task.title ?? "").toLowerCase();
  const sourceRef = (task.sourceRef ?? "").toLowerCase();
  const notes = (task.notes ?? "").toLowerCase();
  // Treat sourceRef with the same weight as title — it carries the
  // human-visible origin blurb (e.g. "In Jira HIRE-123") which is a
  // strong signal.
  const strongText = `${title}\n${sourceRef}`;
  const host = extractHost(task.url);
  const jiraKeysInRef = extractJiraKeys(task.sourceRef ?? "");

  let best: AssignmentResult | null = null;

  for (const p of priorities) {
    if (p.retired) continue;

    let score = 0;
    const evidence: string[] = [];

    // (1) Jira project key — strongest signal.
    const jiraKeys = BUILT_IN_JIRA_KEYS[p.id] ?? [];
    for (const key of jiraKeys) {
      if (jiraKeysInRef.includes(key)) {
        score += 5;
        evidence.push(`jira:${key}`);
      }
    }

    // (2) URL hostname.
    const hosts = BUILT_IN_URL_HOSTS[p.id] ?? [];
    if (host) {
      for (const h of hosts) {
        if (host === h || host.endsWith(`.${h}`) || host.includes(h)) {
          score += 4;
          evidence.push(`host:${h}`);
          break; // one hostname can't double-count for the same priority
        }
      }
    }

    // (3) Keyword hits — title/sourceRef and notes.
    for (const kw of keywordsFor(p)) {
      const re = buildKeywordRegex(kw);
      if (re.test(strongText)) {
        score += 3;
        evidence.push(kw);
      } else if (notes && re.test(notes)) {
        score += 1;
        evidence.push(kw);
      }
    }

    if (score >= MIN_SCORE && (!best || score > best.score)) {
      best = { priorityId: p.id, score, evidence };
    }
  }

  return best;
}

/**
 * Union of built-in keywords (if any) and label-derived words. Label
 * words >= 4 chars catch user-renamed priorities ("Platform
 * Reliability" picks up "platform" + "reliability") without any
 * further configuration.
 */
function keywordsFor(p: Priority): string[] {
  const builtIn = BUILT_IN_KEYWORDS[p.id] ?? [];
  const fromLabel = p.label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const kw of [...builtIn, ...fromLabel]) {
    if (!seen.has(kw)) {
      seen.add(kw);
      out.push(kw);
    }
  }
  return out;
}

/**
 * Build a case-insensitive matcher. For keywords made of word chars
 * only, use \b anchors. For keywords containing punctuation / digits
 * (like "1:1", "l10n", "re-org"), fall back to a looser boundary
 * (whitespace or string edge) so the embedded characters aren't
 * treated as word breaks that break the match.
 */
function buildKeywordRegex(kw: string): RegExp {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alnumOnly = /^[a-z0-9]+$/i.test(kw);
  const pattern = alnumOnly ? `\\b${escaped}\\b` : `(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`;
  return new RegExp(pattern, "i");
}

/**
 * Pull out hostname (without protocol / path) from a URL field, lower-
 * cased. Returns null for non-URL / malformed values so hostname
 * matching silently no-ops rather than throwing on bad data.
 */
function extractHost(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Find Jira-style project key prefixes in free text. Matches tokens of
 * the form LETTERS-DIGITS (e.g. HIRE-123) and returns the uppercase
 * letter portion. Duplicates are collapsed so a sourceRef mentioning
 * HIRE-1 and HIRE-2 only contributes once per priority.
 */
function extractJiraKeys(text: string): string[] {
  const matches = text.match(/\b[A-Z][A-Z0-9]{1,10}-\d+\b/g) ?? [];
  const keys = new Set<string>();
  for (const m of matches) {
    const prefix = m.split("-")[0];
    if (prefix) keys.add(prefix);
  }
  return [...keys];
}
