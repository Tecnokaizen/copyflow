import { execSync } from "node:child_process";

export type SmokeConfig = {
  supabaseUrl: string;
  /** Client-facing key (publishable/anon) — same role the app uses in the browser. */
  clientKey: string;
  /** Service-role key — ONLY for controlled test setup/teardown, never for RLS checks. */
  serviceRoleKey: string;
  appBaseUrl: string;
};

let cached: SmokeConfig | null = null;

function parseEnvBlock(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) {
      map.set(match[1], match[2].replace(/^"(.*)"$/, "$1"));
    }
  }
  return map;
}

/**
 * Resolve local Supabase connection details.
 * Prefers explicit env vars (set by `npm run smoke`); falls back to
 * `supabase status -o env` so the suite also works when run directly.
 */
export function getConfig(): SmokeConfig {
  if (cached) {
    return cached;
  }

  const appBaseUrl = process.env.SMOKE_APP_BASE_URL || "http://localhost:3000";

  let supabaseUrl = process.env.SMOKE_SUPABASE_URL || "";
  let clientKey = process.env.SMOKE_SUPABASE_KEY || "";
  let serviceRoleKey = process.env.SMOKE_SUPABASE_SERVICE_ROLE_KEY || "";

  if (!supabaseUrl || !clientKey || !serviceRoleKey) {
    let status: Map<string, string>;
    try {
      const raw = execSync("supabase status -o env", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      status = parseEnvBlock(raw);
    } catch {
      throw new Error(
        "Could not resolve Supabase config. Start the environment " +
          "(bash scripts/cloud-agent-start.sh) or run via `npm run smoke`.",
      );
    }

    supabaseUrl = supabaseUrl || status.get("API_URL") || "http://127.0.0.1:54321";
    clientKey =
      clientKey ||
      status.get("PUBLISHABLE_KEY") ||
      status.get("ANON_KEY") ||
      "";
    serviceRoleKey = serviceRoleKey || status.get("SERVICE_ROLE_KEY") || "";
  }

  if (!supabaseUrl || !clientKey || !serviceRoleKey) {
    throw new Error("Incomplete Supabase config (missing URL or keys).");
  }

  cached = { supabaseUrl, clientKey, serviceRoleKey, appBaseUrl };
  return cached;
}
