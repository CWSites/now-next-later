/**
 * Map a URL to a short, human-friendly description of what it points at,
 * so we can render "In Google Doc" instead of "docs.google.com/document/..."
 * on task cards.
 *
 * Rules are cheap heuristics on hostname + path. When we recognize a
 * platform we try to be a little more specific (e.g. GitHub PR numbers,
 * Jira ticket keys), but the fallback is always safe: a compact host+path
 * so nothing renders as an opaque blob.
 */
export function describeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw.slice(0, 60);
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  const parts = path.split("/").filter(Boolean);

  // --- Google workspace ---
  if (host === "docs.google.com") {
    if (parts[0] === "document") return "In Google Doc";
    if (parts[0] === "spreadsheets") return "In Google Sheet";
    if (parts[0] === "presentation") return "In Google Slides";
    if (parts[0] === "forms") return "In Google Form";
    return "In Google Docs";
  }
  if (host === "drive.google.com") return "In Google Drive";
  if (host === "sheets.google.com") return "In Google Sheet";
  if (host === "slides.google.com") return "In Google Slides";
  if (host === "calendar.google.com") return "In Google Calendar";
  if (host === "meet.google.com") return "Google Meet link";
  if (host === "mail.google.com" || host === "gmail.com") return "In Gmail";
  if (host === "chat.google.com") return "In Google Chat";

  // --- Atlassian ---
  if (host.endsWith(".atlassian.net")) {
    // /browse/KEY-123 → "In Jira PROJ-123"
    if (parts[0] === "browse" && parts[1]) return `In Jira ${parts[1]}`;
    // /wiki/... → Confluence
    if (parts[0] === "wiki") return "In Confluence";
    // /jira/... or /issues/... → generic Jira
    if (parts[0] === "jira" || parts[0] === "issues") return "In Jira";
    return "In Atlassian";
  }

  // --- GitHub ---
  if (host === "github.com" || host === "www.github.com") {
    // /owner/repo/pull/123 → "GitHub PR #123"
    // /owner/repo/issues/123 → "GitHub issue #123"
    // /owner/repo → "GitHub: owner/repo"
    if (parts.length >= 4 && parts[2] === "pull") return `GitHub PR #${parts[3]}`;
    if (parts.length >= 4 && parts[2] === "issues") return `GitHub issue #${parts[3]}`;
    if (parts.length >= 4 && parts[2] === "discussions") return `GitHub discussion #${parts[3]}`;
    if (parts.length >= 4 && parts[2] === "actions") return "GitHub Actions run";
    if (parts.length >= 2) return `GitHub: ${parts[0]}/${parts[1]}`;
    return "In GitHub";
  }
  if (host === "gist.github.com") return "GitHub gist";

  // --- Slack ---
  if (host === "app.slack.com" || host.endsWith(".slack.com")) {
    // /archives/CHANNEL/pTIMESTAMP → in Slack (message)
    if (path.includes("/archives/")) return "Slack message";
    if (path.includes("/team/")) return "Slack user";
    return "In Slack";
  }

  // --- Notion ---
  if (host === "www.notion.so" || host === "notion.so" || host.endsWith(".notion.site")) {
    return "In Notion";
  }

  // --- Figma / FigJam ---
  if (host === "www.figma.com" || host === "figma.com") {
    if (parts[0] === "board") return "In FigJam";
    if (parts[0] === "proto") return "Figma prototype";
    return "In Figma";
  }

  // --- Linear ---
  if (host === "linear.app") {
    // /workspace/issue/ABC-123/... → "In Linear ABC-123"
    const issueIdx = parts.indexOf("issue");
    if (issueIdx >= 0 && parts[issueIdx + 1]) return `In Linear ${parts[issueIdx + 1]}`;
    return "In Linear";
  }

  // --- Other common SaaS ---
  if (host === "app.asana.com") return "In Asana";
  if (host === "trello.com" || host === "www.trello.com") return "In Trello";
  if (host === "app.clickup.com") return "In ClickUp";
  if (host === "app.lattice.com" || host.endsWith(".lattice.com")) return "In Lattice";
  if (host === "loom.com" || host === "www.loom.com") return "Loom recording";
  if (host === "app.granola.ai" || host.endsWith(".granola.ai")) return "In Granola";
  if (host === "www.youtube.com" || host === "youtube.com" || host === "youtu.be")
    return "YouTube video";
  if (host === "vimeo.com" || host === "www.vimeo.com") return "Vimeo video";
  if (host === "zoom.us" || host.endsWith(".zoom.us")) return "Zoom link";
  if (host === "www.linkedin.com" || host === "linkedin.com") {
    if (parts[0] === "in" && parts[1]) return `LinkedIn: ${parts[1]}`;
    if (parts[0] === "jobs") return "LinkedIn job";
    return "In LinkedIn";
  }
  if (host === "twitter.com" || host === "x.com" || host === "www.x.com") return "Post on X";

  // --- Fallback: host + short path ---
  const cleanHost = host.replace(/^www\./, "");
  const compact = path === "/" ? cleanHost : `${cleanHost}${path}`;
  return compact.length > 60 ? compact.slice(0, 57) + "…" : compact;
}
