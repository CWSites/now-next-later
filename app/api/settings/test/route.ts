import { NextResponse } from "next/server";
import { applySecretsToEnv } from "@/lib/secrets";

/**
 * Test that stored credentials actually work — without returning the
 * secrets themselves. Each provider is asked for the identity of the
 * authenticated user, and we return only that public-ish info plus
 * pass/fail.
 */

export interface TestResult {
  name: string;
  configured: boolean;
  ok: boolean;
  identity?: string;
  detail?: string;
  error?: string;
}

async function testJira(): Promise<TestResult> {
  const url = process.env.JIRA_URL;
  const username = process.env.JIRA_USERNAME;
  const token = process.env.JIRA_API_TOKEN;
  if (!url || !username || !token) {
    return {
      name: "jira",
      configured: false,
      ok: false,
      error: "Missing JIRA_URL, JIRA_USERNAME, or JIRA_API_TOKEN.",
    };
  }
  try {
    const base = url.replace(/\/+$/, "");
    const auth = Buffer.from(`${username}:${token}`).toString("base64");
    const res = await fetch(`${base}/rest/api/3/myself`, {
      headers: { authorization: `Basic ${auth}`, accept: "application/json" },
    });
    if (!res.ok) {
      return {
        name: "jira",
        configured: true,
        ok: false,
        error: `HTTP ${res.status} — check username/token.`,
      };
    }
    const me = (await res.json()) as { displayName?: string; emailAddress?: string };
    const identity = me.displayName ?? me.emailAddress ?? "authenticated";
    return {
      name: "jira",
      configured: true,
      ok: true,
      identity,
      detail: me.emailAddress && me.emailAddress !== identity ? me.emailAddress : undefined,
    };
  } catch (err) {
    return {
      name: "jira",
      configured: true,
      ok: false,
      error: (err as Error).message,
    };
  }
}

async function testSlack(): Promise<TestResult> {
  const xoxc = process.env.SLACK_MCP_XOXC_TOKEN;
  const xoxd = process.env.SLACK_MCP_XOXD_TOKEN;
  if (!xoxc || !xoxd) {
    return {
      name: "slack",
      configured: false,
      ok: false,
      error: "Missing SLACK_MCP_XOXC_TOKEN or SLACK_MCP_XOXD_TOKEN.",
    };
  }
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      headers: {
        authorization: `Bearer ${xoxc}`,
        cookie: `d=${xoxd}`,
        accept: "application/json",
      },
    });
    if (!res.ok) {
      return {
        name: "slack",
        configured: true,
        ok: false,
        error: `HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      user?: string;
      team?: string;
      url?: string;
    };
    if (!data.ok) {
      return {
        name: "slack",
        configured: true,
        ok: false,
        error: `Slack: ${data.error ?? "unknown error"}`,
      };
    }
    return {
      name: "slack",
      configured: true,
      ok: true,
      identity: data.user ?? "authenticated",
      detail: data.team ? `team: ${data.team}` : undefined,
    };
  } catch (err) {
    return {
      name: "slack",
      configured: true,
      ok: false,
      error: (err as Error).message,
    };
  }
}

export async function POST() {
  await applySecretsToEnv();
  const results = await Promise.all([testJira(), testSlack()]);
  return NextResponse.json({ results });
}
