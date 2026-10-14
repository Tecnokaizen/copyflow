import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  MIGRATIONS_DIR,
  blockingFindings,
  checkMigrationChanges,
  migrationVersion,
  scanMigrationSql,
} from "./migration-guard";

const root = path.join(import.meta.dirname, "../..");
const existing = readdirSync(path.join(root, MIGRATIONS_DIR))
  .filter((name) => name.endsWith(".sql"))
  .map((name) => MIGRATIONS_DIR + name);

function rules(sql: string) {
  return scanMigrationSql("x.sql", sql).map((f) => `${f.rule}${f.waived ? ":waived" : ""}`);
}

describe("migration guard: immutability and ordering", () => {
  const base = ["supabase/migrations/20261014120000_files.sql"];
  const newFile = "supabase/migrations/20261020100000_next.sql";

  it("allows a new, later, additive migration", () => {
    const findings = checkMigrationChanges(
      [{ status: "A", path: newFile }],
      base,
      () => "create table public.t (id uuid primary key);\nalter table public.t enable row level security;"
    );
    assert.deepEqual(findings, []);
  });

  it("rejects modified, deleted and renamed applied migrations", () => {
    const findings = checkMigrationChanges(
      [
        { status: "M", path: base[0] },
        { status: "D", path: base[0] },
        { status: "R087", path: newFile, previousPath: base[0] },
      ],
      base,
      () => ""
    );
    assert.deepEqual(
      findings.map((f) => f.rule),
      ["immutable-migration", "immutable-migration", "immutable-migration"]
    );
    assert.equal(findings[2].file, base[0]);
  });

  it("rejects out-of-order and badly named migrations", () => {
    const findings = checkMigrationChanges(
      [
        { status: "A", path: "supabase/migrations/20261001000000_backdated.sql" },
        { status: "A", path: "supabase/migrations/fix.sql" },
      ],
      base,
      () => "select 1;"
    );
    assert.deepEqual(findings.map((f) => f.rule), ["migration-order", "migration-name"]);
  });

  it("ignores rollbacks and other paths", () => {
    const findings = checkMigrationChanges(
      [{ status: "M", path: "supabase/rollbacks/20261014120000_files.sql" }],
      base,
      () => "drop table public.t;"
    );
    assert.deepEqual(findings, []);
  });

  it("every existing migration is named and versioned uniquely", () => {
    const versions = existing.map(migrationVersion);
    assert.equal(versions.includes(null), false, "unnamed migration");
    assert.equal(new Set(versions).size, versions.length, "duplicate migration version");
  });
});

describe("migration guard: destructive statements", () => {
  it("flags destructive DDL and data deletion", () => {
    assert.deepEqual(rules("drop table public.orders;"), ["destructive-ddl"]);
    assert.deepEqual(rules("ALTER TABLE public.orders DROP COLUMN notes;"), ["destructive-ddl"]);
    assert.deepEqual(rules("alter table public.orders rename column a to b;"), ["destructive-ddl"]);
    assert.deepEqual(rules("alter table public.orders alter column total type numeric(12,2);"), ["destructive-ddl"]);
    assert.deepEqual(rules("drop function public.f(uuid);"), ["destructive-ddl"]);
    assert.deepEqual(rules("truncate table public.orders;"), ["data-deletion"]);
    assert.deepEqual(rules("delete from public.orders where true;"), ["data-deletion"]);
    assert.deepEqual(rules("alter table public.orders disable row level security;"), ["rls-disable"]);
    assert.deepEqual(rules("alter table public.orders disable trigger all;"), ["rls-disable"]);
    assert.deepEqual(rules("grant select on public.orders to anon;"), ["public-grant"]);
    assert.deepEqual(rules("grant execute on function public.f() to public;"), ["public-grant"]);
  });

  it("scans anonymous DO blocks, which run at migration time", () => {
    assert.deepEqual(
      rules("do $$ begin execute 'x'; delete from public.orders; end $$;"),
      ["data-deletion"]
    );
  });

  it("does not flag safe statements, privilege names, comments or literals", () => {
    assert.deepEqual(
      rules(`
        -- drop table public.orders (comment only)
        /* truncate public.orders */
        revoke truncate on table public.orders from authenticated;
        grant select, insert, update, delete, truncate on table public.t to service_role;
        grant execute on function public.f(uuid) to authenticated, service_role;
        comment on table public.t is 'drop table public.t; delete from x';
        drop trigger if exists trg on public.t;
        drop index if exists public.t_idx;
        alter table public.t add column c text;
        alter table public.t enable row level security;
      `),
      []
    );
  });

  it("ignores DML inside function bodies (it runs only when called)", () => {
    assert.deepEqual(
      rules(`create or replace function public.purge(p uuid) returns void
        language plpgsql security definer set search_path to '' as $function$
        begin delete from public.order_files where id = p; end; $function$;`),
      []
    );
  });

  it("requires SECURITY DEFINER routines to pin search_path (not waivable)", () => {
    const sql = `-- release-gate: allow definer-search-path: legacy function kept as is
      create function public.f() returns int language sql security definer as $$ select 1 $$;`;
    const found = scanMigrationSql("x.sql", sql);
    assert.deepEqual(found.map((f) => f.rule).sort(), ["definer-search-path", "destructive-ddl"]);
    assert.equal(blockingFindings(found).length, 2);
    assert.deepEqual(
      rules("create function public.f() returns int as $$ select 1 $$ language sql security definer set search_path = '';"),
      []
    );
  });

  it("accepts an explicit waiver with a reason, but still reports it", () => {
    const sql = `-- release-gate: allow destructive-ddl: contract phase after Files V1.1 in Production
      drop function public.purge_expired_order_file(uuid);`;
    const found = scanMigrationSql("x.sql", sql);
    assert.equal(found.length, 1);
    assert.match(found[0].waived ?? "", /contract phase/);
    assert.equal(blockingFindings(found).length, 0);
  });

  it("rejects waivers without a meaningful reason", () => {
    const found = scanMigrationSql("x.sql", "-- release-gate: allow destructive-ddl: ok\ndrop table public.t;");
    assert.equal(blockingFindings(found).length, 2);
  });

  it("current migrations never define SECURITY DEFINER without search_path", () => {
    // Calibration: the scanner reports no definer findings on the real history.
    for (const file of existing) {
      const sql = readFileSync(path.join(root, file), "utf8");
      const definer = scanMigrationSql(file, sql).filter((f) => f.rule === "definer-search-path");
      assert.deepEqual(definer, [], file);
    }
  });
});

