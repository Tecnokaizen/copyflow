import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveVoiceDue } from "@/lib/ai/voice-orders/resolve-due";

describe("resolveVoiceDue", () => {
  it("resolves mañana a las 10 in Europe/Madrid", () => {
    const now = new Date("2026-10-12T12:00:00.000Z");
    const result = resolveVoiceDue(
      {
        kind: "relative_days",
        date: null,
        offset_days: 1,
        weekday: null,
        week_offset: null,
        time: "10:00",
        expression: "mañana a las 10",
      },
      now,
      "Europe/Madrid"
    );

    assert.equal(result.field.status, "proposed");
    if (result.field.status === "proposed") {
      assert.equal(result.field.value.civil_date, "2026-10-13");
      assert.equal(result.field.value.time, "10:00");
      assert.match(result.field.value.due_at_iso, /2026-10-13T08:00:00\.000Z/);
    }
  });

  it("returns partial when time is missing", () => {
    const now = new Date("2026-10-12T12:00:00.000Z");
    const result = resolveVoiceDue(
      {
        kind: "relative_days",
        date: null,
        offset_days: 1,
        weekday: null,
        week_offset: null,
        time: null,
        expression: "mañana",
      },
      now,
      "Europe/Madrid"
    );

    assert.equal(result.field.status, "partial");
    assert.ok(result.warnings.some((warning) => warning.code === "missing_time"));
  });

  it("rejects nonexistent DST spring-forward hour", () => {
    const now = new Date("2026-03-20T12:00:00.000Z");
    const result = resolveVoiceDue(
      {
        kind: "absolute",
        date: "2026-03-29",
        offset_days: null,
        weekday: null,
        week_offset: null,
        time: "02:30",
        expression: "29 de marzo a las 2:30",
      },
      now,
      "Europe/Madrid"
    );

    assert.equal(result.field.status, "rejected");
    if (result.field.status === "rejected") {
      assert.equal(result.field.reason, "nonexistent_local_time");
    }
  });
});
