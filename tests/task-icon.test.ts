import { describe, it, expect } from "vitest";
import { iconForTask } from "../lib/task-icon";

describe("iconForTask", () => {
  it("returns the direct provider when task.source matches an adapter", () => {
    expect(iconForTask({ source: "jira" })?.id).toBe("jira");
    expect(iconForTask({ source: "slack" })?.id).toBe("slack");
    expect(iconForTask({ source: "gcal" })?.id).toBe("gcal");
    expect(iconForTask({ source: "granola" })?.id).toBe("granola");
    expect(iconForTask({ source: "fellow" })?.id).toBe("fellow");
    expect(iconForTask({ source: "lattice" })?.id).toBe("lattice");
  });

  it("falls back to the URL host when source isn't a known provider", () => {
    expect(
      iconForTask({ source: "morning-brief", url: "https://example.atlassian.net/browse/PROJ-1" })
        ?.id,
    ).toBe("jira");
    expect(iconForTask({ url: "https://example.slack.com/archives/C1/p123" })?.id).toBe("slack");
    expect(iconForTask({ url: "https://calendar.google.com/event?id=x" })?.id).toBe("gcal");
    expect(iconForTask({ url: "https://app.granola.ai/notes/123" })?.id).toBe("granola");
    expect(iconForTask({ url: "https://your-workspace.latticehq.com/1-1s" })?.id).toBe("lattice");
  });

  it("falls back to sourceRef prose when neither source nor URL identifies a provider", () => {
    expect(iconForTask({ source: "morning-brief", sourceRef: "In Jira PROJ-1" })?.id).toBe("jira");
    expect(iconForTask({ sourceRef: "Slack message" })?.id).toBe("slack");
    expect(iconForTask({ sourceRef: "Google Calendar invite" })?.id).toBe("gcal");
    expect(iconForTask({ sourceRef: "In Granola notes" })?.id).toBe("granola");
  });

  it("returns null when there's nothing to go on", () => {
    expect(iconForTask({})).toBeNull();
    expect(iconForTask({ source: "morning-brief" })).toBeNull();
    expect(iconForTask({ sourceRef: "some manual note" })).toBeNull();
    expect(iconForTask({ url: "https://random-site.example.com/foo" })).toBeNull();
  });

  it("source wins over URL and sourceRef when they conflict", () => {
    // A Slack-sourced task whose ref mentions Jira should still show Slack.
    expect(
      iconForTask({ source: "slack", sourceRef: "Jira ticket linked in the message" })?.id,
    ).toBe("slack");
  });

  it("attaches a human label and emoji fallback for each provider", () => {
    const jira = iconForTask({ source: "jira" });
    expect(jira?.label).toBe("Jira");
    expect(jira?.emoji).toBeTruthy();
  });
});
