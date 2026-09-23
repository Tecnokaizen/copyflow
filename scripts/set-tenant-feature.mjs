#!/usr/bin/env node
// Idempotent tenant feature override. Local database only.
// Usage: node scripts/set-tenant-feature.mjs --tenant sur4 --feature quotes --enabled true

import { spawnSync } from "node:child_process";

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    return null;
  }

  return process.argv[index + 1];
}

const tenant = arg("--tenant");
const feature = arg("--feature");
const enabled = arg("--enabled");
const databaseUrl = process.env.DATABASE_URL;

if (!tenant || !feature || (enabled !== "true" && enabled !== "false") || !databaseUrl) {
  console.error(
    "Usage: DATABASE_URL=postgresql://... node scripts/set-tenant-feature.mjs --tenant <slug> --feature <code> --enabled true|false"
  );
  process.exit(1);
}

let host = "";
try {
  host = new URL(databaseUrl).hostname;
} catch {
  console.error("DATABASE_URL is not a valid URL");
  process.exit(1);
}

if (host !== "127.0.0.1" && host !== "localhost") {
  console.error("Refusing non-local database. This script does not change Production.");
  process.exit(1);
}

if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenant) || !/^[a-z0-9_]+$/.test(feature)) {
  console.error("Invalid tenant slug or feature code");
  process.exit(1);
}

const sql = `select public.set_tenant_feature('${tenant}', '${feature}', ${enabled}, null);`;
const result = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", sql], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
