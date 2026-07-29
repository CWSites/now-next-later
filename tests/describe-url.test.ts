import { describe, it, expect } from "vitest";
import { describeUrl } from "@/lib/describe-url";

/**
 * Guardrail: URL → human label. Regressions here mean task cards start
 * showing raw domains again ("docs.google.com/document/d/…") instead of
 * "In Google Doc", degrading scannability.
 */
describe("describeUrl", () => {
  describe("google workspace", () => {
    it.each([
      ["https://docs.google.com/document/d/abc/edit", "In Google Doc"],
      ["https://docs.google.com/spreadsheets/d/xyz", "In Google Sheet"],
      ["https://docs.google.com/presentation/d/foo", "In Google Slides"],
      ["https://docs.google.com/forms/d/bar", "In Google Form"],
      ["https://drive.google.com/file/d/xyz", "In Google Drive"],
      ["https://sheets.google.com/foo", "In Google Sheet"],
      ["https://slides.google.com/foo", "In Google Slides"],
      ["https://calendar.google.com/event?eid=xyz", "In Google Calendar"],
      ["https://meet.google.com/abc-defg-hij", "Google Meet link"],
      ["https://mail.google.com/mail/u/0/#inbox", "In Gmail"],
    ])("%s → %s", (url, expected) => {
      expect(describeUrl(url)).toBe(expected);
    });
  });

  describe("atlassian", () => {
    it("extracts the ticket key from a Jira browse URL", () => {
      expect(describeUrl("https://example.atlassian.net/browse/PEPPERMINT-2826")).toBe(
        "In Jira PEPPERMINT-2826",
      );
    });
    it("labels Confluence wiki pages", () => {
      expect(describeUrl("https://example.atlassian.net/wiki/spaces/ENG/pages/123")).toBe(
        "In Confluence",
      );
    });
    it("falls back to generic Atlassian for unknown paths", () => {
      expect(describeUrl("https://example.atlassian.net/some/random")).toBe("In Atlassian");
    });
  });

  describe("github", () => {
    it("extracts PR number", () => {
      expect(describeUrl("https://github.com/CWSites/now-next-later/pull/12")).toBe(
        "GitHub PR #12",
      );
    });
    it("extracts issue number", () => {
      expect(describeUrl("https://github.com/CWSites/repo/issues/47")).toBe("GitHub issue #47");
    });
    it("extracts discussion number", () => {
      expect(describeUrl("https://github.com/CWSites/repo/discussions/3")).toBe(
        "GitHub discussion #3",
      );
    });
    it("labels Actions runs", () => {
      expect(describeUrl("https://github.com/o/r/actions/runs/12345")).toBe("GitHub Actions run");
    });
    it("falls back to owner/repo for other paths", () => {
      expect(describeUrl("https://github.com/CWSites/now-next-later")).toBe(
        "GitHub: CWSites/now-next-later",
      );
    });
    it("labels gists", () => {
      expect(describeUrl("https://gist.github.com/user/abc123")).toBe("GitHub gist");
    });
  });

  describe("slack", () => {
    it("labels a message link", () => {
      expect(describeUrl("https://example.slack.com/archives/C123/p1234567890")).toBe(
        "Slack message",
      );
    });
    it("labels a user profile link", () => {
      expect(describeUrl("https://example.slack.com/team/U456")).toBe("Slack user");
    });
    it("falls back to generic In Slack for other paths", () => {
      expect(describeUrl("https://app.slack.com/client/T1/C2")).toBe("In Slack");
    });
  });

  describe("other saas", () => {
    it.each([
      ["https://www.notion.so/foo/Some-Page-abcdef", "In Notion"],
      ["https://workspace.notion.site/some-page", "In Notion"],
      ["https://www.figma.com/file/abc", "In Figma"],
      ["https://www.figma.com/board/foo", "In FigJam"],
      ["https://www.figma.com/proto/foo", "Figma prototype"],
      ["https://linear.app/foo/issue/BAR-42/some-title", "In Linear BAR-42"],
      ["https://linear.app/foo/team/eng", "In Linear"],
      ["https://app.asana.com/0/1234/5678", "In Asana"],
      ["https://trello.com/b/xyz/board", "In Trello"],
      ["https://app.clickup.com/t/abc", "In ClickUp"],
      ["https://app.lattice.com/reviews/123", "In Lattice"],
      ["https://example.lattice.com/1-1s", "In Lattice"],
      ["https://www.loom.com/share/xxx", "Loom recording"],
      ["https://app.granola.ai/notes/abc", "In Granola"],
      ["https://notes.granola.ai/d/abc", "In Granola"],
      ["https://www.youtube.com/watch?v=xxx", "YouTube video"],
      ["https://youtu.be/xxx", "YouTube video"],
      ["https://vimeo.com/12345", "Vimeo video"],
      ["https://example.zoom.us/j/123", "Zoom link"],
      ["https://www.linkedin.com/in/janedoe/", "LinkedIn: janedoe"],
      ["https://www.linkedin.com/jobs/view/123", "LinkedIn job"],
      ["https://x.com/user/status/1234", "Post on X"],
      ["https://twitter.com/user/status/1234", "Post on X"],
    ])("%s → %s", (url, expected) => {
      expect(describeUrl(url)).toBe(expected);
    });
  });

  describe("fallback", () => {
    it("shows compact host+path for unknown domains", () => {
      expect(describeUrl("https://example.com/some/path")).toBe("example.com/some/path");
    });
    it("strips www. from the fallback host", () => {
      expect(describeUrl("https://www.example.com/foo")).toBe("example.com/foo");
    });
    it("truncates very long fallback labels with an ellipsis", () => {
      const long = "https://example.com/" + "a".repeat(200);
      const result = describeUrl(long);
      expect(result.length).toBeLessThanOrEqual(60);
      expect(result.endsWith("…")).toBe(true);
    });
    it("returns the raw string for invalid URLs (best-effort)", () => {
      expect(describeUrl("not a url")).toBe("not a url");
    });
  });
});
