import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

describe("voice orders security contracts", () => {
  it("AI routes never write orders or use service_role", () => {
    const root = path.join(process.cwd(), "app/api/ai");
    const files = walk(root);
    assert.ok(files.length > 0);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes('.from("orders")'), false, file);
      assert.equal(source.includes('"/api/orders"'), false, file);
      assert.equal(source.includes("service_role"), false, file);
      assert.equal(source.includes("SERVICE_ROLE"), false, file);
      assert.match(source, /server-only|requireVoiceOrdersAccess|operationalJson/);
    }
  });

  it("AI code only reads tables and calls the ledger and lookup RPCs", () => {
    const files = [
      ...walk(path.join(process.cwd(), "app/api/ai")),
      ...walk(path.join(process.cwd(), "lib/ai")),
    ].filter((file) => !file.endsWith(".test.ts"));
    const allowedRpcs = new Set([
      "ai_reserve_usage",
      "ai_settle_usage",
      "ai_voice_status",
      "search_clients",
    ]);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.equal(/\.(insert|update|upsert|delete)\(/.test(source), false, file);
      assert.equal(/\.from\("orders"\)/.test(source), false, file);
      for (const match of source.matchAll(/\.rpc\(\s*"([a-z0-9_]+)"/g)) {
        assert.ok(allowedRpcs.has(match[1]), `${file} calls rpc ${match[1]}`);
      }
    }
  });

  it("no NEXT_PUBLIC AI or OpenAI secrets", () => {
    const envFiles = [
      ".env",
      ".env.local",
      ".env.example",
      "README.md",
    ];
    for (const relative of envFiles) {
      const full = path.join(process.cwd(), relative);
      try {
        const source = readFileSync(full, "utf8");
        assert.equal(/NEXT_PUBLIC_.*OPENAI|NEXT_PUBLIC_AI_/.test(source), false);
      } catch {
        /* optional */
      }
    }

    const packageJson = readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    assert.equal(packageJson.includes('"openai"'), false);
    assert.equal(packageJson.includes('"zod"'), false);
  });
});
