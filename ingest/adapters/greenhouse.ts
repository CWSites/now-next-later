import type { Adapter, IngestItem } from "./base";

/**
 * Greenhouse Harvest API adapter.
 *
 * Polls applications for each configured job, filters to a specific stage
 * (default: "Application Review"), and emits one task per candidate so
 * the recruiter can see at a glance who's waiting on review.
 *
 * Harvest API base: https://harvest.greenhouse.io/v1/
 * Auth: HTTP Basic with the API key as the username, empty password.
 *   (Greenhouse's "v3" docs portal at harvestdocs.greenhouse.io still
 *   describes this same /v1/ surface — there is no /v3/ in the base URL.)
 *
 * Config (via secrets.local.json / env):
 *   GREENHOUSE_API_KEY     — Harvest API key, required
 *   GREENHOUSE_JOB_IDS     — comma-separated numeric job IDs, required
 *   GREENHOUSE_STAGE_NAME  — stage to watch, defaults to "Application Review"
 *
 * Persistence semantics:
 *   This adapter never returns `removedExternalIds`. Once a candidate is
 *   surfaced, the task stays on the board until the user manually checks
 *   it off — matching the explicit requirement that moving past the watched
 *   stage or being rejected in Greenhouse does NOT automatically clear the
 *   card. See ingest/adapters/base.ts for the opt-in-deletion contract.
 */
export const greenhouseAdapter: Adapter = {
  name: "greenhouse",

  enabled() {
    return Boolean(
      process.env.GREENHOUSE_API_KEY && (process.env.GREENHOUSE_JOB_IDS ?? "").trim(),
    );
  },

  disabledReason() {
    return "Set GREENHOUSE_API_KEY and GREENHOUSE_JOB_IDS in Settings.";
  },

  async ingest(): Promise<IngestItem[]> {
    const apiKey = process.env.GREENHOUSE_API_KEY!;
    const jobIds = (process.env.GREENHOUSE_JOB_IDS ?? "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const stageName = (process.env.GREENHOUSE_STAGE_NAME ?? "Application Review").trim();

    // Basic auth with the API key as the username; empty password.
    // Spec: https://developers.greenhouse.io/harvest.html#authentication
    const auth = Buffer.from(`${apiKey}:`).toString("base64");

    async function get<T>(path: string): Promise<T> {
      const res = await fetch(`https://harvest.greenhouse.io/v1${path}`, {
        headers: {
          authorization: `Basic ${auth}`,
          accept: "application/json",
        },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `Greenhouse ${path} failed: ${res.status} ${body.slice(0, 200)}`,
        );
      }
      return (await res.json()) as T;
    }

    // Cache job metadata so each application can be labeled with the role
    // title without an extra round-trip per candidate.
    const jobs = new Map<number, GreenhouseJob>();
    for (const id of jobIds) {
      try {
        const job = await get<GreenhouseJob>(`/jobs/${id}`);
        jobs.set(job.id, job);
      } catch (err) {
        // A bad job id shouldn't kill the whole run — log context and
        // skip. The ingest run surfaces the adapter error below if every
        // job fails; a single misconfigured id just means we don't pull
        // candidates for that job this round.
        console.warn(`[greenhouse] skipping job ${id}: ${(err as Error).message}`);
      }
    }
    if (jobs.size === 0) {
      throw new Error(
        `No valid Greenhouse jobs resolved from GREENHOUSE_JOB_IDS=${jobIds.join(",")}`,
      );
    }

    // Per-run candidate cache. One ingest can surface the same candidate
    // across multiple jobs (rare but possible) and this avoids a double
    // fetch. Keyed by candidate id.
    const candidates = new Map<number, GreenhouseCandidate>();
    async function getCandidate(id: number): Promise<GreenhouseCandidate | null> {
      const cached = candidates.get(id);
      if (cached) return cached;
      try {
        const c = await get<GreenhouseCandidate>(`/candidates/${id}`);
        candidates.set(id, c);
        return c;
      } catch (err) {
        console.warn(`[greenhouse] candidate ${id} fetch failed: ${(err as Error).message}`);
        return null;
      }
    }

    const items: IngestItem[] = [];
    for (const job of jobs.values()) {
      // active applications only — rejected/hired are terminal and we
      // don't want them showing up on Now even transiently. Paginate just
      // in case (100-per-page cap).
      let page = 1;
      while (true) {
        const apps = await get<GreenhouseApplication[]>(
          `/applications?job_id=${job.id}&status=active&per_page=100&page=${page}`,
        );
        if (apps.length === 0) break;
        for (const app of apps) {
          // Case-insensitive match — human-entered stage names occasionally
          // differ in capitalization between templates.
          if (!app.current_stage) continue;
          if (
            app.current_stage.name.trim().toLowerCase() !== stageName.toLowerCase()
          ) {
            continue;
          }

          // Prefer the embedded candidate payload if present (some Harvest
          // responses include it); fall back to /candidates/<id> so we're
          // robust to schema variance.
          let candidate: GreenhouseCandidate | null = app.candidate ?? null;
          if (!candidate && app.candidate_id) {
            candidate = await getCandidate(app.candidate_id);
          }
          const name = formatName(candidate);
          const displayName = name || `Candidate #${app.candidate_id}`;

          items.push({
            externalId: `greenhouse:application:${app.id}`,
            title: `${displayName} — ${job.name}`,
            bucket: "now",
            sourceRef: `${stageName} \u2014 ${job.name}`,
            // Deep-link into Greenhouse. The people page is the primary
            // surface recruiters recognize; application_id scrolls to the
            // right application when a candidate has several.
            url: `https://app7.greenhouse.io/people/${app.candidate_id}?application_id=${app.id}`,
          });
        }
        if (apps.length < 100) break;
        page++;
        // Safety valve: don't loop forever on a buggy pagination response.
        if (page > 20) break;
      }
    }

    return items;
  },
};

function formatName(c: GreenhouseCandidate | null): string {
  if (!c) return "";
  const first = (c.first_name ?? "").trim();
  const last = (c.last_name ?? "").trim();
  return [first, last].filter(Boolean).join(" ");
}

interface GreenhouseJob {
  id: number;
  name: string;
}

interface GreenhouseCandidate {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
}

interface GreenhouseApplication {
  id: number;
  candidate_id: number;
  candidate?: GreenhouseCandidate | null;
  status: string; // "active" | "rejected" | "hired" | ...
  current_stage: { id: number; name: string } | null;
}
