import { Board } from "@/components/Board";
import { getAllTasks, getPriorities, REPO_ROOT } from "@/lib/storage";
import { ensurePulled } from "@/lib/git-sync";

export default async function Page() {
  await ensurePulled(REPO_ROOT);
  const [tasks, priorities] = await Promise.all([getAllTasks(), getPriorities()]);
  return (
    <main className="mx-auto max-w-7xl p-6">
      <Board initialTasks={tasks} initialPriorities={priorities} />
    </main>
  );
}
