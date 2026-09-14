import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseInvitationCreatePayload } from "./payload";
import {
  PERSONAL_STATUS_LINKED,
  PERSONAL_STATUS_UNLINKED,
  personalStatusLabel,
  planAcceptedPersonalCard,
} from "./invitation-personal";
import { resolveMineQueryScope } from "@/lib/orders/mine";
import { parseAccessPatchPayload } from "./payload";
import { evaluateLinkChange } from "@/lib/team/link";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER_A = "11111111-1111-4111-8111-111111111111";
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

describe("invitation with Añadir también a Personal", () => {
  it("accepts a named invitation with the checkbox on", () => {
    const parsed = parseInvitationCreatePayload({
      name: " Jesús ",
      email: "jesus@sur4.es",
      role: "staff",
      add_to_personal: true,
    });
    assert.deepEqual(parsed, {
      ok: true,
      name: "Jesús",
      email: "jesus@sur4.es",
      role: "staff",
      add_to_personal: true,
    });
  });

  it("defaults the checkbox to true when omitted", () => {
    const parsed = parseInvitationCreatePayload({
      email: "jesus@sur4.es",
      role: "admin",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.add_to_personal, true);
    assert.equal(parsed.name, null);
  });

  it("keeps access-only invitations when the checkbox is off", () => {
    const parsed = parseInvitationCreatePayload({
      name: "Auditor",
      email: "auditor@sur4.es",
      role: "viewer",
      add_to_personal: false,
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.add_to_personal, false);
    assert.equal(parsed.role, "viewer");
  });

  it("still rejects owner", () => {
    assert.equal(
      parseInvitationCreatePayload({
        name: "Dueño",
        email: "owner@sur4.es",
        role: "owner",
        add_to_personal: true,
      }).ok,
      false
    );
  });
});

describe("accept invitation personal card", () => {
  it("creates a linked team_member with the invited name and keeps the role", () => {
    const card = planAcceptedPersonalCard({
      addToPersonal: true,
      invitationName: "Jesús",
      profileName: "jesus",
      email: "jesus@sur4.es",
      existingLinkedMemberId: null,
    });
    assert.deepEqual(card, {
      action: "create",
      name: "Jesús",
      email: "jesus@sur4.es",
      active: true,
      canReceiveOrders: true,
    });
  });

  it("falls back to the account name when the invitation has no name", () => {
    const card = planAcceptedPersonalCard({
      addToPersonal: true,
      invitationName: null,
      profileName: "Jesús López",
      email: "jesus@sur4.es",
      existingLinkedMemberId: null,
    });
    assert.equal(card.action, "create");
    if (card.action !== "create") return;
    assert.equal(card.name, "Jesús López");
  });

  it("does not create a team_member when the checkbox is off", () => {
    const card = planAcceptedPersonalCard({
      addToPersonal: false,
      invitationName: "Consultor",
      profileName: "Consultor",
      email: "consultor@sur4.es",
      existingLinkedMemberId: null,
    });
    assert.deepEqual(card, { action: "none" });
  });

  it("does not duplicate an already linked team_member", () => {
    const card = planAcceptedPersonalCard({
      addToPersonal: true,
      invitationName: "Jesús",
      profileName: "Jesús",
      email: "jesus@sur4.es",
      existingLinkedMemberId: MEMBER_A,
    });
    assert.deepEqual(card, { action: "none" });
  });

  it("does not silently match an unlinked Personal card by email", () => {
    const card = planAcceptedPersonalCard({
      addToPersonal: true,
      invitationName: "Jesús",
      profileName: "Jesús",
      email: "jesus@sur4.es",
      existingLinkedMemberId: null,
      unlinkedMemberIdWithSameEmail: "99999999-9999-4999-8999-999999999999",
    });
    assert.equal(card.action, "create");
    if (card.action !== "create") return;
    assert.equal("teamMemberId" in card, false);
  });

  it("lets that linked user use Mis pedidos", () => {
    const card = planAcceptedPersonalCard({
      addToPersonal: true,
      invitationName: "Jesús",
      profileName: null,
      email: "jesus@sur4.es",
      existingLinkedMemberId: null,
    });
    assert.equal(card.action, "create");
    const scope = resolveMineQueryScope({
      tenantId: TENANT_A,
      sessionTeamMemberId: MEMBER_A,
      requestedAssigneeId: null,
    });
    assert.equal(scope.assignedTeamMemberId, MEMBER_A);
    assert.equal(scope.tenantId, TENANT_A);
  });
});

describe("role and Personal stay independent", () => {
  it("does not touch team_member when changing the access role", () => {
    const parsed = parseAccessPatchPayload({
      action: "change_role",
      role: "manager",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal("team_member_id" in parsed, false);
  });

  it("does not touch the access role when linking Personal", () => {
    const result = evaluateLinkChange({
      targetMemberId: MEMBER_A,
      sessionTenantId: TENANT_A,
      userId: USER_A,
      membership: { tenantId: TENANT_A, userId: USER_A, active: true },
      existingLinkMemberId: null,
    });
    assert.deepEqual(result, { ok: true, userId: USER_A });
    assert.equal("role" in result, false);
  });

  it("keeps tenant isolation when linking Personal", () => {
    const result = evaluateLinkChange({
      targetMemberId: MEMBER_A,
      sessionTenantId: TENANT_A,
      userId: USER_B,
      membership: { tenantId: TENANT_B, userId: USER_B, active: true },
      existingLinkMemberId: null,
    });
    assert.deepEqual(result, { ok: false, code: "tenant_mismatch" });
  });
});

describe("Usuarios y permisos Personal status", () => {
  it("shows En Personal when linked and Sin ficha de Personal otherwise", () => {
    assert.equal(personalStatusLabel({ id: MEMBER_A, name: "Jesús" }), PERSONAL_STATUS_LINKED);
    assert.equal(personalStatusLabel(null), PERSONAL_STATUS_UNLINKED);
  });
});
