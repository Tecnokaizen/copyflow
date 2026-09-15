import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { membershipRoleLabel } from "@/lib/auth/membership-roles";
import {
  headerDisplayName,
  headerIdentityFromContext,
  headerRoleLabel,
  initialsFromDisplayName,
} from "./identity";

describe("initialsFromDisplayName", () => {
  it("uses first and last words for a full name", () => {
    assert.equal(initialsFromDisplayName("Usuario de prueba"), "UP");
    assert.equal(initialsFromDisplayName("Ana López"), "AL");
  });

  it("uses the first two letters of a single word", () => {
    assert.equal(initialsFromDisplayName("Rubén"), "RU");
    assert.equal(initialsFromDisplayName("A"), "A");
  });

  it("falls back for empty names", () => {
    assert.equal(initialsFromDisplayName("   "), "?");
    assert.equal(initialsFromDisplayName(""), "?");
  });
});

describe("headerRoleLabel", () => {
  it("uses the shared membership labels", () => {
    assert.equal(headerRoleLabel("owner"), membershipRoleLabel("owner"));
    assert.equal(headerRoleLabel("admin"), membershipRoleLabel("admin"));
    assert.equal(headerRoleLabel("manager"), membershipRoleLabel("manager"));
    assert.equal(headerRoleLabel("staff"), membershipRoleLabel("staff"));
    assert.equal(headerRoleLabel("viewer"), membershipRoleLabel("viewer"));
    assert.equal(headerRoleLabel("manager"), "Responsable");
  });

  it("returns a fallback for unknown roles", () => {
    assert.equal(headerRoleLabel("unknown"), "Rol desconocido");
    assert.equal(headerRoleLabel(null), "Rol desconocido");
  });
});

describe("headerDisplayName", () => {
  it("prefers the linked team member name, then full name, then email", () => {
    assert.equal(
      headerDisplayName({
        teamMemberName: "Usuario de prueba",
        fullName: "Nombre de perfil",
        email: "user@example.com",
      }),
      "Usuario de prueba"
    );
    assert.equal(
      headerDisplayName({
        teamMemberName: null,
        fullName: "Nombre de perfil",
        email: "user@example.com",
      }),
      "Nombre de perfil"
    );
    assert.equal(
      headerDisplayName({
        teamMemberName: "  ",
        fullName: null,
        email: "user@example.com",
      }),
      "user@example.com"
    );
  });

  it("falls back to Usuario when nothing is available", () => {
    assert.equal(headerDisplayName({}), "Usuario");
  });
});

describe("headerIdentityFromContext", () => {
  it("builds initials, name and header role from context", () => {
    const identity = headerIdentityFromContext({
      user: { email: "ana@example.com", full_name: "Ana Perfil" },
      membership: { role: "staff" },
      team_member: { id: "tm-1", name: "Usuario de prueba" },
    });

    assert.equal(identity?.name, "Usuario de prueba");
    assert.equal(identity?.email, "ana@example.com");
    assert.equal(identity?.role, "staff");
    assert.equal(identity?.roleLabel, "Personal");
    assert.equal(identity?.initials, "UP");
  });

  it("uses email when there is no team member or full name", () => {
    const identity = headerIdentityFromContext({
      user: { email: "solo@example.com" },
      membership: { role: "manager" },
      team_member: null,
    });

    assert.equal(identity?.name, "solo@example.com");
    assert.equal(identity?.roleLabel, "Responsable");
  });

  it("returns null when context is missing", () => {
    assert.equal(headerIdentityFromContext(null), null);
    assert.equal(headerIdentityFromContext({ error: "denied" }), null);
  });
});
