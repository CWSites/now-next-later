import type { Adapter, IngestItem } from "./base";

/**
 * Fellow adapter — pulls open action items assigned to the authenticated
 * user and drops them into Next.
 *
 * The Fellow docs (developers.fellow.ai) enumerate:
 *   - List Action Items (POST) with filters
 *   - Retrieve/Mark Complete/Archive per item
 *
 * I don't have public access to the exact request/response schema, so
 * this adapter reads the response defensively: it accepts common casings
 * (snake_case + camelCase), tries a couple of standard filter shapes,
 * and falls back to raw text if a field is missing. Once we can see one
 * real response we can tighten the mapping.
 */

interface FellowActionItem {
  id?: string;
  uuid?: string;
  text?: string;
  title?: string;
  description?: string;
  completed?: boolean;
  is_completed?: boolean;
  isCompleted?: boolean;
  archived?: boolean;
  is_archived?: boolean;
  due_date?: string;
  dueDate?: string;
  url?: string;
  web_url?: string;
  webUrl?: string;
  assignee?: { id?: string; email?: string; is_self?: boolean; isSelf?: boolean };
  assignees?: Array<{ id?: string; email?: string; is_self?: boolean; isSelf?: boolean }>;
  meeting?: { title?: string; name?: string; id?: string };
  note?: { title?: string; name?: string; id?: string };
}

export const fellowAdapter: Adapter = {
  name: "fellow",

  enabled() {
    return Boolean(process.env.FELLOW_API_KEY && process.env.FELLOW_API_BASE_URL);
  },

  disabledReason() {
    return "Set FELLOW_API_KEY and FELLOW_API_BASE_URL in Settings.";
  },

  async ingest(): Promise<IngestItem[]> {
    const base = process.env.FELLOW_API_BASE_URL!.replace(/\/+$/, "");
    const token = process.env.FELLOW_API_KEY!;

    // Fellow docs list "List Action Items" as POST — presumably with a
    // filter body. We ask for open items assigned to the caller. If Fellow
    // ignores unknown filter keys (common), the worst case is we get all
    // items and filter client-side below.
    const res = await fetch(`${base}/action_items`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        assignee: "me",
        completed: false,
        archived: false,
        limit: 100,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Fellow /action_items failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as {
      data?: FellowActionItem[];
      action_items?: FellowActionItem[];
      actionItems?: FellowActionItem[];
      results?: FellowActionItem[];
    };
    const items = data.data ?? data.action_items ?? data.actionItems ?? data.results ?? [];

    const out: IngestItem[] = [];
    for (const it of items) {
      const done = it.completed ?? it.is_completed ?? it.isCompleted;
      const archived = it.archived ?? it.is_archived;
      if (done || archived) continue; // belt + suspenders in case the filter was ignored

      const id = it.id ?? it.uuid;
      if (!id) continue;

      const title = (it.text ?? it.title ?? it.description ?? "").trim();
      if (!title) continue;

      const meetingTitle = it.meeting?.title ?? it.meeting?.name ?? it.note?.title ?? it.note?.name;
      const due = it.due_date ?? it.dueDate;
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
        url: it.url ?? it.web_url ?? it.webUrl,
      });
    }

    return out;
  },
};
