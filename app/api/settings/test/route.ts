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
        // Slack requires the `d` cookie URL-encoded (matches browser behavior).
        cookie: `d=${encodeURIComponent(xoxd)}`,
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

async function testGoogle(): Promise<TestResult> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret) {
    return {
      name: "gcal",
      configured: false,
      ok: false,
      error: "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.",
    };
  }
  if (!refreshToken) {
    return {
      name: "gcal",
      configured: false,
      ok: false,
      error: "Click 'Connect Google Calendar' to grant access.",
    };
  }
  try {
    const { refreshAccessToken } = await import("@/lib/gcal-auth");
    const accessToken = await refreshAccessToken(refreshToken, clientId, clientSecret);
    // Hit the Calendar API itself so we're testing the scope the adapter
    // actually uses (`calendar.readonly`), not `openid`/`profile`.
    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary",
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      return {
        name: "gcal",
        configured: true,
        ok: false,
        error: `calendars/primary HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as { id?: string; summary?: string; timeZone?: string };
    return {
      name: "gcal",
      configured: true,
      ok: true,
      identity: data.id ?? "authenticated",
      detail: data.timeZone,
    };
  } catch (err) {
    return {
      name: "gcal",
      configured: true,
      ok: false,
      error: (err as Error).message.slice(0, 120),
    };
  }
}

async function testGranola(): Promise<TestResult> {
  const token = process.env.GRANOLA_API_KEY;
  if (!token) {
    return {
      name: "granola",
      configured: false,
      ok: false,
      error: "Missing GRANOLA_API_KEY.",
    };
  }
  try {
    // /v1/notes with a 1-item limit is the cheapest call that proves the
    // key works and has the notes scope.
    const res = await fetch("https://public-api.granola.ai/v1/notes?limit=1", {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!res.ok) {
      return {
        name: "granola",
        configured: true,
        ok: false,
        error: `HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      data?: unknown[];
      notes?: unknown[];
      total?: number;
    };
    const count = data.data?.length ?? data.notes?.length ?? 0;
    return {
      name: "granola",
      configured: true,
      ok: true,
      identity: `key valid`,
      detail: `saw ${count} note in first page${data.total ? ` (~${data.total} total)` : ""}`,
    };
  } catch (err) {
    return {
      name: "granola",
      configured: true,
      ok: false,
      error: (err as Error).message.slice(0, 120),
    };
  }
}

export async function POST() {
  await applySecretsToEnv();
  const results = await Promise.all([testJira(), testSlack(), testGoogle(), testGranola()]);
  return NextResponse.json({ results });
}
