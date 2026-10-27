import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

// R5 (20261022120000): public.orders only changes through controlled RPCs.
// The database refuses direct UPDATEs; this keeps the app from growing one.

const root = path.join(import.meta.dirname, "../..");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : walk(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

const sources = ["app", "lib", "components"].flatMap((dir) =>
  walk(path.join(root, dir))
);

// `.from("orders")` followed by a mutating call in the same builder chain.
const DIRECT_WRITE =
  /\.from\(\s*["'`]orders["'`]\s*\)(?:(?!\.from\()[\s\S]){0,400}?\.(update|upsert|delete)\s*\(/g;

// The columns 20261022120000 grants for INSERT to authenticated.
const INSERT_GRANT = [
  "id",
  "tenant_id",
  "title",
  "description",
  "client_id",
  "service_id",
  "assigned_team_member_id",
  "status_id",
  "entry_channel_id",
  "order_context_id",
  "store_id",
  "priority",
  "due_at",
  "notes",
  "file_status_id",
  "created_by",
];

describe("orders direct write guard (R5)", () => {
  it("app code never updates, upserts or deletes orders directly", () => {
    const offenders = sources.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [...text.matchAll(DIRECT_WRITE)].map(
        (match) => `${path.relative(root, file)}: .${match[1]}()`
      );
    });
    assert.deepEqual(offenders, []);
  });

  it("the only direct insert is POST /api/orders, within the granted columns", () => {
    const inserters = sources.filter((file) =>
      /\.from\(\s*["'`]orders["'`]\s*\)\s*\.insert\(/.test(readFileSync(file, "utf8"))
    );
    assert.deepEqual(
      inserters.map((file) => path.relative(root, file)),
      ["app/api/orders/route.ts"]
    );

    const route = readFileSync(path.join(root, "app/api/orders/route.ts"), "utf8");
    const body = /\.from\("orders"\)\s*\.insert\(\{([\s\S]*?)\}\)/.exec(route)?.[1];
    assert.ok(body, "POST /api/orders insert payload not found");
    const columns = [...body.matchAll(/^\s*([a-z_]+)\s*[:,]/gm)].map((m) => m[1]);
    assert.ok(columns.length > 0);
    const outside = columns.filter((column) => !INSERT_GRANT.includes(column));
    assert.deepEqual(outside, [], "extend the INSERT grant in a migration first");
  });

  it("the migration grants exactly these INSERT columns", () => {
    const migration = readFileSync(
      path.join(root, "supabase/migrations/20261022120000_order_direct_write_guard_v1.sql"),
      "utf8"
    );
    const grant = /grant insert \(([\s\S]*?)\) on table public\.orders to authenticated/.exec(
      migration
    )?.[1];
    assert.ok(grant);
    assert.deepEqual(
      grant.split(",").map((column) => column.trim()),
      INSERT_GRANT
    );
  });
});
