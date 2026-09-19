import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "../..");

describe("GET /api/orders/[id] client cold-load", () => {
  it("selects the client fields the ficha already renders", () => {
    const source = readFileSync(
      path.join(root, "app/api/orders/[id]/route.ts"),
      "utf8"
    );

    assert.match(source, /client:clients\(/);
    assert.match(source, /customer_type_id/);
    assert.match(source, /contact_name/);
    assert.match(source, /company_name/);
    assert.match(source, /tax_id/);
    assert.match(source, /email/);
    assert.match(source, /phone/);
    assert.match(source, /notes/);
    assert.match(source, /active/);
    assert.equal(source.includes("clients(*)"), false);
    assert.match(source, /\.eq\("tenant_id", context\.tenant\.id\)/);
  });
});

describe("PATCH /api/orders/[id]/content external_folder_url", () => {
  it("accepts external_folder_url and normalizes via shared helper", () => {
    const source = readFileSync(
      path.join(root, "app/api/orders/[id]/content/route.ts"),
      "utf8"
    );
    assert.match(source, /external_folder_url/);
    assert.match(source, /normalizeExternalFolderUrl/);
    assert.match(source, /change_order_content_v2/);
    assert.match(source, /p_expected_version/);
    assert.match(source, /p_tenant_id: context\.tenant\.id/);
  });
});
