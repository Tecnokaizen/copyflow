import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

// SUR4 E1: the post-it and work-sequence tables add more foreign keys towards
// team_members (and a second path from orders to team_members through them).
// An embed without a hint then becomes ambiguous and PostgREST answers 300
// (PGRST201). Every embed of team_members names its foreign key, and none
// pulls every column of the person.

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

// `alias:team_members(` or `team_members(` inside a select string. A
// `.from("team_members")` call is a table read, not an embed.
const EMBED = /(?<![.\w"'`])(?:[a-z_]+\s*:\s*)?team_members(![a-z_]+)?\s*\(/g;

function embeds() {
  return sources.flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return [...text.matchAll(EMBED)].map((match) => ({
      file: path.relative(root, file),
      text: match[0],
      hint: match[1] ?? null,
      columns: text.slice(match.index + match[0].length).split(")")[0].trim(),
    }));
  });
}

describe("PostgREST hints towards team_members (SUR4 E1)", () => {
  it("every team_members embed names its foreign key", () => {
    const found = embeds();
    assert.ok(found.length >= 6, "expected the order and quote assignee embeds");
    assert.deepEqual(
      found.filter((embed) => embed.hint === null).map((e) => `${e.file}: ${e.text}`),
      []
    );
  });

  it("the order assignee embeds use orders_team_member_fk", () => {
    const orderFiles = [
      "app/api/orders/route.ts",
      "app/api/orders/[id]/route.ts",
      "app/api/orders/counter/route.ts",
      "app/api/dashboard/route.ts",
      "lib/print/load-order.ts",
    ];
    for (const file of orderFiles) {
      const hints = embeds()
        .filter((embed) => embed.file === file)
        .map((embed) => embed.hint);
      assert.deepEqual(hints, ["!orders_team_member_fk"], file);
    }
  });

  it("no embed pulls every column of a person", () => {
    assert.deepEqual(
      embeds()
        .filter((embed) => embed.columns === "*")
        .map((embed) => `${embed.file}: ${embed.text}*)`),
      []
    );
  });
});
