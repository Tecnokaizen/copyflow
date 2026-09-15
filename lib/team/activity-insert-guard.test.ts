import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canRecordTeamMemberCreated } from "./activity-insert-guard";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const STAFF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("team member insert activity gate", () => {
  it("1-5. staff self-bootstrap during invitation records team_member.created", () => {
    assert.equal(
      canRecordTeamMemberCreated({
        actor: {
          id: STAFF,
          tenantId: TENANT_A,
          role: "staff",
          membershipActive: true,
          pendingSelfInvitation: true,
        },
        row: { tenantId: TENANT_A, userId: STAFF },
      }),
      true
    );
  });

  it("6. staff still cannot insert Personal arbitrarily", () => {
    assert.equal(
      canRecordTeamMemberCreated({
        actor: {
          id: STAFF,
          tenantId: TENANT_A,
          role: "staff",
          membershipActive: true,
          pendingSelfInvitation: false,
        },
        row: { tenantId: TENANT_A, userId: STAFF },
      }),
      false
    );
  });

  it("7. staff cannot bootstrap a team_member for another user", () => {
    assert.equal(
      canRecordTeamMemberCreated({
        actor: {
          id: STAFF,
          tenantId: TENANT_A,
          role: "staff",
          membershipActive: true,
          pendingSelfInvitation: true,
        },
        row: { tenantId: TENANT_A, userId: OTHER },
      }),
      false
    );
  });

  it("8. owner, admin and manager can still create Personal", () => {
    for (const role of ["owner", "admin", "manager"] as const) {
      assert.equal(
        canRecordTeamMemberCreated({
          actor: {
            id: OTHER,
            tenantId: TENANT_A,
            role,
            membershipActive: true,
            pendingSelfInvitation: false,
          },
          row: { tenantId: TENANT_A, userId: STAFF },
        }),
        true,
        role
      );
    }
  });

  it("9. UPDATE stays restricted: staff/viewer are not management", () => {
    assert.equal(
      canRecordTeamMemberCreated({
        actor: {
          id: STAFF,
          tenantId: TENANT_A,
          role: "viewer",
          membershipActive: true,
          pendingSelfInvitation: true,
        },
        row: { tenantId: TENANT_A, userId: OTHER },
      }),
      false
    );
  });

  it("10. tenant isolation blocks a foreign membership", () => {
    assert.equal(
      canRecordTeamMemberCreated({
        actor: {
          id: STAFF,
          tenantId: TENANT_B,
          role: "staff",
          membershipActive: true,
          pendingSelfInvitation: true,
        },
        row: { tenantId: TENANT_A, userId: STAFF },
      }),
      false
    );
  });

  it("viewer self-bootstrap works when Personal is marked on the invitation", () => {
    assert.equal(
      canRecordTeamMemberCreated({
        actor: {
          id: STAFF,
          tenantId: TENANT_A,
          role: "viewer",
          membershipActive: true,
          pendingSelfInvitation: true,
        },
        row: { tenantId: TENANT_A, userId: STAFF },
      }),
      true
    );
  });
});
