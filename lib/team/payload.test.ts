import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTeamMemberPayload } from "./payload";
import { buildTeamMemberInsert } from "./insert";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_A = "11111111-1111-4111-8111-111111111111";

describe("parseTeamMemberPayload", () => {
  it("creates a team_member without a Gestcopy user", () => {
    const parsed = parseTeamMemberPayload({
      name: " Rubén ",
      job_title: "Administrador",
      department: "Gestión",
      email: "ruben@taller.test",
      phone: "600000000",
      active: true,
      can_receive_orders: true,
    });

    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.data, {
      name: "Rubén",
      job_title: "Administrador",
      department: "Gestión",
      email: "ruben@taller.test",
      phone: "600000000",
      active: true,
      can_receive_orders: true,
      user_id: null,
    });
  });

  it("accepts an optional Gestcopy user uuid", () => {
    const parsed = parseTeamMemberPayload({
      name: "Rubén",
      user_id: USER_A,
    });

    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.data.user_id, USER_A);
  });

  it("rejects a non-uuid user_id instead of matching by email or name", () => {
    assert.equal(
      parseTeamMemberPayload({ name: "Rubén", user_id: "cuentas@tecnokaizen.com" })
        .ok,
      false
    );
    assert.equal(
      parseTeamMemberPayload({ name: "Rubén", user_id: "Rubén" }).ok,
      false
    );
  });

  it("requires a name", () => {
    assert.equal(parseTeamMemberPayload({ name: "  " }).ok, false);
    assert.equal(parseTeamMemberPayload({}).ok, false);
  });
});

describe("buildTeamMemberInsert", () => {
  it("uses the session tenant and never a client tenant_id", () => {
    const parsed = parseTeamMemberPayload({
      name: "Rubén",
      tenant_id: "client-forged-tenant",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const insert = buildTeamMemberInsert(TENANT_A, parsed.data);
    assert.equal(insert.tenant_id, TENANT_A);
    assert.equal("tenant_id" in parsed.data, false);
  });
});
