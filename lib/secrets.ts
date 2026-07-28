import { promises as fs } from "node:fs";
import path from "node:path";
import "server-only";

/**
 * Secret storage for ingest adapters.
 *
 * File lives at <repo>/secrets.local.json, git-ignored, chmod 600.
 * Never shipped to the browser as raw values — the settings API only
 * returns masked previews. `applySecretsToEnv()` merges the file into
 * process.env at ingest time so existing adapter code that reads
 * process.env.FOO keeps working.
 */

export type Provider = "jira" | "slack" | "gcal" | "granola" | "fellow" | "lattice";

export type FieldKind = "text" | "tags";

export interface SecretField {
  key: string;
  label: string;
  /** true = mask in UI responses; false = safe to show in the clear (URLs, usernames). */
  secret: boolean;
  /** Which provider group this field belongs to. Drives grouping in the settings UI. */
  provider: Provider;
  /** Renders a chip editor for comma-separated lists instead of a text input. */
  kind?: FieldKind;
  placeholder?: string;
  help?: string;
}

export interface ProviderMeta {
  id: Provider;
  label: string;
  emoji: string;
  description: string;
}

/** Display order + metadata for each provider group. */
export const PROVIDERS: ProviderMeta[] = [
  {
    id: "jira",
    label: "Jira",
    emoji: "🎯",
    description: "Pulls in-flight tickets assigned to you.",
  },
  {
    id: "slack",
    label: "Slack",
    emoji: "💬",
    description: "Surfaces DMs with unread messages as Now tasks.",
  },
  {
    id: "gcal",
    label: "Google Calendar",
    emoji: "🗓️",
    description: "Today's meetings → Now; rest of the week → Next.",
  },
  {
    id: "granola",
    label: "Granola",
    emoji: "📝",
    description: "Recent meeting notes and open action items.",
  },
  {
    id: "fellow",
    label: "Fellow",
    emoji: "🤝",
    description: "Open action items assigned to you in Fellow.",
  },
  {
    id: "lattice",
    label: "Lattice",
    emoji: "📊",
    description: "Open todos + review deadlines. Uses your browser session cookie (no admin API key).",
  },
];

export const SECRET_SCHEMA: SecretField[] = [
  {
    key: "JIRA_URL",
    label: "Jira URL",
    secret: false,
    provider: "jira",
    placeholder: "https://your-org.atlassian.net",
  },
  {
    key: "JIRA_USERNAME",
    label: "Jira username (email)",
    secret: false,
    provider: "jira",
    placeholder: "you@example.com",
  },
  {
    key: "JIRA_API_TOKEN",
    label: "Jira API token",
    secret: true,
    provider: "jira",
    help: "id.atlassian.com → Security → API tokens.",
  },
  {
    key: "SLACK_MCP_XOXC_TOKEN",
    label: "Slack xoxc token",
    secret: true,
    provider: "slack",
    help: "From Slack web app localStorage → localConfig_v2 → teams.<id>.token.",
  },
  {
    key: "SLACK_MCP_XOXD_TOKEN",
    label: "Slack xoxd cookie",
    secret: true,
    provider: "slack",
    help: "The `d` cookie on slack.com.",
  },
  {
    key: "GOOGLE_CLIENT_ID",
    label: "Google OAuth Client ID",
    secret: false,
    provider: "gcal",
    placeholder: "xxxx.apps.googleusercontent.com",
    help: "Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client (Desktop or Web).",
  },
  {
    key: "GOOGLE_CLIENT_SECRET",
    label: "Google OAuth Client Secret",
    secret: true,
    provider: "gcal",
  },
  {
    key: "GOOGLE_REFRESH_TOKEN",
    label: "Google refresh token",
    secret: true,
    provider: "gcal",
    help: "Set automatically after clicking 'Connect Google Calendar'.",
  },
  {
    key: "GCAL_SKIP_TITLES",
    label: "Skip events matching",
    secret: false,
    provider: "gcal",
    kind: "tags",
    placeholder: "Type a phrase and press Enter (e.g. standup)",
    help: "Case-insensitive substring match on event titles. Events matching any tag won't be ingested.",
  },
  {
    key: "GRANOLA_API_KEY",
    label: "Granola API key",
    secret: true,
    provider: "granola",
    help: "Granola desktop app → Settings → API keys → Create personal key. See docs.granola.ai/help-center/sharing/integrations/granola-api.",
  },
  {
    key: "GRANOLA_ME_EMAIL",
    label: "Your Granola email",
    secret: false,
    provider: "granola",
    placeholder: "you@example.com",
    help: "Used to correctly attribute action items when meetings have multiple 'Alex's / 'Chris's. If unset, we guess from your most-frequent-owner notes.",
  },
  {
    key: "GRANOLA_SKIP_TITLES",
    label: "Skip notes matching",
    secret: false,
    provider: "granola",
    kind: "tags",
    placeholder: "Type a phrase and press Enter (e.g. stand-up)",
    help: "Case-insensitive substring match on note titles. Notes matching any tag won't be scanned for action items.",
  },

  {
    key: "FELLOW_CLIENT_ID",
    label: "Fellow OAuth client ID",
    secret: false,
    provider: "fellow",
    help: "Auto-populated the first time you click 'Connect Fellow' (dynamic client registration).",
  },
  {
    key: "FELLOW_REFRESH_TOKEN",
    label: "Fellow refresh token",
    secret: true,
    provider: "fellow",
    help: "Set automatically after clicking 'Connect Fellow'.",
  },
  {
    key: "LATTICE_COOKIE",
    label: "Lattice session cookie",
    secret: true,
    provider: "lattice",
    help: "Auto-populated by the 'Refresh Lattice session' bookmarklet below. Contains your active Lattice login cookies.",
  },
  {
    key: "LATTICE_GRAPHQL_ORIGIN",
    label: "Lattice workspace origin",
    secret: false,
    provider: "lattice",
    placeholder: "https://your-workspace.latticehq.com",
    help: "Auto-populated by the bookmarklet — the workspace subdomain where your session lives.",
  },
  {
    key: "LATTICE_ME_FIELD",
    label: "Lattice viewer field",
    secret: false,
    provider: "lattice",
    placeholder: "me / viewer / currentUser",
    help: "Auto-populated by the bookmarklet after introspecting Lattice's schema.",
  },
];

const SECRET_KEYS = new Set(SECRET_SCHEMA.map((f) => f.key));

const SECRETS_FILE = path.join(
  process.env.DATA_REPO_PATH ? path.resolve(process.env.DATA_REPO_PATH) : process.cwd(),
  "secrets.local.json",
);

type SecretsFile = Record<string, string>;

async function readSecrets(): Promise<SecretsFile> {
  try {
    const raw = await fs.readFile(SECRETS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as SecretsFile;
    return {};
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function writeSecrets(next: SecretsFile): Promise<void> {
  // Filter to known keys only, drop empty strings.
  const filtered: SecretsFile = {};
  for (const [k, v] of Object.entries(next)) {
    if (!SECRET_KEYS.has(k)) continue;
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    filtered[k] = trimmed;
  }
  const body = JSON.stringify(filtered, null, 2) + "\n";
  await fs.writeFile(SECRETS_FILE, body, { mode: 0o600 });
  // Ensure mode even if the file already existed with looser perms.
  try {
    await fs.chmod(SECRETS_FILE, 0o600);
  } catch {
    // best-effort
  }
}

/**
 * Merge secrets file into process.env. Values in the file take precedence
 * over anything already in the environment — the settings UI is the
 * source of truth once used. Call this at the top of ingest runs and
 * anywhere else adapters may be invoked.
 */
export async function applySecretsToEnv(): Promise<void> {
  const secrets = await readSecrets();
  for (const [k, v] of Object.entries(secrets)) {
    if (SECRET_KEYS.has(k) && typeof v === "string" && v) {
      process.env[k] = v;
    }
  }
}

function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}${"•".repeat(Math.min(12, value.length - 8))}${value.slice(-4)}`;
}

export interface SecretView {
  key: string;
  label: string;
  secret: boolean;
  provider: Provider;
  kind: FieldKind;
  placeholder?: string;
  help?: string;
  isSet: boolean;
  /** Masked preview for secret fields; full value for non-secret fields. Empty when unset. */
  preview: string;
}

/**
 * Load the current secrets in a form safe to send to the browser:
 *   - secret fields → masked preview only
 *   - non-secret fields (URLs, usernames) → full value
 */
export async function getSecretsView(): Promise<SecretView[]> {
  const secrets = await readSecrets();
  return SECRET_SCHEMA.map((field) => {
    const raw = secrets[field.key] ?? "";
    const isSet = raw.length > 0;
    const preview = isSet ? (field.secret ? mask(raw) : raw) : "";
    return {
      key: field.key,
      label: field.label,
      secret: field.secret,
      provider: field.provider,
      kind: field.kind ?? "text",
      placeholder: field.placeholder,
      help: field.help,
      isSet,
      preview,
    };
  });
}

/**
 * Update secrets. Only keys present in `updates` are changed. Empty string
 * clears a key. Unknown keys are ignored.
 */
export async function updateSecrets(updates: Record<string, string>): Promise<void> {
  const current = await readSecrets();
  const next: SecretsFile = { ...current };
  for (const [k, v] of Object.entries(updates)) {
    if (!SECRET_KEYS.has(k)) continue;
    if (typeof v !== "string") continue;
    if (v.trim() === "") {
      delete next[k];
    } else {
      next[k] = v.trim();
    }
  }
  await writeSecrets(next);
  // Reflect immediately so the current process picks up new values without
  // waiting for the next ingest.
  await applySecretsToEnv();
}
