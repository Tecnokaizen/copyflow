import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const serverOnlyStub = path.join(root, "tests/stubs/server-only.ts");

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: { "@": root, "server-only": serverOnlyStub },
        },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: {
          alias: { "@": root },
        },
        test: {
          name: "integration",
          include: ["tests/smoke/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/smoke/setup/global.ts"],
          setupFiles: ["tests/smoke/setup/after-all.ts"],
          hookTimeout: 90_000,
          testTimeout: 60_000,
        },
      },
    ],
  },
});
