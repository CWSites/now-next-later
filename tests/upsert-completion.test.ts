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

describe("upsertByExternalId — source-driven completion", () => {
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
    // Regression: POLARIS-3186 shipped to Done in Jira but the local board
    // kept showing "In Code Review" because ingest never touched it again.
    // Now the Jira adapter emits completed:true for Done tickets and storage
    // flips the local completion state on upsert.
    const { upsertByExternalId, getAllTasks } = await loadStorage();
    await upsertByExternalId({
      externalId: "jira:POLARIS-3186",
      title: "[POLARIS-3186] Preview page does not reflect required flag on line items",
      source: "jira",
      sourceRef: "In Jira POLARIS-3186 (In Code Review)",
    });

    const before = (await getAllTasks())[0];
    expect(before.completed).toBe(false);

    await upsertByExternalId({
      externalId: "jira:POLARIS-3186",
      title: before.title,
      source: "jira",
      sourceRef: "In Jira POLARIS-3186 (Done)",
      sourceCompleted: true,
    });

    const after = (await getAllTasks())[0];
    expect(after.completed).toBe(true);
    expect(after.completedAt).toBeTruthy();
    expect(after.sourceRef).toContain("Done");
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
