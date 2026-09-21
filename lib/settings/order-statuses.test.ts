import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { canManageSettingsCatalogs } from "@/lib/auth/membership-roles";
import {
  canAccessOrderStatusSettingsApi,
  nextAvailableStatusCode,
  orderStatusDomainError,
  orderStatusDomainErrorMessage,
  orderStatusKindFromFlags,
  orderStatusWriteHttpStatus,
  parseOrderStatusPayload,
  statusCodeBaseFromName,
} from "./order-statuses";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

describe("order status settings helpers", () => {
  it("derives semantic kind from lifecycle flags", () => {
    assert.equal(orderStatusKindFromFlags({ is_initial: true }), "initial");
    assert.equal(orderStatusKindFromFlags({ is_ready: true }), "ready");
    assert.equal(orderStatusKindFromFlags({ is_closed: true }), "closed");
    assert.equal(orderStatusKindFromFlags({ is_cancelled: true }), "cancelled");
    assert.equal(orderStatusKindFromFlags({}), "in_progress");
  });

  it("creates stable internal codes from tenant labels", () => {
    assert.equal(statusCodeBaseFromName("En impresión"), "en_impresion");
    assert.equal(statusCodeBaseFromName("  Listo / Recoger  "), "listo_recoger");
    assert.equal(statusCodeBaseFromName("---"), "status");
  });

  it("chooses a non-conflicting code without exposing code editing", () => {
    assert.equal(
      nextAvailableStatusCode("En proceso", ["en_proceso", "en_proceso_2"]),
      "en_proceso_3"
    );
  });

  it("accepts only safe Settings payloads and rejects is_initial / kind initial", () => {
    assert.deepEqual(
      parseOrderStatusPayload({
        name: "Diseño",
        kind: "in_progress",
        active: true,
        sort_order: 20,
      }),
      {
        ok: true,
        data: {
          name: "Diseño",
          kind: "in_progress",
          active: true,
          sort_order: 20,
        },
      }
    );

    assert.equal(
      parseOrderStatusPayload({
        name: "Recibido",
        kind: "initial",
        active: true,
        sort_order: 1,
      }).ok,
      false
    );

    assert.equal(
      parseOrderStatusPayload({
        name: "Hack",
        kind: "closed",
        active: true,
        sort_order: 1,
        is_initial: true,
      }).ok,
      false
    );

    assert.equal(
      parseOrderStatusPayload({
        name: "Hack",
        kind: "closed",
        active: true,
        sort_order: 1,
        tenant_id: "forged",
      }).ok,
      false
    );
  });

  it("maps domain errors for initial guards", () => {
    assert.equal(
      orderStatusDomainError(
        "23514",
        "initial_status_cannot_be_deactivated"
      ),
      "initial_status_cannot_be_deactivated"
    );
    assert.equal(
      orderStatusDomainError(
        "23514",
        "inactive_status_cannot_be_initial"
      ),
      "inactive_status_cannot_be_initial"
    );
    assert.equal(
      orderStatusWriteHttpStatus("initial_status_cannot_be_deactivated"),
      409
    );
    assert.equal(
      orderStatusDomainErrorMessage("initial_status_cannot_be_deactivated"),
      "initial_status_cannot_be_deactivated"
    );
  });
});

describe("order status settings authorization", () => {
  it("allows owner/admin/manager and rejects staff/viewer", () => {
    for (const role of ["owner", "admin", "manager"] as const) {
      assert.equal(canManageSettingsCatalogs(role), true);
      assert.equal(canAccessOrderStatusSettingsApi(role, true), true);
    }

    for (const role of ["staff", "viewer"] as const) {
      assert.equal(canManageSettingsCatalogs(role), false);
      assert.equal(canAccessOrderStatusSettingsApi(role, true), false);
    }

    assert.equal(canAccessOrderStatusSettingsApi("owner", false), false);
  });
});

describe("order status settings API routes", () => {
  const listRoute = readSource("app/api/order-statuses/route.ts");
  const patchRoute = readSource("app/api/order-statuses/[id]/route.ts");
  const setInitialRoute = readSource(
    "app/api/order-statuses/[id]/set-initial/route.ts"
  );
  const page = readSource("app/settings/order-statuses/page.tsx");
  const hub = readSource("app/settings/page.tsx");
  const migration = readSource(
    "supabase/migrations/20260921140000_order_status_set_initial_v1.sql"
  );

  it("POST/PATCH/set-initial gate writes with canManageSettingsCatalogs", () => {
    assert.match(listRoute, /canManageSettingsCatalogs/);
    assert.match(listRoute, /create_order_status_catalog/);
    assert.match(listRoute, /initial_status_must_use_set_initial/);

    assert.match(patchRoute, /canManageSettingsCatalogs/);
    assert.match(patchRoute, /update_order_status_catalog/);
    assert.match(patchRoute, /initial_status_must_use_set_initial/);

    assert.match(setInitialRoute, /canManageSettingsCatalogs/);
    assert.match(setInitialRoute, /set_order_status_initial/);
  });

  it("uses server tenant context and never trusts client tenant_id", () => {
    for (const source of [listRoute, patchRoute, setInitialRoute]) {
      assert.match(source, /getCurrentContext/);
      assert.match(source, /context\.tenant\.id/);
      assert.equal(source.includes("body.tenant_id"), false);
      assert.equal(source.includes("payload.tenant_id"), false);
    }
  });

  it("exposes the canonical Settings page and hub link", () => {
    assert.match(page, /canManageSettingsCatalogs/);
    assert.match(page, /OrderStatusSettings/);
    assert.match(hub, /\/settings\/order-statuses/);
  });

  it("migration defines atomic set_order_status_initial with locks and CHECK", () => {
    assert.match(migration, /create or replace function public\.set_order_status_initial/);
    assert.match(migration, /pg_advisory_xact_lock/);
    assert.match(migration, /security invoker/);
    assert.match(migration, /inactive_status_cannot_be_initial/);
    assert.match(migration, /initial_status_cannot_be_deactivated/);
    assert.match(migration, /validate constraint order_statuses_initial_must_be_active/);
    assert.match(
      migration,
      /if v_kind not in \('in_progress', 'ready', 'closed', 'cancelled'\)/
    );
  });
});
