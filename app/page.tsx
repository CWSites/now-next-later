import { Board } from "@/components/Board";
import { getAllTasks, REPO_ROOT } from "@/lib/storage";
import { ensurePulled } from "@/lib/git-sync";

export default async function Page() {
  await ensurePulled(REPO_ROOT);
  const tasks = await getAllTasks();
  return (
    <main className="mx-auto max-w-7xl p-6">
      <Board initialTasks={tasks} />
    </main>
  );
}
