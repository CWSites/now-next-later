import "server-only";
import type { IngestItem } from "@/ingest/adapters/base";

/**
 * Semantic dedup for extracted action items.
 *
 * String similarity (Jaccard, Levenshtein) can't tell that "Talk to Ron about
 * internationalization vendor options" and "Reach out to Ron regarding i18n
 * & l10n" refer to the same commitment — they share almost no tokens. So we
 * ask an LLM (Anthropic's cheap fast model) to cluster items into duplicate
 * groups, then merge each group into a single task whose sourceRef records
 * the original meetings it came from.
 *
 * If no ANTHROPIC_API_KEY is set, this becomes a pass-through: the caller
 * gets its items back unchanged, no network call, no cost.
 */

const MODEL = process.env.DEDUP_MODEL ?? "claude-3-5-haiku-latest";
const API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface Group {
  ids: number[];
  canonical?: string;
}

export async function dedupSemantically(items: IngestItem[]): Promise<IngestItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return items;
  if (items.length < 2) return items;

  const groups = await clusterWithClaude(items, apiKey);
  if (!groups) return items; // LLM failure — pass through, don't crash ingest.

  return mergeGroups(items, groups);
}

async function clusterWithClaude(items: IngestItem[], apiKey: string): Promise<Group[] | null> {
  // Number the items so the LLM's response is compact + easy to validate.
  const numbered = items.map((it, i) => `${i + 1}. ${it.title}`).join("\n");
  const prompt = `You identify duplicate action items. Two items are duplicates only if they refer to the SAME underlying commitment — even when worded differently, using synonyms, abbreviations (e.g. "i18n" == "internationalization"), or reordered phrasing.

Do NOT merge items that are merely on the same topic or involve the same person; they must be the same task.

Here are ${items.length} action items:

${numbered}

Return ONLY JSON matching this shape, nothing else:
{"groups":[{"ids":[1,3],"canonical":"Short merged title"},{"ids":[2]},{"ids":[4,5],"canonical":"..."}]}

- Every id from 1 to ${items.length} must appear in exactly one group.
- For singleton groups, "canonical" is optional.
- For groups with 2+ items, "canonical" is the clearest merged title — prefer the fullest wording, expand abbreviations.`;

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[dedup] Claude ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";
    // Extract the first JSON object from the response.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { groups?: Group[] };
    if (!Array.isArray(parsed.groups)) return null;

    // Validate: every id 1..N appears exactly once, no strays.
    const seen = new Set<number>();
    for (const g of parsed.groups) {
      if (!Array.isArray(g.ids)) return null;
      for (const id of g.ids) {
        if (id < 1 || id > items.length || !Number.isInteger(id)) return null;
        if (seen.has(id)) return null;
        seen.add(id);
      }
    }
    if (seen.size !== items.length) return null;
    return parsed.groups;
  } catch (err) {
    console.error(`[dedup] error: ${(err as Error).message}`);
    return null;
  }
}

function mergeGroups(items: IngestItem[], groups: Group[]): IngestItem[] {
  const out: IngestItem[] = [];
  for (const g of groups) {
    const members = g.ids.map((id) => items[id - 1]);
    if (members.length === 1) {
      out.push(members[0]);
      continue;
    }
    // Merge: canonical title (LLM-suggested or first member), combined
    // sourceRef, first member's url, deterministic externalId based on
    // sorted member IDs so re-runs merge the same set consistently.
    const canonical = g.canonical?.trim() || members[0].title;
    const sources = Array.from(
      new Set(members.map((m) => m.sourceRef).filter((s): s is string => Boolean(s))),
    );
    const mergedSourceRef = sources.length > 0
      ? `Merged from ${members.length} notes: ${sources.join(" • ")}`
      : undefined;
    const externalIds = members
      .map((m) => m.externalId)
      .filter((id): id is string => Boolean(id))
      .sort();
    const mergedExternalId = `merged:${hash(externalIds.join("|"))}`;
    const notes = Array.from(new Set(members.map((m) => m.notes).filter(Boolean))).join("\n\n") || undefined;

    out.push({
      externalId: mergedExternalId,
      title: canonical,
      bucket: members[0].bucket,
      sourceRef: mergedSourceRef,
      notes,
      url: members.find((m) => m.url)?.url,
    });
  }
  return out;
}

/** Small deterministic hash so identical id sets produce identical externalIds. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
