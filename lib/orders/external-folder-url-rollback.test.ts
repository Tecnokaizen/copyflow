import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "../..");

describe("rollback 20260919180000_order_content_external_folder_url", () => {
  const rollback = readFileSync(
    path.join(
      root,
      "supabase/rollbacks/20260919180000_order_content_external_folder_url.sql"
    ),
    "utf8"
  );
  const forward = readFileSync(
    path.join(
      root,
      "supabase/migrations/20260919180000_order_content_external_folder_url.sql"
    ),
    "utf8"
  );

  it("restores pre-migration content RPC without external_folder_url field", () => {
    assert.match(rollback, /CREATE OR REPLACE FUNCTION public\.change_order_content_v2/);
    assert.match(
      rollback,
      /p_field not in \(\s*'title',\s*'description',\s*'notes'\s*\)/
    );
    assert.equal(rollback.includes("'external_folder_url'"), false);
    assert.match(
      rollback,
      /'title',\s*v_updated\.title,\s*'description',\s*v_updated\.description,\s*'notes',\s*v_updated\.notes/
    );
  });

  it("restores pre-migration activity function/trigger without external_folder_url", () => {
    assert.match(rollback, /CREATE OR REPLACE FUNCTION public\.tg_activity_log_order_content/);
    assert.match(
      rollback,
      /AFTER UPDATE OF title, description, notes ON public\.orders/
    );
    assert.equal(
      /AFTER UPDATE OF[^;]*external_folder_url/i.test(rollback),
      false
    );
    assert.equal(
      /field',\s*'external_folder_url'/.test(rollback),
      false
    );
    assert.match(rollback, /tenant_id cannot change with order content/);
  });

  it("does not touch data, row_version, lifecycle, kiosk, or files", () => {
    // Ignore documentation comments when asserting executable SQL.
    const executable = rollback
      .replace(/--[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    assert.equal(
      /DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN/i.test(executable),
      false
    );
    assert.equal(executable.includes("orders_bump_row_version"), false);
    assert.equal(executable.includes("tg_orders_lifecycle_guard"), false);
    assert.equal(executable.includes("archive_order"), false);
    assert.equal(/\bkiosk\b/i.test(executable), false);
    assert.equal(/\border_files\b/i.test(executable), false);
    assert.equal(/\bR2\b/.test(executable), false);
    // Header still documents the safety contract.
    assert.match(rollback, /Does NOT/);
    assert.match(rollback, /drop orders\.external_folder_url/);
  });

  it("forward migration keeps strengthened http\(s\) host validation", () => {
    assert.match(
      forward,
      /\^https\?:\/\/\[\^\[:space:\]\/\?#\]\+\(\[\/\?#\]\|\$\)/
    );
    assert.match(forward, /char_length\(v_normalized_value\) > 2048/);
  });
});
