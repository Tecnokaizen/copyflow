import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CHANGELOG,
  CHANGELOG_KINDS,
  changelogCounts,
  formatChangelogDate,
  formatChangelogMonth,
} from "@/lib/help/changelog";
import { allowsUnauthenticatedPath } from "@/lib/invitations/public-path";

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("public changelog", () => {
  it("lists one release per day, newest first", () => {
    assert.ok(CHANGELOG.length > 0);
    for (const release of CHANGELOG) {
      assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(
        new Date(`${release.date}T00:00:00Z`).toISOString().slice(0, 10),
        release.date
      );
    }
    for (let index = 1; index < CHANGELOG.length; index += 1) {
      assert.ok(
        CHANGELOG[index - 1].date > CHANGELOG[index].date,
        `${CHANGELOG[index - 1].date} debe ir antes que ${CHANGELOG[index].date}`
      );
    }
  });

  it("keeps every entry complete and typed", () => {
    for (const release of CHANGELOG) {
      assert.ok(release.title.trim(), release.date);
      assert.ok(release.entries.length > 0, release.date);
      for (const entry of release.entries) {
        assert.ok(CHANGELOG_KINDS.includes(entry.kind), entry.text);
        assert.ok(entry.area.trim(), entry.text);
        assert.match(entry.text, /[.…]$/, entry.text);
      }
    }
  });

  it("does not leak tenant names or technical internals", () => {
    const text = CHANGELOG.flatMap((release) => [
      release.title,
      ...release.entries.flatMap((entry) => [entry.area, entry.text]),
    ]).join("\n");
    for (const forbidden of [
      /\bSUR4\b/i,
      /\bDEMO\b/,
      /Tamara/i,
      /\btenant/i,
      /\bRLS\b/,
      /\bRPC\b/,
      /\bR2\b/,
      /Supabase/i,
      /PostgreSQL/i,
      /\/(orders|quotes|settings|counter|kiosk)\b/,
    ]) {
      assert.equal(forbidden.test(text), false, String(forbidden));
    }
  });

  it("counts entries by kind", () => {
    const counts = changelogCounts();
    const total = CHANGELOG.reduce(
      (sum, release) => sum + release.entries.length,
      0
    );
    assert.equal(
      CHANGELOG_KINDS.reduce((sum, kind) => sum + counts[kind], 0),
      total
    );
    assert.ok(counts.nuevo > 0);
    assert.ok(counts.correccion > 0);
  });

  it("formats dates in Spanish regardless of the server time zone", () => {
    assert.equal(formatChangelogDate("2026-10-15"), "15 de octubre de 2026");
    assert.equal(formatChangelogDate("2026-09-05"), "5 de septiembre de 2026");
    assert.equal(formatChangelogMonth("2026-10-01"), "Octubre de 2026");
  });

  it("is served publicly from the help center", () => {
    assert.equal(allowsUnauthenticatedPath("/ayuda/novedades"), true);
    const page = source("app/ayuda/novedades/page.tsx");
    assert.equal(page.includes("getCurrentContext"), false);
    assert.equal(page.includes("getCurrentTenant"), false);
    assert.match(page, /canonical: NOVEDADES_URL/);
    assert.match(source("components/help/help-center.tsx"), /\/ayuda\/novedades/);
    assert.match(source("app/ayuda/page.tsx"), /\/ayuda\/novedades/);
  });
});
