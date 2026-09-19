import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextListFilterForStatusSelection } from "./list-filter-status";

describe("nextListFilterForStatusSelection", () => {
  it("keeps archived when selecting a terminal status", () => {
    assert.equal(
      nextListFilterForStatusSelection({
        listFilter: "archived",
        statusIsTerminal: true,
      }),
      "archived"
    );
  });

  it("keeps archived when selecting a non-terminal status", () => {
    assert.equal(
      nextListFilterForStatusSelection({
        listFilter: "archived",
        statusIsTerminal: false,
      }),
      "archived"
    );
  });

  it("bounces active to all for terminal status", () => {
    assert.equal(
      nextListFilterForStatusSelection({
        listFilter: "active",
        statusIsTerminal: true,
      }),
      "all"
    );
  });

  it("keeps all when selecting any status", () => {
    assert.equal(
      nextListFilterForStatusSelection({
        listFilter: "all",
        statusIsTerminal: true,
      }),
      "all"
    );
    assert.equal(
      nextListFilterForStatusSelection({
        listFilter: "all",
        statusIsTerminal: false,
      }),
      "all"
    );
  });

  it("selection order does not change archived + terminal outcome", () => {
    // Status first then archived conceptually ends at archived; archived then
    // terminal status must also stay archived.
    assert.equal(
      nextListFilterForStatusSelection({
        listFilter: "archived",
        statusIsTerminal: true,
      }),
      "archived"
    );
  });
});
