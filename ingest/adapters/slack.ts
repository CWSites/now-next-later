import type { Adapter, IngestItem } from "./base";

/**
 * Slack adapter using the Web API with browser session tokens.
 *
 * Uses the same xoxc/xoxd pair that slack-mcp-server uses — xoxc as the
 * bearer token, xoxd as the `d` cookie. This works against public Web API
 * endpoints (users.conversations, conversations.history, users.info,
 * auth.test) without needing a full Slack App install.
 *
 * v1 surface:
 *   - DMs with unread messages → one task per DM, bucket = "now"
 *   - Group DMs (mpim) with unreads → same treatment
 *
 * We intentionally emit one task per conversation (not per message) and key
 * on the channel id, so re-ingesting an unread DM upserts the existing task
 * instead of creating a new one every time a new message arrives.
 */

interface SlackChannel {
  id: string;
  is_im?: boolean;
  is_mpim?: boolean;
  user?: string; // for IMs
  name?: string; // for MPIMs
  unread_count_display?: number;
  unread_count?: number;
  last_read?: string;
  latest?: { ts?: string; text?: string };
}

interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  profile?: { display_name?: string; real_name?: string };
}

async function slackGet<T>(
  method: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const xoxc = process.env.SLACK_MCP_XOXC_TOKEN!;
  const xoxd = process.env.SLACK_MCP_XOXD_TOKEN!;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const url = `https://slack.com/api/${method}?${qs.toString()}`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${xoxc}`,
      // Slack rejects the `d` cookie when its `+ / =` characters are sent
      // raw in the Cookie header — must be URL-encoded, matching how
      // browsers transmit cookies with special characters.
      cookie: `d=${encodeURIComponent(xoxd)}`,
      accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Slack ${method} HTTP ${res.status}`);
  }
  const data = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!data.ok) {
    throw new Error(`Slack ${method} error: ${data.error ?? "unknown"}`);
  }
  return data;
}

export const slackAdapter: Adapter = {
  name: "slack",

  enabled() {
    return Boolean(process.env.SLACK_MCP_XOXC_TOKEN && process.env.SLACK_MCP_XOXD_TOKEN);
  },

  disabledReason() {
    return "Set SLACK_MCP_XOXC_TOKEN and SLACK_MCP_XOXD_TOKEN in .env.local";
  },

  async ingest(): Promise<IngestItem[]> {
    // 1) team info for permalinks
    const authTest = await slackGet<{ team_id: string; url: string }>("auth.test", {});
    const teamId = authTest.team_id;
    const teamUrl = authTest.url.replace(/\/+$/, ""); // e.g. https://example.slack.com

    // 2) list DMs and group DMs
    const convs = await slackGet<{ channels: SlackChannel[] }>("users.conversations", {
      types: "im,mpim",
      limit: 200,
      exclude_archived: "true",
    });

    const withUnreads = convs.channels.filter(
      (c) => (c.unread_count_display ?? c.unread_count ?? 0) > 0,
    );
    if (withUnreads.length === 0) return [];

    // 3) resolve user display names for IMs (batch by unique user id)
    const userIds = Array.from(
      new Set(withUnreads.filter((c) => c.is_im && c.user).map((c) => c.user!)),
    );
    const userCache = new Map<string, SlackUser>();
    await Promise.all(
      userIds.map(async (id) => {
        try {
          const info = await slackGet<{ user: SlackUser }>("users.info", { user: id });
          userCache.set(id, info.user);
        } catch {
          // ignore individual user lookup failures — fall back to id
        }
      }),
    );

    function nameFor(userId: string | undefined): string {
      if (!userId) return "unknown";
      const u = userCache.get(userId);
      const display = u?.profile?.display_name?.trim();
      if (display) return display;
      const real = u?.profile?.real_name?.trim() ?? u?.real_name?.trim();
      if (real) return real;
      return u?.name ?? userId;
    }

    // 4) build items
    const items: IngestItem[] = withUnreads.map((c) => {
      const unread = c.unread_count_display ?? c.unread_count ?? 0;
      const isMpim = Boolean(c.is_mpim);
      const label = isMpim
        ? `group DM (${c.name ?? c.id})`
        : `@${nameFor(c.user)}`;
      const suffix = unread > 1 ? ` (${unread} unread)` : "";
      const latestTs = c.latest?.ts;
      const permalink = latestTs
        ? `${teamUrl}/archives/${c.id}/p${latestTs.replace(".", "")}`
        : `slack://channel?team=${teamId}&id=${c.id}`;

      return {
        externalId: `slack:im:${c.id}`,
        title: `Reply to ${label} in Slack${suffix}`,
        bucket: "now",
        sourceRef: `In Slack DM with ${label}${suffix}`,
        url: permalink,
      };
    });

    return items;
  },
};
