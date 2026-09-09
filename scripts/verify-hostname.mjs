/**
 * Local verification for hostname tenant resolver.
 * Run: npx tsx --tsconfig tsconfig.json scripts/verify-hostname.mjs
 */
import assert from "node:assert/strict";
import { getSubdomainFromHostname } from "../lib/tenant/hostname.ts";

const originalNodeEnv = process.env.NODE_ENV;

function withNodeEnv(env, fn) {
  process.env.NODE_ENV = env;
  try {
    fn();
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
}

function expectSlug(hostname, expected, label) {
  const actual = getSubdomainFromHostname(hostname);
  assert.equal(
    actual,
    expected,
    `${label}: ${hostname} => ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`
  );
  console.log(`PASS ${label} ${hostname} => ${JSON.stringify(expected)}`);
}

withNodeEnv("production", () => {
  expectSlug("prueba-final.app.gestcopy.com", "prueba-final", "prod");
  expectSlug("app.gestcopy.com", null, "prod");
  expectSlug("sur4.copyflow.com", null, "prod");
  expectSlug("prueba-final.localhost", null, "prod-no-local");
  expectSlug("prueba-final.localhost:3000", null, "prod-no-local-port");
});

withNodeEnv("development", () => {
  expectSlug("prueba-final.localhost", "prueba-final", "dev");
  expectSlug("sur4.localhost", "sur4", "dev");
  expectSlug("demo.localhost", "demo", "dev");
  expectSlug("localhost", null, "dev");
  expectSlug("foo.bar.localhost", null, "dev");
  expectSlug("app.localhost", null, "dev");
  expectSlug("prueba-final.localhost:3000", "prueba-final", "dev-port");
  expectSlug("prueba-final.app.gestcopy.com", "prueba-final", "dev-prod-host");
  expectSlug("app.gestcopy.com", null, "dev-apex");
  expectSlug("sur4.copyflow.com", null, "dev-legacy");
});

console.log("PASS scripts/verify-hostname.mjs");
