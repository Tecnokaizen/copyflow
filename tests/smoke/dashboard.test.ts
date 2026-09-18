import { beforeAll, describe, expect, it } from "vitest";
import { bootstrapActor, type TestActor } from "./helpers/bootstrap";
import { fetchAs, type AppSession } from "./helpers/app";

describe("F. Dashboard smoke (real API)", () => {
  let actor: TestActor;
  let session: AppSession;

  beforeAll(async () => {
    actor = await bootstrapActor();
    session = { cookies: actor.cookies, tenantSlug: actor.tenantSlug };
  });

  it("responds without errors and returns a valid KPI structure", async () => {
    const res = await fetchAs(session, "/api/dashboard");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.tenant).toBe(actor.tenantSlug);

    // KPI counts: present and numeric (avoid brittle exact values).
    expect(body.counts).toBeTruthy();
    for (const key of [
      "active",
      "urgent",
      "overdue",
      "due_today",
      "upcoming",
      "needs_attention",
    ]) {
      expect(typeof body.counts[key], `counts.${key}`).toBe("number");
    }

    // attention_orders must not regress: always a (possibly empty) array.
    expect(Array.isArray(body.attention_orders)).toBe(true);
    expect(Array.isArray(body.upcoming_orders)).toBe(true);
    expect(body.workload).toBeTruthy();
    expect(Array.isArray(body.workload.members)).toBe(true);
  });
});
