import { Board } from "@/components/Board";
import { getAllTasks, REPO_ROOT } from "@/lib/storage";
import { ensurePulled } from "@/lib/git-sync";

export default async function Page() {
  await ensurePulled(REPO_ROOT);
  const tasks = await getAllTasks();
  return (
    <main className="mx-auto max-w-7xl p-6">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Now / Next / Later</h1>
        <p className="text-sm text-neutral-500">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
      </header>
      <Board initialTasks={tasks} />
    </main>
  );
}
