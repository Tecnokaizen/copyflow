import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kioskUnavailableResponse } from "./unavailable-response";

describe("kioskUnavailableResponse", () => {
  it("returns a real HTTP 404 with neutral copy", async () => {
    const response = kioskUnavailableResponse();
    assert.equal(response.status, 404);
    assert.match(
      response.headers.get("content-type") ?? "",
      /text\/html/
    );
    const body = await response.text();
    assert.match(body, /Kiosk no disponible/);
    assert.equal(body.includes("tenant"), false);
    assert.equal(body.includes("opt-in"), false);
    assert.equal(body.includes("sur4"), false);
  });
});
