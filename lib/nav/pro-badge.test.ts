import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { navStructureForRole } from "./items";
import { proEarlyAccessBadge, proEarlyAccessBadgeIsActive } from "./pro-badge";

describe("Pro early access header label", () => {
  it("shows the full and short labels only once the context reports the program", () => {
    assert.deepEqual(proEarlyAccessBadge({ ready: true, proEarlyAccess: true }), {
      href: "/pro",
      label: "Pro · Acceso anticipado",
      shortLabel: "Pro · Anticipado",
    });
    assert.equal(proEarlyAccessBadge({ ready: false, proEarlyAccess: true }), null);
    assert.equal(proEarlyAccessBadge({ ready: true, proEarlyAccess: false }), null);
  });

  it("marks only /pro as current", () => {
    assert.equal(proEarlyAccessBadgeIsActive("/pro"), true);
    assert.equal(proEarlyAccessBadgeIsActive("/pro/"), true);
    assert.equal(proEarlyAccessBadgeIsActive("/"), false);
    assert.equal(proEarlyAccessBadgeIsActive("/products"), false);
    assert.equal(proEarlyAccessBadgeIsActive("/settings/billing"), false);
  });

  it("leaves the role and quotes navigation untouched", () => {
    for (const role of ["owner", "admin", "manager", "staff", "viewer", null]) {
      for (const quotes of [true, false]) {
        const entries = JSON.stringify(navStructureForRole(role, { quotes }));
        assert.equal(entries.includes("/pro"), false);
      }
    }
    const labels = (role: string, quotes: boolean) =>
      navStructureForRole(role, { quotes }).map((entry) =>
        entry.type === "link" ? entry.item.label : entry.group.label
      );
    assert.equal(labels("staff", true).includes("Presupuestos"), true);
    assert.equal(labels("viewer", true).includes("Presupuestos"), false);
    assert.equal(labels("owner", false).includes("Presupuestos"), false);
  });
});
