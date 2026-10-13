import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { collectionFailure, preferredOrderVersion } from "@/lib/orders/collection";

describe("order total concurrency token", () => {
  it("uses the newer ficha version when the cobro snapshot is stale", () => {
    assert.equal(preferredOrderVersion("5", "6"), "6");
  });

  it("keeps a cobro version that is already ahead of the ficha", () => {
    assert.equal(preferredOrderVersion("7", "6"), "7");
  });

  it("ignores a missing or malformed live version", () => {
    assert.equal(preferredOrderVersion("6", null), "6");
    assert.equal(preferredOrderVersion("6", "6e0"), "6");
  });

  it("returns the current row version when the total save conflicts", () => {
    assert.deepEqual(collectionFailure("conflict", "6"), {
      status: 409,
      error: "El pedido cambió. Recarga la ficha e inténtalo de nuevo.",
      row_version: "6",
    });
  });

  it("does not attach a version to a real total guard failure", () => {
    assert.deepEqual(collectionFailure("total_below_paid", "6"), {
      status: 422,
      error: "El total no puede quedar por debajo de lo ya entregado.",
    });
  });
});

describe("order total save wiring", () => {
  it("sends the live ficha version and keeps the server version after a conflict", () => {
    const fulfillment = readFileSync(
      new URL("../../components/orders/detail/order-fulfillment.tsx", import.meta.url),
      "utf8"
    );
    const collection = readFileSync(
      new URL("../../components/orders/detail/order-collection.tsx", import.meta.url),
      "utf8"
    );
    const route = readFileSync(
      new URL("../../app/api/orders/[id]/total/route.ts", import.meta.url),
      "utf8"
    );

    assert.match(fulfillment, /orderVersion=\{order\.version\}/);
    assert.match(collection, /preferredOrderVersion/);
    assert.match(collection, /body\.row_version/);
    assert.match(route, /collectionFailure\(payload\.error, payload\.row_version\)/);
  });
});
