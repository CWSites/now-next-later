import type { Adapter, IngestItem } from "./base";
import type { Bucket } from "@/lib/types";

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

  async ingest(): Promise<IngestItem[]> {
    const base = process.env.JIRA_URL!.replace(/\/+$/, "");
    const auth = Buffer.from(
      `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`,
    ).toString("base64");

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
    const jql = `assignee = currentUser() AND statusCategory != Done AND (duedate <= endOfMonth() OR status in (${inflightStatuses})) ORDER BY duedate ASC, priority DESC`;
    const url = `${base}/rest/api/3/search/jql`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        jql,
        fields: ["summary", "status", "duedate", "priority", "issuetype"],
        maxResults: 100,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Jira search failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      issues: Array<{
        key: string;
        fields: {
          summary: string;
          status: { name: string; statusCategory?: { key?: string } };
          duedate?: string | null;
          priority?: { name?: string };
          issuetype?: { name?: string };
        };
      }>;
    };

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

    const items: IngestItem[] = data.issues.map((issue) => {
      const bucket = bucketFor(issue.fields.duedate, issue.fields.status?.name ?? "");
      const status = issue.fields.status?.name ?? "";
      const due = issue.fields.duedate ? ` — due ${issue.fields.duedate}` : "";
      return {
        externalId: `jira:${issue.key}`,
        title: `[${issue.key}] ${issue.fields.summary}`,
        bucket,
        sourceRef: `In Jira ${issue.key} (${status})${due}`,
        url: `${base}/browse/${issue.key}`,
      };
    });

    return items;
  },
};
