import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "./format";

function convertInZone(timeZone: string, local: string) {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./datetime-zone-check.ts", import.meta.url)),
      local,
    ],
    {
      env: { ...process.env, TZ: timeZone },
      encoding: "utf8",
    }
  );

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as { iso: string | null; back: string | null };
}

describe("order due_at local conversion", () => {
  it("round-trips the current zone and rejects an empty value", () => {
    assert.equal(fromDateTimeLocalValue(""), null);
    assert.equal(toDateTimeLocalValue(null), "");
    assert.equal(toDateTimeLocalValue("not-a-date"), "");

    const iso = fromDateTimeLocalValue("2026-09-23T10:30");
    assert.ok(iso);
    assert.equal(toDateTimeLocalValue(iso), "2026-09-23T10:30");
  });

  it("keeps the same local hour in Madrid winter and summer", () => {
    const winter = convertInZone("Europe/Madrid", "2026-01-15T10:30");
    assert.equal(winter.iso, "2026-01-15T09:30:00.000Z");
    assert.equal(winter.back, "2026-01-15T10:30");

    const summer = convertInZone("Europe/Madrid", "2026-07-15T10:30");
    assert.equal(summer.iso, "2026-07-15T08:30:00.000Z");
    assert.equal(summer.back, "2026-07-15T10:30");
  });

  it("round-trips unambiguous hours around the Madrid DST changes", () => {
    const springAfter = convertInZone("Europe/Madrid", "2026-03-29T03:30");
    assert.equal(springAfter.iso, "2026-03-29T01:30:00.000Z");
    assert.equal(springAfter.back, "2026-03-29T03:30");

    const missing = convertInZone("Europe/Madrid", "2026-03-29T02:30");
    assert.equal(missing.iso, null);
    assert.equal(missing.back, null);

    const autumnBefore = convertInZone("Europe/Madrid", "2026-10-25T01:30");
    assert.equal(autumnBefore.iso, "2026-10-24T23:30:00.000Z");
    assert.equal(autumnBefore.back, "2026-10-25T01:30");

    const autumnRepeated = convertInZone("Europe/Madrid", "2026-10-25T02:30");
    assert.equal(autumnRepeated.iso, "2026-10-25T00:30:00.000Z");
    assert.equal(autumnRepeated.back, "2026-10-25T02:30");

    const autumnAfter = convertInZone("Europe/Madrid", "2026-10-25T03:30");
    assert.equal(autumnAfter.iso, "2026-10-25T02:30:00.000Z");
    assert.equal(autumnAfter.back, "2026-10-25T03:30");
  });
});
