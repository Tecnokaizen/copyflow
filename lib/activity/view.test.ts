import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVITY_VIEW_STORAGE_KEY,
  parseActivityViewMode,
  readStoredActivityView,
} from "./view";

test("parses the persisted activity view mode safely", () => {
  assert.equal(parseActivityViewMode("grid"), "grid");
  assert.equal(parseActivityViewMode("list"), "list");
  assert.equal(parseActivityViewMode("cards"), "list");
  assert.equal(parseActivityViewMode(null), "list");
});

test("reads the persisted activity view with a list fallback", () => {
  const storage = {
    getItem(key: string) {
      assert.equal(key, ACTIVITY_VIEW_STORAGE_KEY);
      return "grid";
    },
  };

  assert.equal(readStoredActivityView(storage), "grid");
  assert.equal(readStoredActivityView(null), "list");
});
