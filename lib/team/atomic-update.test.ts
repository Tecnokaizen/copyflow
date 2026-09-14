import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateLinkChange } from "./link";
import {
  applyAtomicTeamMemberPatch,
  updateTeamMemberRpcParams,
} from "./atomic-update";

const MEMBER_A = "11111111-1111-4111-8111-111111111111";
const MEMBER_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_A = "tenant-a";

describe("team member form update is atomic", () => {
  it("si la asociación falla, no se persiste ningún otro cambio del formulario", () => {
    const stored = {
      name: "Rubén",
      job_title: "Taller",
      department: "Producción",
      email: "old@taller.test",
      phone: "600000000",
      active: true,
      can_receive_orders: true,
      user_id: null as string | null,
    };
    const snapshot = { ...stored };

    const form = {
      name: "Rubén López",
      job_title: "Administrador",
      department: "Gestión",
      email: "nuevo@taller.test",
      phone: "611111111",
      active: false,
      can_receive_orders: false,
      user_id: USER_A,
    };

    const link = evaluateLinkChange({
      targetMemberId: MEMBER_A,
      sessionTenantId: TENANT_A,
      userId: USER_A,
      membership: { tenantId: TENANT_A, userId: USER_A, active: true },
      existingLinkMemberId: MEMBER_B,
    });

    const result = applyAtomicTeamMemberPatch(stored, form, link);

    assert.equal(link.ok, false);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "already_linked");
    assert.deepEqual(result.next, snapshot);
    assert.deepEqual(stored, snapshot);
  });

  it("persists every form field together when the association is valid", () => {
    const stored = {
      name: "Rubén",
      job_title: "Taller",
      department: "Producción",
      email: null as string | null,
      phone: null as string | null,
      active: true,
      can_receive_orders: true,
      user_id: null as string | null,
    };

    const form = {
      name: "Rubén",
      job_title: "Administrador",
      department: "Gestión",
      email: "cuentas@tecnokaizen.com",
      phone: "600000000",
      active: true,
      can_receive_orders: true,
      user_id: USER_A,
    };

    const link = evaluateLinkChange({
      targetMemberId: MEMBER_A,
      sessionTenantId: TENANT_A,
      userId: USER_A,
      membership: { tenantId: TENANT_A, userId: USER_A, active: true },
      existingLinkMemberId: null,
    });

    const result = applyAtomicTeamMemberPatch(stored, form, link);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.next, form);
  });

  it("sends the complete form in a single RPC payload", () => {
    const params = updateTeamMemberRpcParams({
      teamMemberId: MEMBER_A,
      tenantId: TENANT_A,
      payload: {
        name: "Rubén",
        job_title: "Administrador",
        department: "Gestión",
        email: "cuentas@tecnokaizen.com",
        phone: "600000000",
        active: true,
        can_receive_orders: true,
        user_id: USER_A,
      },
    });

    assert.deepEqual(Object.keys(params).sort(), [
      "p_active",
      "p_can_receive_orders",
      "p_department",
      "p_email",
      "p_job_title",
      "p_name",
      "p_phone",
      "p_team_member_id",
      "p_tenant_id",
      "p_user_id",
    ]);
    assert.equal(params.p_user_id, USER_A);
    assert.equal(params.p_job_title, "Administrador");
    assert.equal(params.p_email, "cuentas@tecnokaizen.com");
  });
});
