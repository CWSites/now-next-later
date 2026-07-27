import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";

const ENABLED = process.env.GIT_SYNC_ENABLED !== "0";
const DEBOUNCE_MS = Number(process.env.GIT_SYNC_DEBOUNCE_MS ?? "2000");

interface Pending {
  repoRoot: string;
  filePath: string;
  messages: string[];
  timer: NodeJS.Timeout | null;
}

const pending = new Map<string, Pending>();
let pulledOnce = false;
let pullPromise: Promise<void> | null = null;

function gitFor(repoRoot: string): SimpleGit {
  return simpleGit(repoRoot);
}

/** Pull once on first use so a fresh process picks up changes from other machines. */
export async function ensurePulled(repoRoot: string): Promise<void> {
  if (!ENABLED || pulledOnce) return;
  if (pullPromise) return pullPromise;
  pullPromise = (async () => {
    try {
      const git = gitFor(repoRoot);
      await git.fetch();
      // Rebase + autostash keeps local uncommitted edits from blocking the pull.
      await git.pull(["--rebase", "--autostash"]);
      pulledOnce = true;
      // eslint-disable-next-line no-console
      console.log("[git-sync] pulled latest from remote");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[git-sync] pull failed (continuing offline):", (err as Error).message);
      pulledOnce = true; // don't retry every request
    } finally {
      pullPromise = null;
    }
  })();
  return pullPromise;
}

export function queueSync(repoRoot: string, filePath: string, message: string): void {
  if (!ENABLED) return;
  const key = repoRoot;
  let entry = pending.get(key);
  if (!entry) {
    entry = { repoRoot, filePath, messages: [], timer: null };
    pending.set(key, entry);
  }
  entry.messages.push(message);
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => void flush(key), DEBOUNCE_MS);
}

async function flush(key: string): Promise<void> {
  const entry = pending.get(key);
  if (!entry) return;
  pending.delete(key);

  const git = gitFor(entry.repoRoot);
  const relPath = path.relative(entry.repoRoot, entry.filePath);
  const summary =
    entry.messages.length === 1
      ? entry.messages[0]
      : `${entry.messages.length} changes: ${[...new Set(entry.messages)].slice(0, 3).join(", ")}`;

  try {
    // Pull first so we rebase on top of remote changes.
    try {
      await git.fetch();
      await git.pull(["--rebase", "--autostash"]);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[git-sync] pre-commit pull failed:", (err as Error).message);
    }

    await git.add(relPath);
    const status = await git.status();
    if (status.staged.length === 0) return; // nothing to commit

    await git.commit(`data: ${summary}`);

    try {
      await git.push();
      // eslint-disable-next-line no-console
      console.log(`[git-sync] pushed: ${summary}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[git-sync] push failed (will retry on next change):", (err as Error).message);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[git-sync] sync error:", (err as Error).message);
  }
}
