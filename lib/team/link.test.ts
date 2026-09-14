import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accessUsersAvailableForMember,
  evaluateLinkChange,
  parseLinkBody,
} from "./link";

const MEMBER_A = "11111111-1111-4111-8111-111111111111";
const MEMBER_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

describe("parseLinkBody", () => {
  it("accepts an explicit user_id uuid", () => {
    assert.deepEqual(parseLinkBody({ user_id: USER_A }), {
      ok: true,
      userId: USER_A,
    });
  });

  it("accepts null to unlink", () => {
    assert.deepEqual(parseLinkBody({ user_id: null }), {
      ok: true,
      userId: null,
    });
  });

  it("rejects missing, empty or non-uuid values", () => {
    assert.equal(parseLinkBody({}).ok, false);
    assert.equal(parseLinkBody({ user_id: "" }).ok, false);
    assert.equal(parseLinkBody({ user_id: "not-a-uuid" }).ok, false);
    assert.equal(parseLinkBody({ user_id: "Ana" }).ok, false);
    assert.equal(parseLinkBody(null).ok, false);
  });
});

describe("evaluateLinkChange", () => {
  it("unlinks without requiring a membership", () => {
    const result = evaluateLinkChange({
      targetMemberId: MEMBER_A,
      sessionTenantId: TENANT_A,
      userId: null,
      membership: null,
      existingLinkMemberId: null,
    });

    assert.deepEqual(result, { ok: true, userId: null });
  });

  it("links when the membership exists in the same tenant", () => {
    const result = evaluateLinkChange({
      targetMemberId: MEMBER_A,
      sessionTenantId: TENANT_A,
      userId: USER_A,
      membership: { tenantId: TENANT_A, userId: USER_A, active: true },
      existingLinkMemberId: null,
    });

    assert.deepEqual(result, { ok: true, userId: USER_A });
  });

  it("is idempotent when the same team_member already has that user", () => {
    const result = evaluateLinkChange({
      targetMemberId: MEMBER_A,
      sessionTenantId: TENANT_A,
      userId: USER_A,
      membership: { tenantId: TENANT_A, userId: USER_A, active: true },
      existingLinkMemberId: MEMBER_A,
    });

    assert.deepEqual(result, { ok: true, userId: USER_A });
  });

  it("rejects linking a user already bound to another team_member", () => {
    const result = evaluateLinkChange({
      targetMemberId: MEMBER_B,
      sessionTenantId: TENANT_A,
      userId: USER_A,
      membership: { tenantId: TENANT_A, userId: USER_A, active: true },
      existingLinkMemberId: MEMBER_A,
    });

    assert.deepEqual(result, { ok: false, code: "already_linked" });
  });

  it("rejects a user without membership in the tenant", () => {
    const result = evaluateLinkChange({
      targetMemberId: MEMBER_A,
      sessionTenantId: TENANT_A,
      userId: USER_A,
      membership: null,
      existingLinkMemberId: null,
    });

    assert.deepEqual(result, { ok: false, code: "membership_missing" });
  });

  it("rejects a membership from another tenant", () => {
    const result = evaluateLinkChange({
      targetMemberId: MEMBER_A,
      sessionTenantId: TENANT_A,
      userId: USER_A,
      membership: { tenantId: TENANT_B, userId: USER_A, active: true },
      existingLinkMemberId: null,
    });

    assert.deepEqual(result, { ok: false, code: "tenant_mismatch" });
  });
});

describe("accessUsersAvailableForMember", () => {
  it("hides users already linked to a different team_member", () => {
    const available = accessUsersAvailableForMember(
      [
        {
          user_id: USER_A,
          full_name: "Ana",
          email: "ana@example.com",
          role: "staff",
          active: true,
          team_member_id: MEMBER_A,
        },
        {
          user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          full_name: "Luis",
          email: "luis@example.com",
          role: "staff",
          active: true,
          team_member_id: MEMBER_B,
        },
        {
          user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          full_name: "Marta",
          email: "marta@example.com",
          role: "manager",
          active: true,
          team_member_id: null,
        },
      ],
      MEMBER_A
    );

    assert.deepEqual(
      available.map((user) => user.full_name),
      ["Ana", "Marta"]
    );
  });
});
