import type { Adapter, IngestItem } from "./base";

/**
 * Lattice adapter — talks to Lattice's internal GraphQL at
 * app.latticehq.com/graphql using the signed-in user's session cookies.
 *
 * Because Lattice's schema isn't publicly documented, this adapter is
 * *defensive*:
 *
 *   1. First we introspect the top-level Query fields to find something
 *      that looks like a todo/action-item list.
 *   2. Then we call it with a wide-open selection set (id, title/text,
 *      state, dueDate, url, etc.) — GraphQL returns null for fields that
 *      don't exist rather than failing the whole query, but our fallback
 *      logic tries several candidate field names too.
 *   3. Anything that looks open + assigned-to-me becomes a Next task.
 *
 * When Lattice inevitably reshapes their schema, the error surfaces in
 * the "Test connections" panel with a clear message so you know it's
 * time to look at the new query shape.
 */

const CANDIDATE_QUERY_FIELDS = [
  "myTodos",
  "todos",
  "myActionItems",
  "actionItems",
  "myTasks",
  "tasks",
  "myFeedback",
];

interface LatticeTodo {
  id?: string;
  title?: string;
  name?: string;
  text?: string;
  content?: string;
  description?: string;
  status?: string;
  state?: string;
  completed?: boolean;
  isCompleted?: boolean;
  done?: boolean;
  archived?: boolean;
  dueDate?: string;
  dueAt?: string;
  due?: string;
  url?: string;
  permalink?: string;
  webUrl?: string;
  source?: { title?: string; name?: string; type?: string };
  meeting?: { title?: string; name?: string };
  review?: { title?: string; name?: string };
}

async function gql<T>(cookie: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch("https://app.latticehq.com/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      cookie,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Lattice GraphQL HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) {
    throw new Error(`Lattice GraphQL: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (!body.data) throw new Error("Lattice GraphQL returned no data");
  return body.data;
}

async function pickTodoField(cookie: string): Promise<string | null> {
  const data = await gql<{ __schema: { queryType: { fields: Array<{ name: string }> } } }>(
    cookie,
    `{ __schema { queryType { fields { name } } } }`,
  );
  const names = data.__schema.queryType.fields.map((f) => f.name);
  const lower = names.map((n) => n.toLowerCase());
  for (const hint of CANDIDATE_QUERY_FIELDS) {
    const idx = lower.indexOf(hint.toLowerCase());
    if (idx >= 0) return names[idx];
  }
  // Fuzzy: anything with "todo" or "action" in the name.
  const fuzzy = names.find((n) => /todo|action|task/i.test(n));
  return fuzzy ?? null;
}

export const latticeAdapter: Adapter = {
  name: "lattice",

  enabled() {
    return Boolean(process.env.LATTICE_COOKIE);
  },

  disabledReason() {
    return "Use the 'Refresh Lattice session' bookmarklet in Settings.";
  },

  async ingest(): Promise<IngestItem[]> {
    const cookie = process.env.LATTICE_COOKIE!;

    const field = await pickTodoField(cookie);
    if (!field) {
      throw new Error(
        "Lattice schema doesn't expose a recognizable todo/action-item field. Skipping.",
      );
    }

    // Grab everything remotely useful. Fields that don't exist in Lattice's
    // schema will surface as GraphQL errors — if that happens the next
    // ingest run's error message tells us which one to drop.
    const query = `
      query NnlLatticeTodos {
        ${field} {
          id
          title
          name
          text
          content
          description
          status
          state
          completed
          isCompleted
          done
          archived
          dueDate
          dueAt
          due
          url
          permalink
          webUrl
        }
      }
    `;
    let data: { [k: string]: LatticeTodo[] | { items?: LatticeTodo[]; nodes?: LatticeTodo[]; edges?: Array<{ node: LatticeTodo }> } };
    try {
      data = await gql(cookie, query);
    } catch (err) {
      // Retry with a narrower field set if the wide query failed on unknown
      // fields. Titles + IDs are almost universal across GraphQL schemas.
      const narrow = `query NnlLatticeTodos { ${field} { id title name status dueDate url } }`;
      data = await gql(cookie, narrow);
      void err;
    }

    const raw = data[field];
    const list: LatticeTodo[] = Array.isArray(raw)
      ? raw
      : (raw?.items ?? raw?.nodes ?? raw?.edges?.map((e) => e.node) ?? []);

    const items: IngestItem[] = [];
    for (const t of list) {
      const done =
        t.completed ??
        t.isCompleted ??
        t.done ??
        (t.status ? /complete|done|closed/i.test(t.status) : undefined) ??
        (t.state ? /complete|done|closed/i.test(t.state) : undefined);
      if (done) continue;
      if (t.archived) continue;

      const id = t.id;
      if (!id) continue;

      const title = (t.title ?? t.name ?? t.text ?? t.content ?? t.description ?? "").trim();
      if (!title) continue;

      const context =
        t.source?.title ?? t.source?.name ?? t.meeting?.title ?? t.meeting?.name ?? t.review?.title ?? t.review?.name;
      const due = t.dueDate ?? t.dueAt ?? t.due;
      const dueStr = due
        ? ` (due ${new Date(due).toLocaleDateString([], { month: "short", day: "numeric" })})`
        : "";
      const sourceRef = context
        ? `From Lattice: ${context}${dueStr}.`
        : `From Lattice${dueStr}.`;

      items.push({
        externalId: `lattice:${id}`,
        title,
        bucket: "next",
        sourceRef,
        url: t.url ?? t.permalink ?? t.webUrl,
      });
    }

    return items;
  },
};
