import type { Adapter, AdapterIngestResult, IngestItem } from "./base";

/**
 * Lattice adapter — pulls open action items from your 1:1s.
 *
 * Uses Lattice's own persisted query `OneOnOnesActionItemsSidebarQuery`
 * (captured from their web app's Network tab). Sends it to
 * <workspace>/graphql with the browser session cookies + a small set of
 * `x-lattice-*` headers the app itself sends. Filters items to those
 * where `assigneeUser.viewerIsUser === true` and `completedAt === null`.
 *
 * IMPORTANT: Lattice's JWT (in viewerContext cookie) expires ~1 hour
 * after issue. When ingest starts failing with 401 or "not authenticated"
 * errors, re-click the Lattice bookmarklet on /settings to grab a fresh
 * session. This is unavoidable — Lattice's internal auth wasn't designed
 * for programmatic access.
 */

const ACTION_ITEMS_QUERY = `query OneOnOnesActionItemsSidebarQuery {
  viewer {
    user {
      name
      preferredName
      userActiveOneOnOneRelationshipUsers {
        entityId
        name
        preferredName
        viewerUserRelationship {
          oneOnOneMeetings(first: 1) {
            edges {
              node {
                entityId
                actionItems {
                  entityId
                  completedAt
                  dueDate
                  body
                  createdAt
                  assigneeUser {
                    viewerIsUser
                    entityId
                    name
                    id
                  }
                  id
                }
                id
              }
            }
          }
          id
        }
        id
      }
      id
    }
    id
  }
}`;

interface LatticeActionItem {
  id: string;
  entityId?: string;
  completedAt?: string | null;
  dueDate?: string | null;
  body?: string;
  createdAt?: string;
  assigneeUser?: {
    viewerIsUser?: boolean;
    entityId?: string;
    name?: string;
    id?: string;
  };
}

interface LatticeRelationshipUser {
  entityId?: string;
  name?: string;
  preferredName?: string;
  viewerUserRelationship?: {
    oneOnOneMeetings?: {
      edges?: Array<{
        node?: {
          entityId?: string;
          actionItems?: LatticeActionItem[];
        };
      }>;
    };
  };
}

export const latticeAdapter: Adapter = {
  name: "lattice",

  enabled() {
    return Boolean(process.env.LATTICE_COOKIE);
  },

  disabledReason() {
    return "Use the 'Refresh Lattice session' bookmarklet in Settings.";
  },

  async ingest(): Promise<AdapterIngestResult> {
    const cookie = process.env.LATTICE_COOKIE!;
    const origin = process.env.LATTICE_GRAPHQL_ORIGIN ?? "https://app.latticehq.com";
    const url = `${origin.replace(/\/+$/, "")}/graphql`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        accept: "application/json",
        cookie,
        origin,
        referer: `${origin}/`,
        // Headers Lattice's own app sends. Missing these can silently
        // change what the server returns.
        "x-lattice-deployment": process.env.LATTICE_DEPLOYMENT ?? "us-prod-1",
        "x-lattice-is-real-company": "true",
        "x-lattice-market-segment": "smb_high",
        "x-lattice-products": '{"OneOnOnesActionItemsSidebarQuery":"oneOnOnes"}',
        "x-timezone": process.env.LATTICE_TIMEZONE ?? "America/New_York",
      },
      body: JSON.stringify({
        id: "OneOnOnesActionItemsSidebarQuery",
        query: ACTION_ITEMS_QUERY,
      }),
    });

    if (!res.ok) {
      throw new Error(
        `Lattice GraphQL HTTP ${res.status} — session likely expired; re-click the bookmarklet.`,
      );
    }
    const body = (await res.json()) as {
      data?: {
        viewer?: {
          user?: {
            userActiveOneOnOneRelationshipUsers?: LatticeRelationshipUser[];
          };
        };
      };
      errors?: Array<{ message: string }>;
    };
    if (body.errors?.length) {
      throw new Error(`Lattice GraphQL: ${body.errors.map((e) => e.message).join("; ")}`);
    }

    const relationships =
      body.data?.viewer?.user?.userActiveOneOnOneRelationshipUsers ?? [];

    const items: IngestItem[] = [];
    for (const rel of relationships) {
      const otherName = rel.preferredName || rel.name || "someone";
      const meeting = rel.viewerUserRelationship?.oneOnOneMeetings?.edges?.[0]?.node;
      const actions = meeting?.actionItems ?? [];
      for (const a of actions) {
        if (a.completedAt) continue;
        if (!a.assigneeUser?.viewerIsUser) continue;
        const body = (a.body ?? "").trim();
        if (!body) continue;

        const due = a.dueDate ? new Date(a.dueDate) : null;
        const dueStr = due
          ? ` (due ${due.toLocaleDateString([], { month: "short", day: "numeric" })})`
          : "";

        items.push({
          externalId: `lattice:action:${a.entityId ?? a.id}`,
          title: stripMarkup(body),
          bucket: "next",
          sourceRef: `From Lattice 1:1 with ${otherName}${dueStr}.`,
          url: rel.entityId ? `${origin}/users/${rel.entityId}/1-1s` : undefined,
        });
      }
    }

    return { items };
  },
};

/**
 * Lattice stores action-item bodies as rich text (occasionally HTML-ish).
 * Strip tags and collapse whitespace so the title reads cleanly on the board.
 */
function stripMarkup(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
