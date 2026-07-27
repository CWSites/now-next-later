import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Minimal .env.local loader for CLI scripts. Next.js loads .env.local
 * automatically for the web server; this fills the gap for `npm run ingest`
 * and other one-off scripts. Silent if the file doesn't exist.
 *
 * Does not override variables that are already set in process.env — so
 * launchd / shell exports still win over file contents.
 */
export function loadEnvLocal(cwd: string = process.cwd()): void {
  const file = path.join(cwd, ".env.local");
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
