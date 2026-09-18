import { beforeAll, describe, expect, it } from "vitest";
import { bootstrapActor, type TestActor } from "./helpers/bootstrap";
import { fetchAs } from "./helpers/app";
import { userClient } from "./helpers/supabase";

describe("B. Auth + tenant bootstrap", () => {
  let a: TestActor;
  let b: TestActor;

  beforeAll(async () => {
    a = await bootstrapActor();
    b = await bootstrapActor();
  });

  it("both actors get a valid session (real JWT)", () => {
    expect(a.accessToken).toBeTruthy();
    expect(b.accessToken).toBeTruthy();
    expect(a.userId).not.toBe(b.userId);
    expect(a.tenantId).not.toBe(b.tenantId);
  });

  it("each actor has exactly one active owner membership in their own tenant", async () => {
    for (const actor of [a, b]) {
      const { data, error } = await userClient(actor.accessToken)
        .from("memberships")
        .select("tenant_id, role, active");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0]).toMatchObject({
        tenant_id: actor.tenantId,
        role: "owner",
        active: true,
      });
    }
  });

  it("/api/me returns the right user, tenant and membership", async () => {
    const res = await fetchAs(
      { cookies: a.cookies, tenantSlug: a.tenantSlug },
      "/api/me",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe(a.userId);
    expect(body.memberships).toHaveLength(1);
    expect(body.memberships[0].role).toBe("owner");
    expect(body.memberships[0].tenants.slug).toBe(a.tenantSlug);
  });
});
