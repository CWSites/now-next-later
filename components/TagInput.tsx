"use client";

import { useState } from "react";

/**
 * Chip-based editor for a comma-separated list.
 *
 * Behaviors:
 *   - Type a value and press Enter or comma to add it as a chip.
 *   - Paste a comma/newline-separated string to add multiple at once.
 *   - Backspace on an empty input removes the last chip.
 *   - Click × on a chip to remove it.
 *
 * The underlying serialized form is a comma-separated string so the value
 * round-trips cleanly through the existing secret store (no schema changes).
 */
interface Props {
  /** Comma-separated current value. Empty string when there are no tags. */
  value: string;
  onChange: (nextValue: string) => void;
  placeholder?: string;
  inputId?: string;
}

function parseCsv(csv: string): string[] {
  return csv
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function toCsv(tags: string[]): string {
  return tags.join(", ");
}

export function TagInput({ value, onChange, placeholder, inputId }: Props) {
  const tags = parseCsv(value);
  const [draft, setDraft] = useState("");

  function commit(next: string[]) {
    // Dedupe case-insensitively while preserving the first occurrence's casing.
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const t of next) {
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      kept.push(t);
    }
    onChange(toCsv(kept));
  }

  function addFromDraft(raw?: string) {
    const source = raw !== undefined ? raw : draft;
    const additions = parseCsv(source);
    if (additions.length === 0) return;
    commit([...tags, ...additions]);
    setDraft("");
  }

  function removeAt(index: number) {
    commit(tags.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        id={inputId}
        type="text"
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          // If the user typed / pasted something ending with a comma or
          // newline, treat it as a commit signal for everything before it.
          if (/[,\n]/.test(v)) {
            addFromDraft(v);
          } else {
            setDraft(v);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addFromDraft();
          } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
            e.preventDefault();
            removeAt(tags.length - 1);
          }
        }}
        onBlur={() => addFromDraft()}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (/[,\n]/.test(text)) {
            e.preventDefault();
            addFromDraft(text);
          }
        }}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder ?? "Type and press Enter, or paste comma-separated values"}
        className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-neutral-700 dark:bg-neutral-950"
      />
      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((tag, i) => (
            <li
              key={`${tag}:${i}`}
              className="group inline-flex items-center gap-1 rounded-full border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-xs text-neutral-800 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            >
              <span>{tag}</span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={`Remove ${tag}`}
                className="text-neutral-400 hover:text-red-500"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-neutral-400">No filters yet.</p>
      )}
    </div>
  );
}
