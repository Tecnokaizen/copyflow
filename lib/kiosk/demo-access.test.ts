import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { canOpenKioskDemo } from "./demo-access";

describe("kiosk demo settings access", () => {
  it("shows the shortcut only to owner and admin", () => {
    assert.equal(canOpenKioskDemo("owner"), true);
    assert.equal(canOpenKioskDemo("admin"), true);

    for (const role of ["manager", "staff", "viewer", null, undefined] as const) {
      assert.equal(canOpenKioskDemo(role), false);
    }
  });

  it("opens the same-host kiosk in a new tab from settings", () => {
    const page = readFileSync("app/settings/page.tsx", "utf8");

    assert.match(page, /canOpenKioskDemo/);
    assert.match(page, /Kiosk · Demo/);
    assert.match(
      page,
      /href="\/kiosk"[\s\S]*target="_blank"[\s\S]*rel="noopener noreferrer"/
    );
    assert.doesNotMatch(
      readFileSync("components/app-nav.tsx", "utf8"),
      /Kiosk · Demo/
    );
    assert.doesNotMatch(
      readFileSync("lib/nav/items.ts", "utf8"),
      /Kiosk · Demo/
    );
  });
});
