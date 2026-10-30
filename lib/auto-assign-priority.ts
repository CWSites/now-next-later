import type { Priority, Task } from "./types";

/**
 * Keyword-based priority auto-assignment. Deterministic, local, zero
 * network — scans title + notes + sourceRef for terms that strongly
 * imply a priority and returns the highest-scoring candidate.
 *
 * Scoring:
 *   - Title / sourceRef hit = 3 pts, notes hit = 1 pt
 *   - Multiple hits accumulate; the priority with the highest score wins
 *   - A single hit is enough to assign (score >= MIN_SCORE below)
 *
 * Keyword sources:
 *   1. Built-in table for the five seeded priority ids (hiring,
 *      squad-support, team-topology, internationalization,
 *      engineering-metrics). Hand-curated to minimize false positives
 *      (e.g. "PR" is NOT in squad-support because it collides with too
 *      much — "code review" / "1:1" / "retro" are specific enough).
 *   2. For any priority (seeded or user-added), the label's own words
 *      (>= 4 chars) are added as fuzzy keywords. So renaming a priority
 *      to "Platform Reliability" automatically catches "platform" and
 *      "reliability" in task titles.
 *
 * Call sites:
 *   - POST /api/tasks (new task) — only when the caller didn't set
 *     priorityId explicitly
 *   - Settings "Backfill priorities" — sweep across unassigned tasks
 */

const MIN_SCORE = 3;

// Keywords tuned for low false-positive rate — prefer multi-word phrases
// and distinctive single terms over generic words. Matched as case-
// insensitive word-boundary regex ( \b{term}\b ).
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
  ],
  "squad-support": [
    "1:1",
    "1-1",
    "one-on-one",
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
  ],
};

export interface AssignmentResult {
  priorityId: string;
  score: number;
  /** Terms that fired, for debugging / explainability. */
  evidence: string[];
}

/**
 * Pure scoring function. Returns null when nothing crosses MIN_SCORE.
 * `priorities` is the live list — retired priorities are skipped so
 * they can't win and newly-added ones participate immediately.
 */
export function suggestPriority(
  task: Pick<Task, "title" | "notes" | "sourceRef">,
  priorities: Priority[],
): AssignmentResult | null {
  const title = (task.title ?? "").toLowerCase();
  const sourceRef = (task.sourceRef ?? "").toLowerCase();
  const notes = (task.notes ?? "").toLowerCase();
  // Treat sourceRef with the same weight as title — it carries the
  // human-visible origin blurb (e.g. "In Jira HIRE-123") which is a
  // strong signal.
  const strongText = `${title}\n${sourceRef}`;

  let best: AssignmentResult | null = null;

  for (const p of priorities) {
    if (p.retired) continue;
    const keywords = keywordsFor(p);
    if (keywords.length === 0) continue;

    let score = 0;
    const evidence: string[] = [];
    for (const kw of keywords) {
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
 * Reliability" picks up "platform" + "reliability") without the user
 * having to configure anything.
 */
function keywordsFor(p: Priority): string[] {
  const builtIn = BUILT_IN_KEYWORDS[p.id] ?? [];
  const fromLabel = p.label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
  // De-dup while preserving order.
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
 * (whitespace or string edge) so the characters inside aren't treated
 * as word breaks that break the match.
 */
function buildKeywordRegex(kw: string): RegExp {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alnumOnly = /^[a-z0-9]+$/i.test(kw);
  const pattern = alnumOnly ? `\\b${escaped}\\b` : `(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`;
  return new RegExp(pattern, "i");
}
