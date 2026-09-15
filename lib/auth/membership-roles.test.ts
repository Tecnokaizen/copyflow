import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MEMBERSHIP_ROLE_LABELS,
  MEMBERSHIP_ROLES,
  membershipRoleLabel,
} from "./membership-roles";

describe("MEMBERSHIP_ROLE_LABELS", () => {
  it("maps every product role to the unified Spanish label", () => {
    assert.equal(MEMBERSHIP_ROLE_LABELS.owner, "Propietario");
    assert.equal(MEMBERSHIP_ROLE_LABELS.admin, "Administrador");
    assert.equal(MEMBERSHIP_ROLE_LABELS.manager, "Responsable");
    assert.equal(MEMBERSHIP_ROLE_LABELS.staff, "Personal");
    assert.equal(MEMBERSHIP_ROLE_LABELS.viewer, "Solo lectura");
  });

  it("does not use Encargado for manager", () => {
    assert.notEqual(MEMBERSHIP_ROLE_LABELS.manager, "Encargado");
    assert.notEqual(membershipRoleLabel("manager"), "Encargado");
  });
});

describe("membershipRoleLabel", () => {
  it("returns the shared label for every membership role", () => {
    for (const role of MEMBERSHIP_ROLES) {
      assert.equal(membershipRoleLabel(role), MEMBERSHIP_ROLE_LABELS[role]);
    }
  });

  it("returns a fallback for unknown roles", () => {
    assert.equal(membershipRoleLabel("unknown"), "Rol desconocido");
    assert.equal(membershipRoleLabel(null), "Rol desconocido");
  });
});
