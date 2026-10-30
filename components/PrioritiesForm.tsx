"use client";

import { useState } from "react";
import type { Priority } from "@/lib/types";

const COLOR_OPTIONS = ["rose", "amber", "emerald", "sky", "violet", "neutral"] as const;

const SWATCH_CLASS: Record<string, string> = {
  rose: "bg-rose-400",
  amber: "bg-amber-400",
  emerald: "bg-emerald-400",
  sky: "bg-sky-400",
  violet: "bg-violet-400",
  neutral: "bg-neutral-400",
};

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

interface Props {
  initial: Priority[];
}

export function PrioritiesForm({ initial }: Props) {
  // Work on a local draft so reordering / renaming feels instant; save
  // writes the whole array back to the server. Ranks are derived from
  // array position on save so the user doesn't have to maintain them.
  const [items, setItems] = useState<Priority[]>(() =>
    initial.slice().sort((a, b) => a.rank - b.rank),
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");

  function patch(id: string, p: Partial<Priority>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }

  function move(id: string, dir: -1 | 1) {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      const next = idx + dir;
      if (idx === -1 || next < 0 || next >= prev.length) return prev;
      const copy = prev.slice();
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  }

  function remove(id: string) {
    setItems((prev) => prev.filter((p) => p.id !== id));
  }

  function add() {
    const label = draftLabel.trim();
    if (!label) return;
    // Avoid id collisions by appending a counter when a slug already
    // exists — users can rename labels freely without worrying.
    const base = slugify(label) || "priority";
    let id = base;
    let n = 2;
    const existing = new Set(items.map((i) => i.id));
    while (existing.has(id)) id = `${base}-${n++}`;
    setItems((prev) => [
      ...prev,
      { id, label, rank: prev.length + 1, color: "neutral" },
    ]);
    setDraftLabel("");
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    const payload = {
      // Normalize ranks from array order so the user never has to touch them.
      priorities: items.map((p, idx) => ({ ...p, rank: idx + 1 })),
    };
    try {
      const res = await fetch("/api/priorities", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStatus(`❌ Save failed: ${JSON.stringify(body.error ?? body)}`);
      } else {
        setStatus("✅ Saved.");
      }
    } catch (err) {
      setStatus(`❌ ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-10">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Priorities</h2>
        <span className="text-xs text-neutral-500">
          Rank order is left column — top = #1. Tasks show a colored badge for their priority.
        </span>
      </header>

      <ul className="flex flex-col gap-2">
        {items.map((p, idx) => (
          <li
            key={p.id}
            className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white/80 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900/60"
          >
            <span className="w-7 shrink-0 text-center text-xs font-semibold tabular-nums text-neutral-500">
              #{idx + 1}
            </span>
            <input
              value={p.label}
              onChange={(e) => patch(p.id, { label: e.target.value })}
              className="flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-sm outline-none focus:border-blue-400 dark:border-neutral-700 dark:bg-neutral-950"
            />
            <select
              value={p.color ?? "neutral"}
              onChange={(e) => patch(p.id, { color: e.target.value })}
              className="rounded border border-neutral-200 bg-white px-1.5 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-950"
            >
              {COLOR_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span
              className={`inline-block h-4 w-4 rounded-full ${SWATCH_CLASS[p.color ?? "neutral"] ?? SWATCH_CLASS.neutral}`}
              aria-hidden
            />
            <label className="flex items-center gap-1 text-[11px] text-neutral-500">
              <input
                type="checkbox"
                checked={!!p.retired}
                onChange={(e) => patch(p.id, { retired: e.target.checked })}
              />
              retired
            </label>
            <div className="flex gap-0.5">
              <button
                type="button"
                onClick={() => move(p.id, -1)}
                disabled={idx === 0}
                aria-label="Move up"
                className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(p.id, 1)}
                disabled={idx === items.length - 1}
                aria-label="Move down"
                className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:hover:bg-neutral-800"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => remove(p.id)}
                aria-label="Delete"
                title="Delete (any tasks still pointing here will stop showing a badge)"
                className="rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50"
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={draftLabel}
          onChange={(e) => setDraftLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add a priority (e.g. Hiring)"
          className="flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-sm outline-none focus:border-blue-400 dark:border-neutral-700 dark:bg-neutral-950"
        />
        <button
          type="button"
          onClick={add}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-950 dark:hover:bg-neutral-800"
        >
          Add
        </button>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md border border-blue-500 bg-blue-500 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-600 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save priorities"}
        </button>
        {status ? <span className="text-xs text-neutral-500">{status}</span> : null}
      </div>
    </section>
  );
}
