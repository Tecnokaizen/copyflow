import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INVITE_ROLE_HELP } from "./invite-copy";
import {
  parseInvitationAcceptPayload,
  parseInvitationCreatePayload,
} from "./payload";
import { mapAcceptInvitationResult } from "./types";
import {
  DEFAULT_INVITABLE_ROLE,
  INVITABLE_ROLES,
  isInvitableRole,
  preferredInvitableRole,
} from "@/lib/auth/membership-roles";

describe("invitation create payload", () => {
  it("accepts Personal (staff)", () => {
    const parsed = parseInvitationCreatePayload({
      email: "jesus@sur4.es",
      role: "staff",
    });
    assert.deepEqual(parsed, {
      ok: true,
      email: "jesus@sur4.es",
      role: "staff",
      name: null,
      add_to_personal: true,
    });
  });

  it("accepts Administrador (admin)", () => {
    const parsed = parseInvitationCreatePayload({
      email: "admin@sur4.es",
      role: "admin",
    });
    assert.deepEqual(parsed, {
      ok: true,
      email: "admin@sur4.es",
      role: "admin",
      name: null,
      add_to_personal: true,
    });
  });

  it("accepts Encargado (manager)", () => {
    const parsed = parseInvitationCreatePayload({
      email: "encargado@sur4.es",
      role: "manager",
    });
    assert.deepEqual(parsed, {
      ok: true,
      email: "encargado@sur4.es",
      role: "manager",
      name: null,
      add_to_personal: true,
    });
  });

  it("accepts Solo lectura (viewer)", () => {
    const parsed = parseInvitationCreatePayload({
      email: "lectura@sur4.es",
      role: "viewer",
    });
    assert.deepEqual(parsed, {
      ok: true,
      email: "lectura@sur4.es",
      role: "viewer",
      name: null,
      add_to_personal: true,
    });
  });

  it("rejects owner in a normal invitation", () => {
    assert.equal(isInvitableRole("owner"), false);
    assert.equal(
      parseInvitationCreatePayload({
        email: "owner@sur4.es",
        role: "owner",
      }).ok,
      false
    );
    assert.equal(INVITABLE_ROLES.includes("owner" as never), false);
  });

  it("requires an explicit role instead of silently defaulting", () => {
    assert.equal(
      parseInvitationCreatePayload({ email: "jesus@sur4.es" }).ok,
      false
    );
    assert.equal(
      parseInvitationCreatePayload({
        email: "jesus@sur4.es",
        role: "",
      }).ok,
      false
    );
  });

  it("rejects linking a team_member_id on invite and defaults add_to_personal", () => {
    const parsed = parseInvitationCreatePayload({
      email: "jesus@sur4.es",
      role: "staff",
      team_member_id: "11111111-1111-4111-8111-111111111111",
    });
    assert.equal(parsed.ok, false);

    const ok = parseInvitationCreatePayload({
      email: "jesus@sur4.es",
      role: "staff",
    });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal("team_member_id" in ok, false);
    assert.equal(ok.name, null);
    assert.equal(ok.add_to_personal, true);
  });
});

describe("invitation UI default role", () => {
  it("defaults the invite form to Personal (staff)", () => {
    assert.equal(DEFAULT_INVITABLE_ROLE, "staff");
    assert.equal(
      preferredInvitableRole(["admin", "manager", "staff", "viewer"]),
      "staff"
    );
    assert.equal(
      preferredInvitableRole(["manager", "staff", "viewer"]),
      "staff"
    );
    assert.equal(INVITE_ROLE_HELP, "Define qué puede hacer este usuario en Gestcopy. Podrás cambiarlo más adelante.");
  });
});

describe("accept invitation keeps the chosen access role", () => {
  it("maps team_member_id when accept created a Personal card", () => {
    const mapped = mapAcceptInvitationResult({
      tenant: { id: "t1", name: "SUR4", slug: "sur4" },
      membership: { role: "staff", active: true },
      team_member_id: "11111111-1111-4111-8111-111111111111",
    });
    assert.equal(mapped?.membership.role, "staff");
    assert.equal(
      mapped?.team_member_id,
      "11111111-1111-4111-8111-111111111111"
    );
  });

  it("maps a missing team_member_id when the invite was access-only", () => {
    const mapped = mapAcceptInvitationResult({
      tenant: { id: "t1", name: "SUR4", slug: "sur4" },
      membership: { role: "viewer", active: true },
    });
    assert.equal(mapped?.membership.role, "viewer");
    assert.equal(mapped?.team_member_id ?? null, null);
  });

  it("preserves Personal, Administrador, Encargado and Solo lectura", () => {
    for (const role of INVITABLE_ROLES) {
      const mapped = mapAcceptInvitationResult({
        tenant: { id: "t1", name: "SUR4", slug: "sur4" },
        membership: { role, active: true },
      });
      assert.equal(mapped?.membership.role, role);
    }
  });

  it("accepts only the invitation token, not a team member payload", () => {
    const parsed = parseInvitationAcceptPayload({
      token: "a".repeat(64),
    });
    assert.equal(parsed.ok, true);
    assert.equal(
      parseInvitationAcceptPayload({
        token: "a".repeat(64),
        team_member_id: "11111111-1111-4111-8111-111111111111",
      }).ok,
      false
    );
  });
});
