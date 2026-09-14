import { beforeAll, describe, expect, it } from "vitest";
import {
  bootstrapActor,
  createTeamMember,
  type TestActor,
} from "./helpers/bootstrap";
import { fetchAs, type AppSession } from "./helpers/app";
import { userClient } from "./helpers/supabase";

describe("D. Orders smoke (real API/RPC)", () => {
  let actor: TestActor;
  let session: AppSession;
  let clientId: string;
  let teamMemberId: string;
  let targetStatusId: string;
  let orderId: string;

  beforeAll(async () => {
    actor = await bootstrapActor();
    session = { cookies: actor.cookies, tenantSlug: actor.tenantSlug };
    teamMemberId = await createTeamMember(actor.accessToken, actor.tenantId);

    const sb = userClient(actor.accessToken);

    const { data: client } = await sb
      .from("clients")
      .insert({ tenant_id: actor.tenantId, name: "Cliente Pedido" })
      .select("id")
      .single();
    clientId = client!.id as string;

    // Pick an active, non-initial status to transition to.
    const { data: statuses } = await sb
      .from("order_statuses")
      .select("id, is_initial, active, sort_order")
      .eq("tenant_id", actor.tenantId)
      .eq("active", true)
      .order("sort_order", { ascending: true });
    const target = (statuses ?? []).find((s) => s.is_initial === false);
    targetStatusId = target!.id as string;
  });

  it("1. creates an order", async () => {
    const res = await fetchAs(session, "/api/orders", {
      method: "POST",
      body: JSON.stringify({
        title: "Pedido Smoke",
        client_id: clientId,
        priority: "high",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.order?.id).toBeTruthy();
    expect(body.order?.reference).toBeTruthy();
    orderId = body.order.id;
  });

  it("2. lists orders including the new one", async () => {
    const res = await fetchAs(session, "/api/orders");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.orders.map((o: { id: string }) => o.id)).toContain(orderId);
  });

  it("3. opens the order", async () => {
    const res = await fetchAs(session, `/api/orders/${orderId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order.id).toBe(orderId);
  });

  it("4. changes the order status", async () => {
    const res = await fetchAs(session, `/api/orders/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify({ status_id: targetStatusId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("5. changes the responsible team member", async () => {
    const res = await fetchAs(session, `/api/orders/${orderId}/details`, {
      method: "PATCH",
      body: JSON.stringify({
        field: "assigned_team_member_id",
        value: teamMemberId,
      }),
    });
    expect(res.status).toBe(200);
  });

  it("6. persists the changes", async () => {
    const res = await fetchAs(session, `/api/orders/${orderId}`);
    const body = await res.json();
    expect(body.order.status_id).toBe(targetStatusId);
    expect(body.order.assigned_team_member_id).toBe(teamMemberId);
  });

  it("7. records the status change in the activity log", async () => {
    const res = await fetchAs(session, `/api/orders/${orderId}/activity`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBeGreaterThan(0);
    const raw = JSON.stringify(body.activity);
    // The status transition must be reflected in the activity trail.
    expect(raw).toContain(targetStatusId);
  });

  it("8 + 9. adds a note that shows up in the activity log", async () => {
    const note = `Nota smoke ${Date.now()}`;
    const patch = await fetchAs(session, `/api/orders/${orderId}/content`, {
      method: "PATCH",
      body: JSON.stringify({ field: "notes", value: note }),
    });
    expect(patch.status).toBe(200);

    const res = await fetchAs(session, `/api/orders/${orderId}/activity`);
    const body = await res.json();
    expect(JSON.stringify(body.activity)).toContain(note);
  });
});
