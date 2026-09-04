import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// Storage reads DATA_REPO_PATH at import time via `path.resolve`, so we set
// it BEFORE importing the module and reset the module cache between tests.
let tmpDir: string;

async function loadStorage() {
  return await import("@/lib/storage");
}

describe("upsertByExternalId + deleteByExternalId — source-driven completion", () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nnl-storage-"));
    await fs.mkdir(path.join(tmpDir, "data"), { recursive: true });
    process.env.DATA_REPO_PATH = tmpDir;
    // git-sync is opt-in via GIT_SYNC_ENABLED, so tests are safe from it.
    vi.resetModules();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    delete process.env.DATA_REPO_PATH;
  });

  it("marks a task complete when the source reports it done", async () => {
    // Kept for non-Jira sources that may want source-driven completion as
    // a history-preserving alternative to deletion.
    const { upsertByExternalId, getAllTasks } = await loadStorage();
    await upsertByExternalId({
      externalId: "granola:mtg-1",
      title: "Draft agenda for Q4 review",
      source: "granola",
    });

    const before = (await getAllTasks())[0];
    expect(before.completed).toBe(false);

    await upsertByExternalId({
      externalId: "granola:mtg-1",
      title: before.title,
      source: "granola",
      sourceCompleted: true,
    });

    const after = (await getAllTasks())[0];
    expect(after.completed).toBe(true);
    expect(after.completedAt).toBeTruthy();
  });

  it("deleteByExternalId with allowCompleted removes a completed source-owned task", async () => {
    // Regression: a Jira ticket that moved to Done used to sit on the board
    // forever — either as "In Code Review" (stale sync) or, after the
    // previous fix, as a completed history entry. The user's request is
    // stronger: Done/Closed tickets shouldn't be on the board at all.
    // The runner now calls deleteByExternalId({ allowCompleted: true }) for
    // adapter-driven removals so the "preserve completed history" guard
    // doesn't block it.
    const { upsertByExternalId, updateTask, deleteByExternalId, getAllTasks } =
      await loadStorage();
    const { task } = await upsertByExternalId({
      externalId: "jira:POLARIS-3186",
      title: "[POLARIS-3186] Preview page does not reflect required flag on line items",
      source: "jira",
    });
    await updateTask(task!.id, { completed: true });

    const guarded = await deleteByExternalId("jira:POLARIS-3186", { source: "jira" });
    expect(guarded).toEqual({ deleted: false, reason: "completed" });

    const forced = await deleteByExternalId("jira:POLARIS-3186", {
      source: "jira",
      allowCompleted: true,
    });
    expect(forced.deleted).toBe(true);
    const remaining = await getAllTasks();
    expect(remaining.find((t) => t.externalId === "jira:POLARIS-3186")).toBeUndefined();
  });

  it("never un-completes a task even if the source stops reporting it done", async () => {
    // Completion is monotonic on the storage side — if a user checked
    // something off, an adapter run that no longer marks it done must not
    // resurrect it.
    const { upsertByExternalId, updateTask, getAllTasks } = await loadStorage();
    const { task } = await upsertByExternalId({
      externalId: "jira:POLARIS-9",
      title: "already-done ticket",
      source: "jira",
    });
    await updateTask(task!.id, { completed: true });

    await upsertByExternalId({
      externalId: "jira:POLARIS-9",
      title: "already-done ticket",
      source: "jira",
      sourceCompleted: false,
    });

    const after = (await getAllTasks())[0];
    expect(after.completed).toBe(true);
  });
});
