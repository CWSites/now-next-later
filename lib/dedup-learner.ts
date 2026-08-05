import { promises as fs } from "node:fs";
import path from "node:path";
import {
  similarity,
  normalize,
  ALIASES,
  STOPWORDS,
  ACTION_MARKER,
} from "./action-dedup-heuristic";

const DEDUP_THRESHOLD = 0.5;
const MAX_MERGE_LOG = 100;
const MAX_ALIASES = 50;
const MAX_ACTION_VERBS = 50;

export interface ExtractedRule {
  type: "alias" | "actionVerb";
  token: string;
  mapsTo?: string;
}

interface MergeLogEntry {
  mergedAt: string;
  sourceTitle: string;
  targetTitle: string;
  similarityAtMerge: number;
  rulesExtracted: ExtractedRule[];
}

export interface LearnedDedupRules {
  version: 1;
  aliases: Record<string, string>;
  actionVerbs: string[];
  mergeLog: MergeLogEntry[];
}

function rulesPath(): string {
  return path.join(
    process.env.DATA_REPO_PATH ? path.resolve(process.env.DATA_REPO_PATH) : process.cwd(),
    "data",
    "learned-dedup-rules.json",
  );
}

function emptyRules(): LearnedDedupRules {
  return { version: 1, aliases: {}, actionVerbs: [], mergeLog: [] };
}

async function readRules(): Promise<LearnedDedupRules> {
  try {
    const raw = await fs.readFile(rulesPath(), "utf8");
    return JSON.parse(raw) as LearnedDedupRules;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyRules();
    throw err;
  }
}

async function writeRules(rules: LearnedDedupRules): Promise<void> {
  await fs.writeFile(rulesPath(), JSON.stringify(rules, null, 2) + "\n");
}

export function extractRules(sourceTitle: string, targetTitle: string): ExtractedRule[] {
  const srcNorm = normalize(sourceTitle, { skipLearnedRules: true });
  const tgtNorm = normalize(targetTitle, { skipLearnedRules: true });

  const srcSet = new Set(srcNorm.tokens);
  const tgtSet = new Set(tgtNorm.tokens);

  const srcOnly = [...srcSet].filter((t) => !tgtSet.has(t));
  const tgtOnly = [...tgtSet].filter((t) => !srcSet.has(t));

  if (srcOnly.length > 2 || tgtOnly.length > 2) return [];
  if (srcOnly.length === 0 && tgtOnly.length === 0) return [];

  const rules: ExtractedRule[] = [];

  // Action verb gap: one side collapsed to ACTION_MARKER, the other didn't
  if (srcOnly.length === 1 && tgtOnly.length === 1) {
    const [a, b] = [srcOnly[0], tgtOnly[0]];
    if (a === ACTION_MARKER && b !== ACTION_MARKER && !STOPWORDS.has(b) && !ALIASES[b]) {
      rules.push({ type: "actionVerb", token: b });
    } else if (b === ACTION_MARKER && a !== ACTION_MARKER && !STOPWORDS.has(a) && !ALIASES[a]) {
      rules.push({ type: "actionVerb", token: a });
    }
  }

  // Alias gap: both sides have exactly one non-ACTION_MARKER token differing
  if (
    rules.length === 0 &&
    srcOnly.length === 1 &&
    tgtOnly.length === 1 &&
    srcOnly[0] !== ACTION_MARKER &&
    tgtOnly[0] !== ACTION_MARKER
  ) {
    const [shorter, longer] =
      srcOnly[0].length <= tgtOnly[0].length
        ? [srcOnly[0], tgtOnly[0]]
        : [tgtOnly[0], srcOnly[0]];
    if (!ALIASES[shorter] && !ALIASES[longer] && !STOPWORDS.has(shorter) && !STOPWORDS.has(longer)) {
      rules.push({ type: "alias", token: shorter, mapsTo: longer });
    }
  }

  return rules;
}

export async function recordMergeForLearning(
  sourceTitle: string,
  targetTitle: string,
): Promise<void> {
  const score = similarity(sourceTitle, targetTitle);
  const extracted = score < DEDUP_THRESHOLD ? extractRules(sourceTitle, targetTitle) : [];

  const rules = await readRules();

  for (const rule of extracted) {
    if (rule.type === "alias" && rule.mapsTo) {
      if (Object.keys(rules.aliases).length < MAX_ALIASES && !rules.aliases[rule.token]) {
        rules.aliases[rule.token] = rule.mapsTo;
      }
    } else if (rule.type === "actionVerb") {
      if (rules.actionVerbs.length < MAX_ACTION_VERBS && !rules.actionVerbs.includes(rule.token)) {
        rules.actionVerbs.push(rule.token);
      }
    }
  }

  rules.mergeLog.push({
    mergedAt: new Date().toISOString(),
    sourceTitle,
    targetTitle,
    similarityAtMerge: score,
    rulesExtracted: extracted,
  });
  if (rules.mergeLog.length > MAX_MERGE_LOG) {
    rules.mergeLog = rules.mergeLog.slice(-MAX_MERGE_LOG);
  }

  await writeRules(rules);
}
