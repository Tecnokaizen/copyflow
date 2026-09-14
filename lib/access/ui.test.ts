import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAccessListResponse } from "./ui";

describe("parseAccessListResponse", () => {
  it("keeps an explicit team_member link and defaults missing team_members", () => {
    const parsed = parseAccessListResponse({
      tenant: { id: "t1", name: "SUR4", slug: "sur4" },
      memberships: [
        {
          user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          full_name: "Ana",
          email: "ana@example.com",
          role: "staff",
          active: true,
          team_member: { id: "tm-1", name: "Ana López" },
        },
      ],
      invitations: [],
    });

    assert.equal(parsed?.memberships[0]?.team_member?.name, "Ana López");
    assert.deepEqual(parsed?.team_members, []);
  });

  it("does not invent a team_member from email or name", () => {
    const parsed = parseAccessListResponse({
      tenant: { id: "t1", name: "SUR4", slug: "sur4" },
      memberships: [
        {
          user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          full_name: "Ana López",
          email: "ana@example.com",
          role: "staff",
          active: true,
        },
      ],
      invitations: [],
    });

    assert.equal(parsed?.memberships[0]?.team_member, null);
  });
});
