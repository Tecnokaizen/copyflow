import { beforeAll, describe, expect, it } from "vitest";
import { bootstrapActor, type TestActor } from "./helpers/bootstrap";
import { serviceClient, userClient } from "./helpers/supabase";

/**
 * Multi-tenant isolation via RLS. Assertions use each user's REAL JWT (the same
 * PostgREST auth context the app uses). Service-role is used ONLY to verify the
 * underlying DB state after a blocked write — never to check isolation itself.
 */
describe("C. RLS multi-tenant isolation", () => {
  let a: TestActor;
  let b: TestActor;
  let clientA: string;
  let clientB: string;

  async function createClientFor(actor: TestActor, name: string): Promise<string> {
    const { data, error } = await userClient(actor.accessToken).rpc(
      "create_client",
      {
        p_tenant_id: actor.tenantId,
        p_customer_type_id: null,
        p_name: name,
        p_contact_name: null,
        p_company_name: null,
        p_tax_id: null,
        p_email: null,
        p_phone: null,
        p_notes: null,
      },
    );
    expect(error, `create_client for ${name}`).toBeNull();
    const client = (data as { client?: { id?: string } })?.client ?? data;
    const id = (client as { id?: string })?.id;
    expect(id).toBeTruthy();
    return id as string;
  }

  beforeAll(async () => {
    a = await bootstrapActor();
    b = await bootstrapActor();
    clientA = await createClientFor(a, "Cliente Tenant A");
    clientB = await createClientFor(b, "Cliente Tenant B");
  });

  it("each user can read their own tenant data", async () => {
    const { data: da } = await userClient(a.accessToken)
      .from("clients")
      .select("id")
      .eq("id", clientA);
    expect(da?.map((r) => r.id)).toContain(clientA);

    const { data: db } = await userClient(b.accessToken)
      .from("clients")
      .select("id")
      .eq("id", clientB);
    expect(db?.map((r) => r.id)).toContain(clientB);
  });

  it("user A cannot read tenant B private data (and vice versa)", async () => {
    const aReadsB = await userClient(a.accessToken)
      .from("clients")
      .select("id")
      .eq("tenant_id", b.tenantId);
    expect(aReadsB.error).toBeNull();
    expect(aReadsB.data).toHaveLength(0);

    const aReadsBById = await userClient(a.accessToken)
      .from("clients")
      .select("id")
      .eq("id", clientB);
    expect(aReadsBById.data).toHaveLength(0);

    const bReadsA = await userClient(b.accessToken)
      .from("clients")
      .select("id")
      .eq("id", clientA);
    expect(bReadsA.data).toHaveLength(0);
  });

  it("user A cannot modify tenant B resources (and vice versa)", async () => {
    const svc = serviceClient();

    const attemptA = await userClient(a.accessToken)
      .from("clients")
      .update({ name: "HACKED BY A" })
      .eq("id", clientB)
      .select("id");
    expect(attemptA.error).toBeNull();
    expect(attemptA.data ?? []).toHaveLength(0);

    const attemptB = await userClient(b.accessToken)
      .from("clients")
      .update({ name: "HACKED BY B" })
      .eq("id", clientA)
      .select("id");
    expect(attemptB.data ?? []).toHaveLength(0);

    // Verify (service-role, setup/inspection only) that nothing changed.
    const { data: rowB } = await svc
      .from("clients")
      .select("name")
      .eq("id", clientB)
      .single();
    expect(rowB?.name).toBe("Cliente Tenant B");

    const { data: rowA } = await svc
      .from("clients")
      .select("name")
      .eq("id", clientA)
      .single();
    expect(rowA?.name).toBe("Cliente Tenant A");
  });
});
