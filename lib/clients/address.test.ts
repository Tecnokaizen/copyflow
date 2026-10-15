import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLIENT_ADDRESS_MAX_CHARS, parseClientPayload } from "./payload";
import { clientToForm, EMPTY_CLIENT_FORM, mapClientSummary, toClientPayload } from "./types";
import { CLIENT_ADDRESS_UNAVAILABLE, writeClient } from "./write-rpc";

const base = { name: "Cliente", email: "c@example.test" };

function fakeRpc(missing: string[] = []) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      async rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        if (missing.includes(fn)) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}` } };
        return { data: { client: { id: "c1", address: args.p_address ?? null } }, error: null };
      },
    },
  };
}

describe("client address (#101)", () => {
  it("parses the address as optional, trimmed, nullable and bounded", () => {
    const absent = parseClientPayload(base);
    assert.equal(absent.ok && "address" in absent.data, false, "absent key means: keep the stored address");
    for (const [value, expected] of [[null, null], ["   ", null], ["  Calle 1  ", "Calle 1"]] as const) {
      const parsed = parseClientPayload({ ...base, address: value });
      assert.equal(parsed.ok && parsed.data.address, expected);
    }
    assert.equal(parseClientPayload({ ...base, address: "x".repeat(CLIENT_ADDRESS_MAX_CHARS) }).ok, true);
    assert.equal(parseClientPayload({ ...base, address: "x".repeat(CLIENT_ADDRESS_MAX_CHARS + 1) }).ok, false);
    assert.equal(parseClientPayload({ ...base, address: 12 }).ok, false);
  });

  it("only sends the address when the form actually knows it", () => {
    assert.equal(EMPTY_CLIENT_FORM.address, "", "new clients show the field");
    assert.deepEqual(toClientPayload({ ...EMPTY_CLIENT_FORM, name: "A", address: " Calle 2 " }).address, "Calle 2");
    assert.equal(toClientPayload({ ...EMPTY_CLIENT_FORM, name: "A", address: "" }).address, null);
    const unknown = { ...EMPTY_CLIENT_FORM, name: "A" };
    delete unknown.address;
    assert.equal("address" in toClientPayload(unknown), false, "a form without the field never clears it");
  });

  it("keeps 'not loaded' distinct from 'no address' when mapping clients", () => {
    const row = { id: "c1", name: "A", customer_type_id: null, contact_name: null, company_name: null, tax_id: null, email: null, phone: null, notes: null };
    assert.equal("address" in mapClientSummary(row)!, false);
    assert.equal(mapClientSummary({ ...row, address: null })!.address, null);
    assert.equal(mapClientSummary({ ...row, address: "Calle 3" })!.address, "Calle 3");
    assert.equal("address" in clientToForm(mapClientSummary(row)!), false);
    assert.equal(clientToForm(mapClientSummary({ ...row, address: null })!).address, "");
  });

  it("uses v1 unless an address must be stored, and never drops one silently", async () => {
    let rpc = fakeRpc();
    await writeClient(rpc.client, "update", { p_client_id: "c1" }, undefined);
    await writeClient(rpc.client, "create", { p_name: "A" }, null);
    await writeClient(rpc.client, "create", { p_name: "A" }, "Calle 4");
    await writeClient(rpc.client, "update", { p_client_id: "c1" }, null);
    assert.deepEqual(rpc.calls.map((call) => call.fn), ["update_client", "create_client", "create_client_v2", "update_client_v2"]);
    assert.equal(rpc.calls[2].args.p_address, "Calle 4");
    assert.equal(rpc.calls[3].args.p_address, null);

    rpc = fakeRpc(["create_client_v2", "update_client_v2"]);
    const cleared = await writeClient(rpc.client, "update", { p_client_id: "c1" }, null);
    assert.equal(cleared.error, null, "nothing to store: falls back to v1 before the migration");
    assert.deepEqual(rpc.calls.map((call) => call.fn), ["update_client_v2", "update_client"]);
    const lost = await writeClient(rpc.client, "create", { p_name: "A" }, "Calle 5");
    assert.equal(lost.error?.code, CLIENT_ADDRESS_UNAVAILABLE);
    assert.equal(rpc.calls.at(-1)?.fn, "create_client_v2", "no v1 write that would lose the address");
  });
});
