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

  it("sends only email and role, not a team member", () => {
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
    assert.equal("name" in ok, false);
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
  it("maps the accepted membership role without a team member", () => {
    const mapped = mapAcceptInvitationResult({
      tenant: { id: "t1", name: "SUR4", slug: "sur4" },
      membership: { role: "manager", active: true },
    });
    assert.equal(mapped?.membership.role, "manager");
    assert.equal(mapped?.membership.active, true);
    assert.equal("team_member" in (mapped?.membership ?? {}), false);
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
