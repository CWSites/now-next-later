import type { Adapter, IngestItem } from "./base";
import { greenhouseAuthMode } from "@/lib/secrets";

/**
 * Greenhouse recruiter-app (session-cookie) adapter.
 *
 * Fallback for users without Harvest API access. Reuses the recruiter's
 * live app*.greenhouse.io session cookie (populated by
 * `scripts/refresh-greenhouse-session.sh` via Settings → Greenhouse →
 * "Refresh session").
 *
 * Only runs when GREENHOUSE_API_KEY is UNSET and
 * GREENHOUSE_SESSION_COOKIE + GREENHOUSE_HOST are set. If both are
 * configured, the Harvest adapter wins — see `greenhouseAuthMode`.
 *
 * Persistence semantics match the Harvest adapter: this adapter never
 * emits `removedExternalIds`. Once a candidate is surfaced, the task stays
 * on the board until the user manually checks it off.
 *
 * Endpoint shape (reverse-engineered from app7.greenhouse.io's Birch UI,
 * confirmed live against a signed-in session):
 *
 *   GET /people?stage_status_id=<active>&hiring_plan_ids[]=<jobId>&per_page=100
 *     → server-side rendered HTML page; candidate rows are embedded as
 *       <table class="person" application="<appId>" person="<candId>"
 *       candidate_hiring_plan="<jobId>">. Inside each row, the candidate
 *       name is the anchor text under p.name and the current stage is the
 *       first text node inside div.status > a.
 *
 *   GET /alljobs  (initial nav HTML)
 *     → embeds the top-nav "Candidates" link with the tenant-specific
 *       "active" stage_status_id as a query param. We discover it here so
 *       the adapter has no hardcoded tenant-specific IDs.
 *
 * All parsing is tolerant of markup drift: if a row's stage can't be
 * extracted, that row is skipped (not thrown). Stage-name match is
 * case-insensitive, same as the Harvest adapter.
 */
export const greenhouseSessionAdapter: Adapter = {
  name: "greenhouse-session",

  enabled() {
    if (greenhouseAuthMode() !== "session") return false;
    return Boolean((process.env.GREENHOUSE_JOB_IDS ?? "").trim());
  },

  disabledReason() {
    if ((process.env.GREENHOUSE_API_KEY ?? "").trim()) {
      return "Harvest API key is configured — the Harvest adapter handles Greenhouse.";
    }
    if (!(process.env.GREENHOUSE_HOST ?? "").trim()) {
      return "Click Settings → Greenhouse → 'Refresh session' to populate the session cookie.";
    }
    if (!(process.env.GREENHOUSE_SESSION_COOKIE ?? "").trim()) {
      return "Session cookie missing. Click 'Refresh session' in Settings.";
    }
    return "Set GREENHOUSE_JOB_IDS in Settings to the job IDs you want to watch.";
  },

  async ingest(): Promise<IngestItem[]> {
    const host = process.env.GREENHOUSE_HOST!.trim();
    const cookie = process.env.GREENHOUSE_SESSION_COOKIE!.trim();
    const jobIds = (process.env.GREENHOUSE_JOB_IDS ?? "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const stageName = (
      process.env.GREENHOUSE_STAGE_NAME ?? "Application Review"
    ).trim();
    const stageNameLc = stageName.toLowerCase();

    // The "active candidates" stage_status_id is a per-tenant number. Discover
    // it once by scraping the top-nav "Candidates" link out of /alljobs. If
    // discovery fails, we fall back to omitting the filter — the result set
    // will include rejected/hired candidates too, so we belt-and-braces by
    // skipping any row whose status area says Rejected/Hired.
    const activeStatusId = await discoverActiveStatusId(host, cookie);

    const items: IngestItem[] = [];
    const seenAppIds = new Set<string>();

    for (const jobId of jobIds) {
      // Each "job id" here is really a hiring_plan_id (what the recruiter UI
      // calls a job in the /alljobs dropdown). hiring_plan can roll up to
      // multiple sub-jobs; we filter back to the entered id below so we
      // don't accidentally surface sibling-job candidates.
      let page = 1;
      while (page <= 20) {
        const rows = await fetchJobPage({
          host,
          cookie,
          jobId,
          activeStatusId,
          page,
        });
        if (rows.length === 0) break;

        for (const row of rows) {
          if (seenAppIds.has(row.applicationId)) continue;
          if (row.stageName.toLowerCase() !== stageNameLc) continue;
          // Only emit rows whose hiring_plan matches the job the user asked
          // for. hiring_plan_ids[]=<X> on Greenhouse's end sometimes returns
          // sibling listings under the same plan; trusting it blindly would
          // cross-contaminate between roles.
          if (row.jobId && row.jobId !== jobId) continue;
          seenAppIds.add(row.applicationId);

          items.push({
            externalId: `greenhouse:application:${row.applicationId}`,
            title: `${row.candidateName}${row.jobTitle ? ` — ${row.jobTitle}` : ""}`,
            bucket: "now",
            sourceRef: `${stageName}${row.jobTitle ? ` \u2014 ${row.jobTitle}` : ""}`,
            url: `https://${host}/people/${row.candidateId}?application_id=${row.applicationId}`,
          });
        }
        // Birch paginates /people. If we got a full page, try the next.
        if (rows.length < 25) break;
        page++;
      }
    }

    return items;
  },
};

interface ParsedRow {
  applicationId: string;
  candidateId: string;
  jobId: string | null;
  candidateName: string;
  jobTitle: string | null;
  stageName: string;
}

interface FetchArgs {
  host: string;
  cookie: string;
  jobId: string;
  activeStatusId: string | null;
  page: number;
}

async function fetchJobPage(args: FetchArgs): Promise<ParsedRow[]> {
  const params = new URLSearchParams();
  params.set("hiring_plan_ids[]", args.jobId);
  if (args.activeStatusId) params.set("stage_status_id", args.activeStatusId);
  params.set("per_page", "100");
  if (args.page > 1) params.set("page", String(args.page));

  const url = `https://${args.host}/people?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      cookie: args.cookie,
      accept: "text/html",
      // Greenhouse's WAF occasionally 403s obvious-bot UAs.
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    redirect: "manual",
  });
  if (res.status === 302 || res.status === 303) {
    throw new Error(
      `greenhouse-session: /people redirected (${res.status}) — session expired. ` +
        `Click 'Refresh session' in Settings → Greenhouse.`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `greenhouse-session: /people?job=${args.jobId} returned ${res.status}`,
    );
  }
  const html = await res.text();
  return parseCandidateRows(html);
}

/**
 * Pull candidate rows out of Birch's /people HTML. Returns only rows that
 * have the structural attributes we rely on — nothing speculative.
 *
 * Row shape (live, 2026-11):
 *   <table class="person"
 *          application="<id>"
 *          person="<id>"
 *          candidate_hiring_plan="<id>">
 *     ...
 *     <p class="name"><a href="/people/<cid>?application_id=<aid>...">Name</a></p>
 *     <p class="job">Job Title</p>
 *     <div class="status"><a ...>Stage Name<span>·</span>...</a></div>
 */
export function parseCandidateRows(html: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  // Match <table class="person" ...> opening tag + body. Attribute order
  // isn't guaranteed by Birch, so we grab the whole opening tag as one
  // blob and pick attributes out of it individually.
  const rowRe =
    /<table class="person"([^>]*)>([\s\S]*?)<\/table>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const [, openTag, body] = m;
    const applicationId = openTag.match(/\bapplication="(\d+)"/)?.[1];
    const candidateId = openTag.match(/\bperson="(\d+)"/)?.[1];
    if (!applicationId || !candidateId) continue;
    const jobId = openTag.match(/\bcandidate_hiring_plan="(\d+)"/)?.[1] ?? null;
    const name = extractName(body);
    if (!name) continue;
    const stage = extractStage(body);
    if (!stage) continue;
    const jobTitle = extractJobTitle(body);
    rows.push({
      applicationId,
      candidateId,
      jobId,
      candidateName: name,
      jobTitle,
      stageName: stage,
    });
  }
  return rows;
}

function extractName(body: string): string | null {
  const m = body.match(
    /<a[^>]+href="\/people\/\d+\?application_id=\d+[^"]*"[^>]*>([^<]+)<\/a>/,
  );
  return m ? decodeHtml(m[1].trim()) : null;
}

function extractJobTitle(body: string): string | null {
  const m = body.match(/<p class="job">\s*([^<]+?)\s*<\/p>/);
  return m ? decodeHtml(m[1].trim()) : null;
}

function extractStage(body: string): string | null {
  // First text node inside div.status > a, up to the separator span or </a>.
  const m = body.match(
    /<div class="status">\s*<a[^>]*>\s*([^<\n]+?)\s*(?:<span|<\/a>)/,
  );
  return m ? decodeHtml(m[1].trim()) : null;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Discover the tenant's "active candidates" stage_status_id by scraping the
 * top-nav from /alljobs. Returns null if we can't find it — callers treat
 * that as "omit the filter and sort it out client-side."
 */
async function discoverActiveStatusId(
  host: string,
  cookie: string,
): Promise<string | null> {
  try {
    const res = await fetch(`https://${host}/alljobs`, {
      headers: {
        cookie,
        accept: "text/html",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      redirect: "manual",
    });
    if (!res.ok) return null;
    const html = await res.text();
    // The top nav embeds something like:
    //   "href":"/people?...stage_status_id=4000005007","text":"Candidates"
    // ...but it lives inside a data-react-props attribute, so in raw HTML
    // every " is &quot; and every & is \u0026. Match either form.
    const m = html.match(
      /stage_status_id(?:=|\\u003d)(\d+)[^"&<]*(?:"|&quot;)\s*,\s*(?:"|&quot;)text(?:"|&quot;)\s*:\s*(?:"|&quot;)Candidates/,
    );
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
