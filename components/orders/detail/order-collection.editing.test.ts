import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("commercial edit races", () => {
  it("keeps collection amounts visible and blocks money actions while the order draft is open", () => {
    const fulfillment = readFileSync(
      new URL("./order-fulfillment.tsx", import.meta.url),
      "utf8"
    );
    const collection = readFileSync(
      new URL("./order-collection.tsx", import.meta.url),
      "utf8"
    );

    assert.match(fulfillment, /editing\n/);
    assert.match(collection, /canWrite && !archived && !editing/);
    assert.match(collection, /Guarda o cancela la edición para modificar el cobro/);
    assert.match(collection, /actionsEnabled && paymentOpen/);
    assert.match(collection, /actionsEnabled && totalOpen/);
    assert.match(collection, /actionsEnabled && voiding/);
  });

  it("reloads client activity after a successful client patch", () => {
    const page = readFileSync(
      new URL("../../../app/clients/[id]/page.tsx", import.meta.url),
      "utf8"
    );
    const activity = readFileSync(
      new URL("../../clients/client-activity.tsx", import.meta.url),
      "utf8"
    );

    assert.match(page, /setActivityReload\(\(current\) => current \+ 1\)/);
    assert.match(page, /reloadKey=\{activityReload\}/);
    assert.match(activity, /\[clientId, reloadKey\]/);
  });
});
