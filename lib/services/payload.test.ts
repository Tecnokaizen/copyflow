import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { canWriteServices } from "@/lib/auth/membership-roles";
import { parseServicePayload } from "./payload";
import { formToServicePayload, type ServiceFormData } from "./types";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

const basePayload = {
  category_id: null,
  name: "Copias A4",
  description: null,
  standard_lead_time_minutes: 60,
  requires_file: false,
  requires_design: false,
  requires_quote: false,
  active: true,
  sort_order: 1,
};

describe("parseServicePayload", () => {
  it("accepts the Settings V1 allowlist", () => {
    assert.deepEqual(parseServicePayload(basePayload), {
      ok: true,
      data: basePayload,
    });
  });

  it("rejects tenant_id, metadata and unknown fields", () => {
    assert.equal(
      parseServicePayload({
        ...basePayload,
        tenant_id: "11111111-1111-4111-8111-111111111111",
      }).ok,
      false
    );
    assert.equal(
      parseServicePayload({
        ...basePayload,
        metadata: { forged: true },
      }).ok,
      false
    );
    assert.equal(
      parseServicePayload({
        ...basePayload,
        extra: "nope",
      }).ok,
      false
    );
  });

  it("rejects negative lead time and empty name", () => {
    assert.equal(
      parseServicePayload({
        ...basePayload,
        standard_lead_time_minutes: -1,
      }).ok,
      false
    );
    assert.equal(
      parseServicePayload({
        ...basePayload,
        name: "   ",
      }).ok,
      false
    );
  });

  it("accepts object lead-time shape used by older clients", () => {
    assert.deepEqual(
      parseServicePayload({
        ...basePayload,
        standard_lead_time_minutes: { value: "2", unit: "hours" },
      }),
      {
        ok: true,
        data: {
          ...basePayload,
          standard_lead_time_minutes: 120,
        },
      }
    );
  });

  it("formToServicePayload stays within the API allowlist", () => {
    const form: ServiceFormData = {
      category_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Gran formato",
      description: "Plotter",
      lead_time_value: "1",
      lead_time_unit: "days",
      requires_file: true,
      requires_design: false,
      requires_quote: true,
      active: true,
      sort_order: "3",
    };

    const parsed = formToServicePayload(form);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    assert.deepEqual(Object.keys(parsed.data).sort(), [
      "active",
      "category_id",
      "description",
      "name",
      "requires_design",
      "requires_file",
      "requires_quote",
      "sort_order",
      "standard_lead_time_minutes",
    ]);
    assert.equal(parseServicePayload(parsed.data as never).ok, true);
  });
});

describe("services write authorization and routes", () => {
  const listRoute = readSource("app/api/services/route.ts");
  const patchRoute = readSource("app/api/services/[id]/route.ts");
  const categoriesRoute = readSource("app/api/services/categories/route.ts");
  const page = readSource("app/services/page.tsx");
  const migration = readSource(
    "supabase/migrations/20260921170000_services_catalog_harden_v1.sql"
  );

  it("allows owner/admin/manager and rejects staff/viewer for writes", () => {
    for (const role of ["owner", "admin", "manager"] as const) {
      assert.equal(canWriteServices(role), true);
    }
    for (const role of ["staff", "viewer"] as const) {
      assert.equal(canWriteServices(role), false);
    }
  });

  it("POST/PATCH use canWriteServices, server tenant and no DELETE", () => {
    assert.match(listRoute, /canWriteServices/);
    assert.match(listRoute, /getCurrentContext/);
    assert.match(listRoute, /context\.tenant\.id/);
    assert.match(listRoute, /create_service/);
    assert.equal(/export async function DELETE/.test(listRoute), false);

    assert.match(patchRoute, /canWriteServices/);
    assert.match(patchRoute, /update_service/);
    assert.match(patchRoute, /p_tenant_id: context\.tenant\.id/);
    assert.equal(/export async function DELETE/.test(patchRoute), false);
  });

  it("categories endpoint only returns active categories for selection", () => {
    assert.match(categoriesRoute, /service_categories/);
    assert.match(categoriesRoute, /eq\("active", true\)/);
    assert.equal(categoriesRoute.includes(".insert("), false);
    assert.equal(categoriesRoute.includes(".update("), false);
  });

  it("services page gates write UI with canWriteServices", () => {
    assert.match(page, /canWriteServices/);
  });

  it("migration enforces tenant immutability and tenant-aware category FK", () => {
    assert.match(migration, /tg_services_immutable_tenant/);
    assert.match(migration, /service_tenant_immutable/);
    assert.match(migration, /services_tenant_category_fkey/);
    assert.match(migration, /references public\.service_categories \(tenant_id, id\)/);
    assert.match(migration, /on delete restrict/);
  });
});
