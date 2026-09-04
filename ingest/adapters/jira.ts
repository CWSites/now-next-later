import type { Adapter, AdapterIngestResult, IngestItem } from "./base";
import type { Bucket } from "@/lib/types";
import { getAllTasks } from "@/lib/storage";

/**
 * Jira adapter using the REST API directly.
 *
 * Uses the same credentials that the mcp-atlassian server uses, but we skip
 * the MCP subprocess — REST is simpler, faster, and more predictable for a
 * well-known API. Other adapters (Slack, Lattice) use the MCP client because
 * their REST APIs are messier or private.
 */
export const jiraAdapter: Adapter = {
  name: "jira",

  enabled() {
    return Boolean(
      process.env.JIRA_URL && process.env.JIRA_USERNAME && process.env.JIRA_API_TOKEN,
    );
  },

  disabledReason() {
    return "Set JIRA_URL, JIRA_USERNAME, JIRA_API_TOKEN in .env.local";
  },

  async ingest(): Promise<AdapterIngestResult> {
    const base = process.env.JIRA_URL!.replace(/\/+$/, "");
    const auth = Buffer.from(
      `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`,
    ).toString("base64");
    const searchUrl = `${base}/rest/api/3/search/jql`;
    const commonFields = ["summary", "status", "duedate", "priority", "issuetype"];

    async function search(jql: string): Promise<JiraIssue[]> {
      const res = await fetch(searchUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({ jql, fields: commonFields, maxResults: 100 }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Jira search failed: ${res.status} ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { issues: JiraIssue[] };
      return data.issues;
    }

    // Daily brief semantics: only surface actionable work.
    //  - Anything in-flight (In Progress / In Code Review / Ready for Merge / In Review)
    //  - Anything with a due date this month (regardless of status)
    // Backlog tickets without either signal are excluded so we don't drown
    // the Now/Next/Later board in planning artifacts.
    const inflightStatuses = (process.env.JIRA_INFLIGHT_STATUSES ??
      "In Progress,In Code Review,Code Review,In Review,Ready for Merge,QA")
      .split(",")
      .map((s) => `"${s.trim()}"`)
      .join(",");
    const primaryJql = `assignee = currentUser() AND statusCategory != Done AND issuetype != Epic AND (duedate <= endOfMonth() OR status in (${inflightStatuses})) ORDER BY duedate ASC, priority DESC`;

    const primary = await search(primaryJql);

    // Supplemental refresh: any Jira ticket that lives on the local board
    // but didn't come back from the primary JQL (typically because it flipped
    // to Done, or a status the user has manually excluded from the inflight
    // list) still needs its status refreshed — otherwise a ticket that shipped
    // yesterday shows "In Code Review" forever. Do one extra `key in (...)`
    // query for those keys.
    const primaryKeys = new Set(primary.map((i) => i.key));
    const localTasks = await getAllTasks();
    const orphanKeys = localTasks
      .map((t) => t.externalId ?? "")
      .filter((eid) => eid.startsWith("jira:"))
      .map((eid) => eid.slice("jira:".length))
      .filter((k) => k && !primaryKeys.has(k));

    let supplemental: JiraIssue[] = [];
    if (orphanKeys.length > 0) {
      const keyList = orphanKeys.map((k) => `"${k}"`).join(",");
      supplemental = await search(`key in (${keyList})`);
    }

    const issues = [...primary, ...supplemental];

    const now = new Date();
    const startOfWeek = new Date(now);
    // Monday-based week: shift so Monday is day 0.
    const dow = (now.getDay() + 6) % 7; // 0 = Monday
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(now.getDate() - dow);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(startOfDay.getDate() + 1);

    function bucketFor(due: string | null | undefined, statusName: string): Bucket {
      if (due) {
        const d = new Date(due);
        if (d < endOfDay) return "now";
        if (d < endOfWeek) return "next";
        if (d < endOfMonth) return "later";
        return "later";
      }
      // No due date — infer from status.
      const s = statusName.toLowerCase();
      if (s.includes("in progress") || s.includes("code review") || s.includes("ready for merge")) {
        return "now";
      }
      return "later";
    }

    const items: IngestItem[] = [];
    const removedExternalIds: string[] = [];
    for (const issue of issues) {
      const externalId = `jira:${issue.key}`;
      // Terminal statuses (Done / Closed / Won't Do / Rejected — anything
      // Jira classifies under the "done" status category) get swept off the
      // board. The runner uses allowCompleted:true so previously-marked-
      // complete tasks are removed too, and skips tombstoning so a re-opened
      // ticket comes back on the next sync.
      if (issue.fields.status?.statusCategory?.key === "done") {
        removedExternalIds.push(externalId);
        continue;
      }
      const bucket = bucketFor(issue.fields.duedate, issue.fields.status?.name ?? "");
      const status = issue.fields.status?.name ?? "";
      const due = issue.fields.duedate ? ` — due ${issue.fields.duedate}` : "";
      items.push({
        externalId,
        title: `[${issue.key}] ${issue.fields.summary}`,
        bucket,
        sourceRef: `In Jira ${issue.key} (${status})${due}`,
        url: `${base}/browse/${issue.key}`,
      });
    }

    return { items, removedExternalIds };
  },
};

type JiraIssue = {
  key: string;
  fields: {
    summary: string;
    status: { name: string; statusCategory?: { key?: string } };
    duedate?: string | null;
    priority?: { name?: string };
    issuetype?: { name?: string };
  };
};
