import { beforeAll, describe, expect, it } from "vitest";
import { bootstrapActor, type TestActor } from "./helpers/bootstrap";
import { fetchAs, type AppSession } from "./helpers/app";

describe("E. Clients smoke (real API)", () => {
  let a: TestActor;
  let b: TestActor;
  let sessionA: AppSession;
  let sessionB: AppSession;
  let clientId: string;

  beforeAll(async () => {
    a = await bootstrapActor();
    b = await bootstrapActor();
    sessionA = { cookies: a.cookies, tenantSlug: a.tenantSlug };
    sessionB = { cookies: b.cookies, tenantSlug: b.tenantSlug };
  });

  it("creates a client", async () => {
    const res = await fetchAs(sessionA, "/api/clients", {
      method: "POST",
      body: JSON.stringify({ name: "Cliente Smoke E" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    clientId = body.client?.id;
    expect(clientId).toBeTruthy();
  });

  it("lists clients including the new one", async () => {
    const res = await fetchAs(sessionA, "/api/clients");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clients.map((c: { id: string }) => c.id)).toContain(clientId);
  });

  it("retrieves the client detail", async () => {
    const res = await fetchAs(sessionA, `/api/clients/${clientId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.client.id).toBe(clientId);
    expect(body.client.name).toBe("Cliente Smoke E");
  });

  it("does not leak the client to another tenant", async () => {
    const res = await fetchAs(sessionB, `/api/clients/${clientId}`);
    expect(res.status).not.toBe(200);
  });
});
