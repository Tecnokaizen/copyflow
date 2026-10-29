import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatNoteDate, noteEventLabel } from "./format";

describe("post-it dates and labels", () => {
  it("shows only the time for today and date plus time otherwise", () => {
    const now = new Date(2026, 9, 28, 18, 0);
    assert.match(formatNoteDate(new Date(2026, 9, 28, 9, 5).toISOString(), now), /^Hoy, 09:05$/);
    assert.match(formatNoteDate(new Date(2026, 9, 27, 23, 59).toISOString(), now), /^27\/10\/2026, 23:59$/);
    assert.equal(formatNoteDate(null, now), "—");
    assert.equal(formatNoteDate("not a date", now), "—");
  });

  it("names every history action in Spanish", () => {
    assert.equal(noteEventLabel("converted_from_legacy"), "la pasó desde las notas anteriores");
    assert.equal(noteEventLabel("redacted"), "suprimió el texto");
    assert.equal(noteEventLabel("unknown"), "cambió la nota");
  });
});
