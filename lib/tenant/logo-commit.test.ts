import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commitLogoRemoval, commitLogoReplacement } from "./logo-commit";

const previous = "branding/tenant/logo/old";
const next = "branding/tenant/logo/new";

describe("organization logo persistence order", () => {
  it("cleans the new object when the settings update fails and keeps the previous reference", async () => {
    const removed: string[] = [];
    const result = await commitLogoReplacement({
      newKey: next,
      save: async () => {
        throw new Error("update failed");
      },
      remove: async (key) => {
        removed.push(key);
      },
      warn: () => {
        throw new Error("warning is not a failure");
      },
    });
    assert.equal(result, "save_failed");
    assert.deepEqual(removed, [next]);
  });

  it("keeps the new object and the successful update when deleting the previous object fails", async () => {
    const removed: string[] = [];
    const warnings: string[] = [];
    let authoritative = previous;
    const result = await commitLogoReplacement({
      newKey: next,
      save: async () => {
        authoritative = next;
        return { previousKey: previous };
      },
      remove: async (key) => {
        removed.push(key);
        throw new Error("r2 delete failed");
      },
      warn: (message) => warnings.push(message),
    });
    assert.equal(result, "saved");
    assert.equal(authoritative, next);
    assert.deepEqual(removed, [previous]);
    assert.deepEqual(warnings, ["previous logo cleanup failed"]);
  });

  it("does not delete the stored object when clearing settings fails", async () => {
    const removed: string[] = [];
    const result = await commitLogoRemoval({
      currentKey: previous,
      save: async () => {
        throw new Error("update failed");
      },
      remove: async (key) => {
        removed.push(key);
      },
      warn: () => undefined,
    });
    assert.equal(result, "save_failed");
    assert.deepEqual(removed, []);
  });

  it("keeps settings without a logo when the object cleanup fails", async () => {
    const warnings: string[] = [];
    let authoritative: string | null = previous;
    const result = await commitLogoRemoval({
      currentKey: previous,
      save: async () => {
        authoritative = null;
      },
      remove: async () => {
        throw new Error("r2 delete failed");
      },
      warn: (message) => warnings.push(message),
    });
    assert.equal(result, "cleared");
    assert.equal(authoritative, null);
    assert.deepEqual(warnings, ["logo object cleanup failed"]);
  });
});
