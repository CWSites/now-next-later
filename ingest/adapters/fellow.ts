import type { Adapter, IngestItem } from "./base";
import { McpSession } from "@/lib/mcp-client";
import { FELLOW_MCP_URL, refreshAccessToken } from "@/lib/fellow-oauth";

/**
 * Fellow adapter — talks to Fellow's hosted MCP server at fellow.app/mcp.
 *
 * Auth is OAuth 2.0 with dynamic client registration + PKCE (see
 * app/api/settings/fellow/*). On each ingest we exchange the stored
 * refresh token for a short-lived access token, then open an MCP HTTP
 * session and call the "list action items" tool.
 *
 * Tool names on Fellow's server aren't documented publicly, so we
 * discover them at runtime via listTools() and pick the first tool
 * whose name looks like it lists action items. This is defensive on
 * purpose — if Fellow renames the tool we degrade gracefully instead
 * of blowing up.
 */

interface FellowActionItem {
  id?: string;
  uuid?: string;
  text?: string;
  title?: string;
  description?: string;
  content?: string;
  completed?: boolean;
  is_completed?: boolean;
  isCompleted?: boolean;
  done?: boolean;
  archived?: boolean;
  is_archived?: boolean;
  due_date?: string;
  dueDate?: string;
  due_at?: string;
  url?: string;
  web_url?: string;
  webUrl?: string;
  permalink?: string;
  assignee?: { id?: string; email?: string; self?: boolean };
  assignees?: Array<{ id?: string; email?: string; self?: boolean }>;
  meeting?: { title?: string; name?: string; id?: string };
  note?: { title?: string; name?: string; id?: string };
  stream?: { title?: string; name?: string; id?: string };
}

const ACTION_ITEM_TOOL_HINTS = [
  "get_action_items",
  "getActionItems",
  "list_action_items",
  "list-action-items",
  "listActionItems",
  "action_items",
  "action-items",
  "actionitems",
];

export const fellowAdapter: Adapter = {
  name: "fellow",

  enabled() {
    return Boolean(process.env.FELLOW_CLIENT_ID && process.env.FELLOW_REFRESH_TOKEN);
  },

  disabledReason() {
    return "Click 'Connect Fellow' in Settings to authorize.";
  },

  async ingest(): Promise<IngestItem[]> {
    const clientId = process.env.FELLOW_CLIENT_ID!;
    const refreshToken = process.env.FELLOW_REFRESH_TOKEN!;
    const accessToken = await refreshAccessToken(refreshToken, clientId);

    const session = await McpSession.open("fellow", {
      kind: "http",
      url: FELLOW_MCP_URL,
      bearerToken: accessToken,
    });

    try {
      const tools = await session.listTools();

      // Find the tool that lists action items. Prefer exact-name hints,
      // then any tool whose name contains "action" and "item".
      const lower = tools.map((t) => t.toLowerCase());
      let toolName: string | undefined;
      for (const hint of ACTION_ITEM_TOOL_HINTS) {
        const idx = lower.indexOf(hint);
        if (idx >= 0) {
          toolName = tools[idx];
          break;
        }
      }
      if (!toolName) {
        const fuzzy = tools.findIndex((t) => {
          const l = t.toLowerCase();
          return l.includes("action") && (l.includes("item") || l.includes("list"));
        });
        if (fuzzy >= 0) toolName = tools[fuzzy];
      }
      if (!toolName) {
        throw new Error(
          `Fellow MCP exposed no action-items tool. Available tools: ${tools.join(", ")}`,
        );
      }

      // Fellow's `get_action_items` MCP tool rejects unknown keyword args
      // (assignee/completed/limit), so we call it with no arguments and
      // filter client-side below. If a future version of the schema
      // accepts filters, we can conditionally pass them based on the tool's
      // inputSchema.
      const result = await session.callTool<
        | { action_items?: FellowActionItem[]; items?: FellowActionItem[]; data?: FellowActionItem[] }
        | FellowActionItem[]
      >(toolName, {});

      const items: FellowActionItem[] = Array.isArray(result)
        ? result
        : (result.action_items ?? result.items ?? result.data ?? []);

      const out: IngestItem[] = [];
      for (const it of items) {
        const done = it.completed ?? it.is_completed ?? it.isCompleted ?? it.done;
        const archived = it.archived ?? it.is_archived;
        if (done || archived) continue;

        const id = it.id ?? it.uuid;
        if (!id) continue;

        const title = (it.text ?? it.title ?? it.description ?? it.content ?? "").trim();
        if (!title) continue;

        const meetingTitle =
          it.meeting?.title ?? it.meeting?.name ?? it.note?.title ?? it.note?.name ?? it.stream?.title ?? it.stream?.name;
        const due = it.due_date ?? it.dueDate ?? it.due_at;
        const dueStr = due
          ? ` (due ${new Date(due).toLocaleDateString([], { month: "short", day: "numeric" })})`
          : "";
        const sourceRef = meetingTitle
          ? `From Fellow: ${meetingTitle}${dueStr}.`
          : `From Fellow${dueStr}.`;

        out.push({
          externalId: `fellow:action:${id}`,
          title,
          bucket: "next",
          sourceRef,
          url: it.url ?? it.web_url ?? it.webUrl ?? it.permalink,
        });
      }

      return out;
    } finally {
      await session.close();
    }
  },
};
