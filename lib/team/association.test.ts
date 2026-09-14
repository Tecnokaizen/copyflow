import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canWriteOrders } from "@/lib/auth/membership-roles";
import { parseAccessPatchPayload } from "@/lib/access/payload";
import {
  accessUsersAvailableForMember,
  evaluateLinkChange,
  teamMembersAvailableForUser,
} from "./link";
import { formatOperativeProfile } from "./operative-profile";
import { assignedGestcopyUser } from "./assigned-user";
import { resolveMineQueryScope } from "@/lib/orders/mine";

const MEMBER_A = "11111111-1111-4111-8111-111111111111";
const MEMBER_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

describe("operative profile and Gestcopy user are independent", () => {
  it("allows a team_member without a Gestcopy user", () => {
    const member = { id: MEMBER_A, name: "Clara Ruiz", user_id: null };
    assert.equal(member.user_id, null);
    assert.equal(assignedGestcopyUser(member, []), null);
  });

  it("allows a Gestcopy user without a team_member", () => {
    const users = [
      {
        user_id: USER_A,
        full_name: "Rubén",
        email: "cuentas@tecnokaizen.com",
        role: "owner",
        active: true,
        team_member_id: null,
      },
    ];
    assert.equal(formatOperativeProfile(null), "Sin asociar");
    assert.equal(
      accessUsersAvailableForMember(users, MEMBER_A)[0]?.user_id,
      USER_A
    );
  });

  it("allows a Gestcopy user linked to one team_member", () => {
    const result = evaluateLinkChange({
      targetMemberId: MEMBER_A,
      sessionTenantId: TENANT_A,
      userId: USER_A,
      membership: { tenantId: TENANT_A, userId: USER_A, active: true },
      existingLinkMemberId: null,
    });
    assert.deepEqual(result, { ok: true, userId: USER_A });
  });

  it("rejects a second association for the same user", () => {
    const result = evaluateLinkChange({
      targetMemberId: MEMBER_B,
      sessionTenantId: TENANT_A,
      userId: USER_A,
      membership: { tenantId: TENANT_A, userId: USER_A, active: true },
      existingLinkMemberId: MEMBER_A,
    });
    assert.deepEqual(result, { ok: false, code: "already_linked" });
  });

  it("rejects a cross-tenant association", () => {
    const result = evaluateLinkChange({
      targetMemberId: MEMBER_A,
      sessionTenantId: TENANT_A,
      userId: USER_A,
      membership: { tenantId: TENANT_B, userId: USER_A, active: true },
      existingLinkMemberId: null,
    });
    assert.deepEqual(result, { ok: false, code: "tenant_mismatch" });
  });

  it("does not change the operative profile when only the access role changes", () => {
    const parsed = parseAccessPatchPayload({
      action: "change_role",
      role: "admin",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.action, "change_role");
    assert.equal("team_member_id" in parsed, false);
    assert.equal("job_title" in parsed, false);
    assert.equal("department" in parsed, false);

    const profile = {
      name: "Jesús",
      job_title: "Producción",
      department: "Taller",
    };
    assert.equal(
      formatOperativeProfile(profile),
      "Jesús · Producción · Taller"
    );
  });

  it("does not change the access role when the operative profile changes", () => {
    const accessRole = "staff";
    const afterProfileEdit = {
      role: accessRole,
      job_title: "Encargado de taller",
    };
    assert.equal(afterProfileEdit.role, "staff");
  });

  it("lets owner and staff create orders without an operative profile", () => {
    assert.equal(canWriteOrders("owner"), true);
    assert.equal(canWriteOrders("staff"), true);
    assert.equal(canWriteOrders("manager"), true);
    assert.equal(canWriteOrders("admin"), true);
    assert.equal(canWriteOrders("viewer"), false);
  });

  it("scopes Mis pedidos only to the session operative profile", () => {
    assert.deepEqual(
      resolveMineQueryScope({
        tenantId: TENANT_A,
        sessionTeamMemberId: null,
        requestedAssigneeId: MEMBER_B,
        requestedTenantId: TENANT_B,
      }),
      { tenantId: TENANT_A, assignedTeamMemberId: null }
    );
    assert.deepEqual(
      resolveMineQueryScope({
        tenantId: TENANT_A,
        sessionTeamMemberId: MEMBER_A,
        requestedAssigneeId: MEMBER_B,
      }),
      { tenantId: TENANT_A, assignedTeamMemberId: MEMBER_A }
    );
  });

  it("rejects assigning a revoked Gestcopy user", () => {
    const result = evaluateLinkChange({
      targetMemberId: MEMBER_A,
      sessionTenantId: TENANT_A,
      userId: USER_A,
      membership: { tenantId: TENANT_A, userId: USER_A, active: false },
      existingLinkMemberId: null,
    });
    assert.deepEqual(result, { ok: false, code: "membership_inactive" });
  });

  it("hides team_members already linked to another user", () => {
    const available = teamMembersAvailableForUser(
      [
        { id: MEMBER_A, name: "Rubén", user_id: USER_A, active: true },
        { id: MEMBER_B, name: "Clara", user_id: USER_B, active: true },
        {
          id: "33333333-3333-4333-8333-333333333333",
          name: "Hugo",
          user_id: null,
          active: true,
        },
      ],
      USER_A
    );
    assert.deepEqual(
      available.map((member) => member.name),
      ["Rubén", "Hugo"]
    );
  });
});
