import { similarity } from "@/lib/action-dedup-heuristic";
import type { Task } from "@/lib/types";

/**
 * Sources whose externalId is already globally unique by construction
 * (e.g. a Jira ticket key). Two items from these sources with different
 * externalIds are ALWAYS different tasks, even if the titles look similar.
 * We must not run title-similarity dedup against them or we drop legitimate
 * new tickets (POLARIS-3219 vs POLARIS-3142 both prefixed "Buyer - Preview -").
 */
export const UNIQUE_ID_PREFIXES = ["jira:"];

export function isUniqueIdSource(externalId?: string): boolean {
  if (!externalId) return false;
  return UNIQUE_ID_PREFIXES.some((p) => externalId.startsWith(p));
}

/**
 * Similarity threshold above which an incoming adapter item is considered
 * a duplicate of an existing task. Kept in sync with the Granola dedup.
 */
export const DUP_THRESHOLD = 0.5;

/**
 * Preference: when a semantic match exists in the current task list, we
 * usually skip creating the incoming item to avoid a duplicate. But if the
 * incoming item is clearly "more actionable" (e.g. "Prep for X" beating a
 * bare calendar entry), we skip anyway — the existing task is already the
 * one the user prefers to see. Returns the existing task when the incoming
 * should be suppressed, or null when it should be created.
 *
 * Items from unique-ID sources (see UNIQUE_ID_PREFIXES) are never suppressed
 * by title similarity — their externalId is authoritative.
 */
export function shouldSkipAsDuplicate(
  item: { title: string; externalId?: string },
  existing: Task[],
): Task | null {
  if (isUniqueIdSource(item.externalId)) return null;
  const incomingIsGcal = (item.externalId ?? "").startsWith("gcal:");
  let best: { task: Task; score: number } | null = null;
  for (const t of existing) {
    if (t.externalId === item.externalId) continue; // upsert path handles same-source
    const score = similarity(t.title, item.title);
    if (score < DUP_THRESHOLD) continue;
    if (!best || score > best.score) best = { task: t, score };
  }
  if (!best) return null;
  // Special case: if incoming is a calendar event and the existing task is
  // NOT a calendar event, always skip — the user's manually-worded or
  // Granola-derived task wins over the raw meeting invite.
  const existingIsGcal = (best.task.externalId ?? "").startsWith("gcal:");
  if (incomingIsGcal && !existingIsGcal) return best.task;
  return best.task;
}
