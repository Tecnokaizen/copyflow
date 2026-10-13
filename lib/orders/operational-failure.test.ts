import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sessionResumePath } from "@/lib/auth/safe-next-path";
import { userFacingCreateOrderError } from "@/lib/orders/create";
import { interpretOperationalFailure } from "@/lib/orders/operational-failure";

describe("operational session failures", () => {
  it("asks for login on 401 and does not call it a permission denial", () => {
    const failure = interpretOperationalFailure(
      401,
      { code: "SESSION_EXPIRED", error: "Session expired" },
      "order"
    );
    assert.equal(failure.message, "Tu sesión ha caducado. Inicia sesión para continuar.");
    assert.equal(failure.login, true);
    assert.equal(failure.retry, false);
    assert.notEqual(failure.message, userFacingCreateOrderError("Unauthorized or tenant access denied"));
  });

  it("keeps a real 403 as a permission denial", () => {
    const order = interpretOperationalFailure(
      403,
      { code: "TENANT_ACCESS_DENIED", error: "Unauthorized or tenant access denied" },
      "order"
    );
    const client = interpretOperationalFailure(403, { error: "Unauthorized or tenant access denied" }, "client");
    assert.equal(order.message, "No tienes permiso para crear este pedido");
    assert.equal(order.login, false);
    assert.equal(order.retry, false);
    assert.equal(client.message, "No tienes permiso para crear este cliente");
  });

  it("lets the worker retry a temporary Auth failure without signing out", () => {
    const failure = interpretOperationalFailure(
      503,
      { code: "AUTH_TEMPORARILY_UNAVAILABLE" },
      "order"
    );
    assert.equal(failure.kind, "temporary");
    assert.equal(failure.retry, true);
    assert.equal(failure.login, false);
    assert.match(failure.message, /Vuelve a intentarlo/);
    assert.equal(interpretOperationalFailure(0, null, "options").kind, "temporary");
  });

  it("returns to the order form after login and does not loop on the auth screen", () => {
    assert.equal(sessionResumePath("/orders/quick"), "/orders/quick");
    assert.equal(sessionResumePath("/orders", "?created=1"), "/orders?created=1");
    assert.equal(sessionResumePath("/auth/login"), "/orders");
    assert.equal(sessionResumePath("//evil.example"), "/orders");
  });
});
