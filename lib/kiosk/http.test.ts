import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleKioskOrderRequest } from "./http";
import { KioskServiceError } from "./service";

const VALID_BODY = {
  submission_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  contact: {
    name: "Ana",
    email: "ana@example.com",
    phone: null,
  },
  service_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  description: "Tarjetas",
  due_at: null,
  observations: null,
};

function request(body: unknown) {
  return new Request("https://demo.app.gestcopy.com/api/kiosk/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("handleKioskOrderRequest", () => {
  it("rejects invalid JSON and tenant authority", async () => {
    const submit = async () => {
      throw new Error("must not submit");
    };
    const invalidJson = await handleKioskOrderRequest(
      request("{"),
      "demo",
      submit
    );
    assert.equal(invalidJson.status, 400);

    const foreignTenant = await handleKioskOrderRequest(
      request({ ...VALID_BODY, tenant_id: "tenant-sur4" }),
      "demo",
      submit
    );
    assert.equal(foreignTenant.status, 400);
  });

  it("rejects oversized request bodies before parsing", async () => {
    const response = await handleKioskOrderRequest(
      request(JSON.stringify({ payload: "x".repeat(20_000) })),
      "demo",
      async () => {
        throw new Error("must not submit");
      }
    );
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), {
      error: "Solicitud demasiado grande",
    });
  });

  it("stops reading the stream as soon as the body limit is exceeded", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(new TextEncoder().encode("x".repeat(17_000)));
          return;
        }
        controller.error(new Error("must not read another chunk"));
      },
    });
    const streamed = new Request(
      "https://demo.app.gestcopy.com/api/kiosk/orders",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" }
    );
    const response = await handleKioskOrderRequest(
      streamed,
      "demo",
      async () => {
        throw new Error("must not submit");
      }
    );
    assert.equal(response.status, 413);
    assert.equal(pulls, 1);
  });

  it("fails closed when hostname context has no tenant", async () => {
    const response = await handleKioskOrderRequest(
      request(VALID_BODY),
      null,
      async () => {
        throw new Error("must not submit");
      }
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: "Kiosk no disponible",
    });
  });

  it("returns only a reference for create and replay", async () => {
    for (const row of [
      { replay: false, status: 201 },
      { replay: true, status: 200 },
    ]) {
      const response = await handleKioskOrderRequest(
        request(VALID_BODY),
        "demo",
        async (slug, input) => {
          assert.equal(slug, "demo");
          assert.equal(input.serviceId, VALID_BODY.service_id);
          return { ok: true, reference: "DEMO-0042", replay: row.replay };
        }
      );
      assert.equal(response.status, row.status);
      assert.deepEqual(await response.json(), {
        ok: true,
        reference: "DEMO-0042",
      });
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
  });

  it("maps safe service errors and hides unexpected details", async () => {
    const invalidService = await handleKioskOrderRequest(
      request(VALID_BODY),
      "demo",
      async () => {
        throw new KioskServiceError("invalid_configuration", 400);
      }
    );
    assert.equal(invalidService.status, 400);
    assert.deepEqual(await invalidService.json(), {
      error: "El servicio seleccionado no está disponible",
    });

    const unexpected = await handleKioskOrderRequest(
      request(VALID_BODY),
      "demo",
      async () => {
        throw new Error("postgres secret detail");
      }
    );
    assert.equal(unexpected.status, 500);
    assert.deepEqual(await unexpected.json(), {
      error: "No se pudo crear la solicitud",
    });
  });
});
