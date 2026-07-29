import type { Task } from "./types";

/**
 * Providers we ship a branded logo for under public/logos/.
 * Order matters only for the `sourceRef`/`url` fallback matcher below
 * (longer / more specific keys first so "atlassian" wins over "jira" etc).
 */
const KNOWN_PROVIDERS = [
  "jira",
  "slack",
  "gcal",
  "gdoc",
  "granola",
  "fellow",
  "lattice",
] as const;
type ProviderId = (typeof KNOWN_PROVIDERS)[number];

/** Emoji fallback so ProviderIcon can render something readable even
 *  when the SVG/PNG file is missing on disk. */
const EMOJI: Record<ProviderId, string> = {
  jira: "🧩",
  slack: "💬",
  gcal: "📅",
  gdoc: "📄",
  granola: "🥣",
  fellow: "🤝",
  lattice: "🌱",
};

const LABEL: Record<ProviderId, string> = {
  jira: "Jira",
  slack: "Slack",
  gcal: "Google Calendar",
  gdoc: "Google Docs",
  granola: "Granola",
  fellow: "Fellow",
  lattice: "Lattice",
};

/**
 * Best-guess icon for a task. Returns null when we don't recognize the
 * source (e.g. a manually-added task with no URL) — callers should skip
 * rendering the icon in that case rather than showing a fallback glyph
 * that would just add noise.
 *
 * Resolution order:
 *   1. `task.source` — the adapter that created the task. Most reliable.
 *   2. Hostname in `task.url`, when present.
 *   3. Substring match against `task.sourceRef` prose (handles morning-brief
 *      imports where `source: "morning-brief"` but the ref says "In Jira …").
 */
export function iconForTask(task: Pick<Task, "source" | "sourceRef" | "url">): {
  id: ProviderId;
  emoji: string;
  label: string;
} | null {
  const id = resolveProviderId(task);
  if (!id) return null;
  return { id, emoji: EMOJI[id], label: LABEL[id] };
}

function resolveProviderId(task: Pick<Task, "source" | "sourceRef" | "url">): ProviderId | null {
  // 1. Direct source match (adapter tasks).
  if (task.source && (KNOWN_PROVIDERS as readonly string[]).includes(task.source)) {
    return task.source as ProviderId;
  }

  // 2. URL host lookup — cheap and unambiguous when we have a link.
  if (task.url) {
    const fromUrl = providerFromUrl(task.url);
    if (fromUrl) return fromUrl;
  }

  // 3. Prose fallback for morning-brief imports and similar.
  if (task.sourceRef) {
    const s = task.sourceRef.toLowerCase();
    // Order matters: check specific-before-generic.
    if (s.includes("google calendar") || s.includes("gcal") || s.includes("calendar invite"))
      return "gcal";
    if (
      s.includes("google doc") ||
      s.includes("google sheet") ||
      s.includes("google slide") ||
      s.includes("google form") ||
      s.includes("google drive")
    )
      return "gdoc";
    if (s.includes("jira") || s.includes("atlassian")) return "jira";
    if (s.includes("slack")) return "slack";
    if (s.includes("granola")) return "granola";
    if (s.includes("fellow")) return "fellow";
    if (s.includes("lattice")) return "lattice";
  }

  return null;
}

function providerFromUrl(raw: string): ProviderId | null {
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.endsWith(".atlassian.net")) return "jira"; // includes Confluence hosts; Jira icon is close enough
  if (host === "app.slack.com" || host.endsWith(".slack.com")) return "slack";
  if (host === "calendar.google.com" || host === "meet.google.com") return "gcal";
  // Google Workspace document types — Docs/Sheets/Slides/Forms/Drive all
  // share one icon slot; the Docs SVG is close enough visually for the
  // 12px slot on task cards.
  if (
    host === "docs.google.com" ||
    host === "drive.google.com" ||
    host === "sheets.google.com" ||
    host === "slides.google.com"
  )
    return "gdoc";
  if (host.endsWith(".granola.ai")) return "granola";
  if (host.includes("fellow.app") || host === "app.fellow.app") return "fellow";
  if (host === "app.lattice.com" || host.endsWith(".lattice.com") || host.endsWith(".latticehq.com"))
    return "lattice";
  return null;
}
